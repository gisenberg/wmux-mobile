import { AppState } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";

import type { BootstrapPayload, EventServerMessage, EventStateDelta, TerminalClipboard } from "../../protocol/wmux";

import {
  ProtocolMismatchError,
  type ProtocolStatus,
  UnauthorizedError,
  WmuxApiClient,
  normalizeBaseUrl,
} from "@/api/client";
import {
  clearStoredSession,
  forgetStoredConnection,
  loadStoredConnection,
  storeAccessToken,
  storeEndpoint,
  storeSession,
} from "@/auth/secure-connection";
import { EventStream, type EventStreamStatus } from "@/events/event-stream";
import {
  applyEventMessage,
  bootstrapSatisfiesEventDelta,
  bootstrapSatisfiesHealthDelta,
  eventDeltaRequiresResync,
  healthDeltaRequiresResync,
  isIncomingBootstrapStale,
  markWorkspaceNotificationsRead as markWorkspaceNotificationsReadInState,
} from "@/state/bootstrap";

export type ConnectionPhase =
  | "restoring"
  | "disconnected"
  | "probing"
  | "authentication-required"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "protocol-mismatch";

export interface WmuxConnection {
  authLoginEnabled: boolean;
  bootstrap: BootstrapPayload | null;
  changeServer: () => void;
  clipboardHandoff: TerminalClipboard | null;
  endpoint: string;
  error: string | null;
  forget: () => Promise<void>;
  markWorkspaceNotificationsRead: (workspaceId: string) => Promise<void>;
  mutate: <T extends WmuxStateMutationResult>(operation: (client: WmuxApiClient) => Promise<T>) => Promise<T | null>;
  phase: ConnectionPhase;
  probe: (input: string) => Promise<void>;
  protocolStatus: ProtocolStatus | null;
  retry: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  terminalAccessToken: string | undefined;
  useAccessToken: (token: string) => Promise<void>;
  username: string;
}

export interface WmuxStateMutationResult {
  state: BootstrapPayload;
}

const messageForError = (error: unknown): string =>
  error instanceof Error ? error.message : "The wmux connection failed.";

const wait = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

export const useWmuxConnection = (defaultEndpoint = ""): WmuxConnection => {
  const [authLoginEnabled, setAuthLoginEnabled] = useState(false);
  const [bootstrap, setBootstrapState] = useState<BootstrapPayload | null>(null);
  const [clipboardHandoff, setClipboardHandoff] = useState<TerminalClipboard | null>(null);
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ConnectionPhase>("restoring");
  const [protocolStatus, setProtocolStatus] = useState<ProtocolStatus | null>(null);
  const [terminalAccessToken, setTerminalAccessToken] = useState<string | undefined>();
  const [username, setUsername] = useState("");

  const apiRef = useRef<WmuxApiClient | null>(null);
  const bootstrapRef = useRef<BootstrapPayload | null>(null);
  const endpointRef = useRef("");
  const eventStreamRef = useRef<EventStream | null>(null);
  const mountedRef = useRef(true);
  const pendingEventResyncRef = useRef<Pick<EventStateDelta, "eventRevision" | "healthEpoch"> | null>(null);
  const pendingHealthResyncRef = useRef<Pick<BootstrapPayload, "revision" | "healthEpoch"> | null>(null);
  const refreshInFlightRef = useRef(false);
  const runIdRef = useRef(0);
  const tokenRef = useRef<string | undefined>(undefined);

  const commitBootstrap = useCallback((next: BootstrapPayload): void => {
    if (isIncomingBootstrapStale(bootstrapRef.current, next)) return;
    bootstrapRef.current = next;
    if (mountedRef.current) setBootstrapState(next);
  }, []);

  const handleUnauthorized = useCallback(async (): Promise<void> => {
    tokenRef.current = undefined;
    eventStreamRef.current?.stop();
    eventStreamRef.current = null;
    await clearStoredSession();
    if (!mountedRef.current) return;
    setTerminalAccessToken(undefined);
    setError("Your saved session expired. Sign in again.");
    setPhase("authentication-required");
  }, []);

  const refreshBootstrap = useCallback(async (): Promise<void> => {
    const client = apiRef.current;
    if (!client || refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    const delays = [0, 500, 1_000, 2_000] as const;
    let latestError: unknown;

    try {
      for (const delay of delays) {
        if (delay) await wait(delay);
        try {
          const next = await client.bootstrap();
          if (
            !bootstrapSatisfiesEventDelta(pendingEventResyncRef.current, next) ||
            !bootstrapSatisfiesHealthDelta(pendingHealthResyncRef.current, next)
          ) {
            latestError = new Error("wmux returned a stale bootstrap snapshot.");
            continue;
          }
          pendingEventResyncRef.current = null;
          pendingHealthResyncRef.current = null;
          commitBootstrap(next);
          if (mountedRef.current) {
            setError(null);
            setPhase("connected");
          }
          return;
        } catch (currentError) {
          if (currentError instanceof UnauthorizedError) {
            await handleUnauthorized();
            return;
          }
          latestError = currentError;
          if (mountedRef.current) setPhase("reconnecting");
        }
      }
      if (mountedRef.current) setError(messageForError(latestError));
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [commitBootstrap, handleUnauthorized]);

  const mutate = useCallback(
    async <T extends WmuxStateMutationResult>(operation: (client: WmuxApiClient) => Promise<T>): Promise<T | null> => {
      const client = apiRef.current;
      if (!client) {
        if (mountedRef.current) setError("Connect to wmux before changing workspace state.");
        return null;
      }
      try {
        const result = await operation(client);
        commitBootstrap(result.state);
        if (mountedRef.current) setError(null);
        return result;
      } catch (currentError) {
        if (currentError instanceof UnauthorizedError) {
          await handleUnauthorized();
          return null;
        }
        if (mountedRef.current) setError(messageForError(currentError));
        return null;
      }
    },
    [commitBootstrap, handleUnauthorized],
  );

  const markWorkspaceNotificationsRead = useCallback(
    async (workspaceId: string): Promise<void> => {
      const current = bootstrapRef.current;
      if (
        !current ||
        !current.notifications.some((notification) => notification.workspaceId === workspaceId && !notification.read)
      ) {
        return;
      }
      commitBootstrap(markWorkspaceNotificationsReadInState(current, workspaceId));
      await mutate((client) => client.markWorkspaceNotificationsRead(workspaceId));
    },
    [commitBootstrap, mutate],
  );

  const handleEventMessage = useCallback(
    (message: EventServerMessage): void => {
      if (message.type === "clipboard") {
        setClipboardHandoff((current) => (current?.id === message.clipboard.id ? current : message.clipboard));
        return;
      }
      if (message.type === "state") {
        void refreshBootstrap();
        return;
      }
      const current = bootstrapRef.current;
      if (!current) return;
      if (message.type === "delta" && eventDeltaRequiresResync(current, message)) {
        const pending = pendingEventResyncRef.current;
        if (
          !pending ||
          message.healthEpoch > pending.healthEpoch ||
          (message.healthEpoch === pending.healthEpoch && message.eventRevision > pending.eventRevision)
        ) {
          pendingEventResyncRef.current = message;
        }
        void refreshBootstrap();
        return;
      }
      if (message.type === "health" && healthDeltaRequiresResync(current, message)) {
        const pending = pendingHealthResyncRef.current;
        if (
          !pending ||
          message.revision > pending.revision ||
          (message.revision === pending.revision && message.healthEpoch > pending.healthEpoch)
        ) {
          pendingHealthResyncRef.current = message;
        }
        void refreshBootstrap();
        return;
      }
      if (message.type === "snapshot") {
        if (
          !bootstrapSatisfiesEventDelta(pendingEventResyncRef.current, message.state) ||
          !bootstrapSatisfiesHealthDelta(pendingHealthResyncRef.current, message.state)
        ) {
          return;
        }
        pendingEventResyncRef.current = null;
        pendingHealthResyncRef.current = null;
      }
      commitBootstrap(applyEventMessage(current, message));
    },
    [commitBootstrap, refreshBootstrap],
  );

  const startEventStream = useCallback((): void => {
    const baseUrl = endpointRef.current;
    if (!baseUrl || !bootstrapRef.current) return;
    eventStreamRef.current?.stop();
    const stream = new EventStream({
      baseUrl,
      token: tokenRef.current,
      onMessage: handleEventMessage,
      onOpen: (reconnected) => {
        if (reconnected) void refreshBootstrap();
      },
      onStatus: (status: EventStreamStatus) => {
        if (!mountedRef.current || status === "stopped") return;
        if (status === "live") {
          setError(null);
          setPhase("connected");
        } else {
          setPhase(bootstrapRef.current ? "reconnecting" : "connecting");
        }
      },
    });
    eventStreamRef.current = stream;
    stream.start();
  }, [handleEventMessage, refreshBootstrap]);

  const establish = useCallback(
    async (baseUrl: string, token: string | undefined, runId: number): Promise<void> => {
      const client = new WmuxApiClient(baseUrl, token);
      endpointRef.current = baseUrl;
      tokenRef.current = token;
      apiRef.current = client;
      if (mountedRef.current) {
        setTerminalAccessToken(token);
        setError(null);
        setPhase("connecting");
      }

      try {
        const [bootstrapResult, protocolResult] = await Promise.allSettled([
          client.bootstrap(),
          client.protocolStatus(),
        ]);
        if (bootstrapResult.status === "rejected") throw bootstrapResult.reason;
        const nextBootstrap = bootstrapResult.value;
        const nextProtocolStatus =
          protocolResult.status === "fulfilled"
            ? protocolResult.value
            : protocolResult.reason instanceof UnauthorizedError
              ? ({ kind: "legacy", version: null } as const)
              : (() => {
                  throw protocolResult.reason;
                })();
        if (!mountedRef.current || runId !== runIdRef.current) return;
        setProtocolStatus(nextProtocolStatus);
        commitBootstrap(nextBootstrap);
        setPhase("connected");
        startEventStream();
      } catch (currentError) {
        if (!mountedRef.current || runId !== runIdRef.current) return;
        if (currentError instanceof UnauthorizedError) {
          await handleUnauthorized();
          return;
        }
        if (currentError instanceof ProtocolMismatchError) {
          setError(currentError.message);
          setPhase("protocol-mismatch");
          return;
        }
        setError(messageForError(currentError));
        setPhase("disconnected");
      }
    },
    [commitBootstrap, handleUnauthorized, startEventStream],
  );

  const probe = useCallback(
    async (input: string): Promise<void> => {
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      eventStreamRef.current?.stop();
      eventStreamRef.current = null;
      bootstrapRef.current = null;
      pendingEventResyncRef.current = null;
      pendingHealthResyncRef.current = null;
      setBootstrapState(null);
      setProtocolStatus(null);
      setError(null);
      setPhase("probing");

      let baseUrl: string;
      try {
        baseUrl = normalizeBaseUrl(input);
      } catch (currentError) {
        if (mountedRef.current) {
          setError(messageForError(currentError));
          setPhase("disconnected");
        }
        return;
      }

      try {
        const stored = await loadStoredConnection();
        const client = new WmuxApiClient(baseUrl);
        const [, nextAuthInfo] = await Promise.all([client.health(), client.authInfo()]);
        if (!mountedRef.current || runId !== runIdRef.current) return;
        const saved = await storeEndpoint(baseUrl);
        setEndpoint(baseUrl);
        setAuthLoginEnabled(nextAuthInfo.loginEnabled);
        setUsername(stored?.baseUrl === baseUrl ? (stored.username ?? "") : "");

        if (nextAuthInfo.authEnabled && !saved.token) {
          endpointRef.current = baseUrl;
          setPhase("authentication-required");
          return;
        }
        await establish(baseUrl, nextAuthInfo.authEnabled ? saved.token : undefined, runId);
      } catch (currentError) {
        if (!mountedRef.current || runId !== runIdRef.current) return;
        setEndpoint(baseUrl);
        setError(messageForError(currentError));
        setPhase("disconnected");
      }
    },
    [establish],
  );

  const signIn = useCallback(
    async (nextUsername: string, password: string): Promise<void> => {
      const baseUrl = endpointRef.current || endpoint;
      const cleanUsername = nextUsername.trim();
      if (!cleanUsername || !password) {
        setError("Enter your wmux username and password.");
        return;
      }
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      setError(null);
      setPhase("connecting");

      try {
        const loginClient = new WmuxApiClient(baseUrl);
        const session = await loginClient.login(cleanUsername, password);
        if (!mountedRef.current || runId !== runIdRef.current) return;
        await storeSession(baseUrl, cleanUsername, session.token, session.expiresInMs);
        setUsername(cleanUsername);
        await establish(baseUrl, session.token, runId);
      } catch (currentError) {
        if (!mountedRef.current || runId !== runIdRef.current) return;
        setError(
          currentError instanceof UnauthorizedError
            ? "The username or password was not accepted."
            : messageForError(currentError),
        );
        setPhase("authentication-required");
      }
    },
    [endpoint, establish],
  );

  const changeServer = useCallback((): void => {
    runIdRef.current += 1;
    eventStreamRef.current?.stop();
    eventStreamRef.current = null;
    apiRef.current = null;
    bootstrapRef.current = null;
    pendingEventResyncRef.current = null;
    pendingHealthResyncRef.current = null;
    tokenRef.current = undefined;
    setTerminalAccessToken(undefined);
    setBootstrapState(null);
    setClipboardHandoff(null);
    setError(null);
    setPhase("disconnected");
  }, []);

  const forget = useCallback(async (): Promise<void> => {
    changeServer();
    await forgetStoredConnection();
    if (!mountedRef.current) return;
    setEndpoint(defaultEndpoint);
    setUsername("");
  }, [changeServer, defaultEndpoint]);

  const retry = useCallback(async (): Promise<void> => {
    await probe(endpointRef.current || endpoint);
  }, [endpoint, probe]);

  const useAccessToken = useCallback(
    async (token: string): Promise<void> => {
      const cleanToken = token.trim();
      if (!cleanToken) {
        setError("Enter the wmux access token.");
        return;
      }
      const baseUrl = endpointRef.current || endpoint;
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      setError(null);
      setPhase("connecting");

      try {
        await storeAccessToken(baseUrl, cleanToken);
        await establish(baseUrl, cleanToken, runId);
      } catch (currentError) {
        if (!mountedRef.current || runId !== runIdRef.current) return;
        setError(messageForError(currentError));
        setPhase("authentication-required");
      }
    },
    [endpoint, establish],
  );

  useEffect(() => {
    mountedRef.current = true;
    void (async () => {
      const stored = await loadStoredConnection();
      if (!mountedRef.current) return;
      const initialEndpoint = stored?.baseUrl ?? defaultEndpoint;
      setEndpoint(initialEndpoint);
      setUsername(stored?.username ?? "");
      if (initialEndpoint) {
        await probe(initialEndpoint);
      } else {
        setPhase("disconnected");
      }
    })();

    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
      eventStreamRef.current?.stop();
    };
  }, [defaultEndpoint, probe]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        if (bootstrapRef.current) {
          startEventStream();
          void refreshBootstrap();
        }
      } else {
        eventStreamRef.current?.stop();
      }
    });
    return () => subscription.remove();
  }, [refreshBootstrap, startEventStream]);

  return {
    authLoginEnabled,
    bootstrap,
    changeServer,
    clipboardHandoff,
    endpoint,
    error,
    forget,
    markWorkspaceNotificationsRead,
    mutate,
    phase,
    probe,
    protocolStatus,
    retry,
    signIn,
    terminalAccessToken,
    useAccessToken,
    username,
  };
};
