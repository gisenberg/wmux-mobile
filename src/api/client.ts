import type { BootstrapPayload, SplitDirection, WmuxSettings } from "../../protocol/wmux";

export const MOBILE_PROTOCOL_VERSION = 1;

const DEFAULT_TIMEOUT_MS = 12_000;

export interface AuthInfo {
  authEnabled: boolean;
  loginEnabled: boolean;
}

export interface LoginResponse {
  token: string;
  expiresInMs: number;
}

export interface PaneAttachment {
  id: string;
  paneId: string;
  name: string;
  mimeType: string;
  bytes: number;
  url: string;
  createdAt: string;
}

export interface StagedPanePasteImage {
  stageId: string;
  targetPath: string;
  mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  expiresAt: string;
}

export type ProtocolStatus = { kind: "verified"; version: number } | { kind: "legacy"; version: null };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class WmuxHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WmuxHttpError";
    this.status = status;
  }
}

export class UnauthorizedError extends WmuxHttpError {
  constructor() {
    super(401, "Your wmux session is no longer authorized.");
    this.name = "UnauthorizedError";
  }
}

export class ProtocolMismatchError extends Error {
  readonly actual: number;
  readonly expected: number;

  constructor(expected: number, actual: number) {
    super(`This app requires wmux protocol ${expected}, but the server advertises ${actual}.`);
    this.name = "ProtocolMismatchError";
    this.actual = actual;
    this.expected = expected;
  }
}

export const normalizeBaseUrl = (input: string): string => {
  const value = input.trim();
  if (!value) throw new Error("Enter the HTTPS address of your wmux server.");

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("Enter a valid wmux server address.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The wmux address must use HTTPS or HTTP.");
  }
  if (url.username || url.password) {
    throw new Error("Do not include credentials in the wmux address.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Enter the wmux server origin without a path, query, or fragment.");
  }

  return url.origin;
};

export const webSocketUrl = (baseUrl: string, path: string, token: string | undefined): string => {
  const url = new URL(path, `${normalizeBaseUrl(baseUrl)}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (token) url.searchParams.set("token", token);
  return url.toString();
};

const responseMessage = async (response: Response): Promise<string> => {
  const fallback = `wmux returned HTTP ${response.status}.`;
  try {
    const text = await response.text();
    if (!text) return fallback;
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof parsed.message === "string" && parsed.message) return parsed.message;
    if (typeof parsed.error === "string" && parsed.error) return parsed.error.replaceAll("_", " ");
    return fallback;
  } catch {
    return fallback;
  }
};

export class WmuxApiClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly token: string | undefined;

  constructor(baseUrl: string, token?: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
    this.token = token;
  }

  health(): Promise<{ ok: boolean }> {
    return this.request("/api/health", { authenticated: false });
  }

  authInfo(): Promise<AuthInfo> {
    return this.request("/api/auth-info", { authenticated: false });
  }

  login(username: string, password: string): Promise<LoginResponse> {
    return this.request("/api/login", {
      authenticated: false,
      body: JSON.stringify({ username, password }),
      method: "POST",
    });
  }

  bootstrap(): Promise<BootstrapPayload> {
    return this.request("/api/bootstrap");
  }

  updateSettings(settings: WmuxSettings): Promise<{ settings: WmuxSettings; state: BootstrapPayload }> {
    return this.request("/api/settings", {
      body: JSON.stringify(settings),
      method: "POST",
    });
  }

  createWorkspace(
    machineId: string,
    sourcePaneId?: string,
  ): Promise<{ workspace: BootstrapPayload["workspaces"][number]; state: BootstrapPayload }> {
    return this.request("/api/workspaces", {
      body: JSON.stringify({ machineId, sourcePaneId }),
      method: "POST",
    });
  }

  closeWorkspace(workspaceId: string): Promise<{ state: BootstrapPayload }> {
    return this.request(`/api/workspaces/${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
  }

  async markWorkspaceNotificationsRead(workspaceId: string): Promise<{ state: BootstrapPayload }> {
    const state = await this.request<BootstrapPayload>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/notifications/read`,
      { method: "POST" },
    );
    return { state };
  }

  createTab(
    workspaceId: string,
    machineId: string,
    sourcePaneId?: string,
  ): Promise<{ tab: BootstrapPayload["workspaces"][number]["tabs"][number]; state: BootstrapPayload }> {
    return this.request(`/api/workspaces/${encodeURIComponent(workspaceId)}/tabs`, {
      body: JSON.stringify({ machineId, sourcePaneId }),
      method: "POST",
    });
  }

  closeTab(workspaceId: string, tabId: string): Promise<{ state: BootstrapPayload }> {
    return this.request(`/api/workspaces/${encodeURIComponent(workspaceId)}/tabs/${encodeURIComponent(tabId)}`, {
      method: "DELETE",
    });
  }

  splitPane(
    tabId: string,
    paneId: string,
    direction: SplitDirection,
    machineId?: string,
  ): Promise<{ tab: BootstrapPayload["workspaces"][number]["tabs"][number]; state: BootstrapPayload }> {
    return this.request(`/api/tabs/${encodeURIComponent(tabId)}/split`, {
      body: JSON.stringify({ paneId, direction, ...(machineId ? { machineId } : {}) }),
      method: "POST",
    });
  }

  closePane(tabId: string, paneId: string): Promise<{ state: BootstrapPayload }> {
    return this.request(`/api/tabs/${encodeURIComponent(tabId)}/panes/${encodeURIComponent(paneId)}`, {
      method: "DELETE",
    });
  }

  uploadPaneAttachment(
    paneId: string,
    attachment: { name: string; mimeType: string; data: string },
  ): Promise<{ attachment: PaneAttachment }> {
    return this.request(`/api/panes/${encodeURIComponent(paneId)}/attachments`, {
      body: JSON.stringify(attachment),
      method: "POST",
    });
  }

  stagePanePasteImage(paneId: string, image: Blob): Promise<StagedPanePasteImage> {
    return this.request(`/api/panes/${encodeURIComponent(paneId)}/paste-images`, {
      body: image,
      contentType: "application/octet-stream",
      method: "POST",
    });
  }

  async discardPanePasteImage(paneId: string, stageId: string): Promise<void> {
    try {
      await this.request(`/api/panes/${encodeURIComponent(paneId)}/paste-images/${encodeURIComponent(stageId)}`, {
        method: "DELETE",
      });
    } catch (error) {
      if (!(error instanceof WmuxHttpError && error.status === 404)) throw error;
    }
  }

  async protocolStatus(expected = MOBILE_PROTOCOL_VERSION): Promise<ProtocolStatus> {
    try {
      const response = await this.request<{ protocolVersion: number }>("/api/protocol");
      if (!Number.isSafeInteger(response.protocolVersion) || response.protocolVersion < 1) {
        throw new Error("The wmux server returned an invalid protocol version.");
      }
      if (response.protocolVersion !== expected) {
        throw new ProtocolMismatchError(expected, response.protocolVersion);
      }
      return { kind: "verified", version: response.protocolVersion };
    } catch (error) {
      if (error instanceof WmuxHttpError && error.status === 404) {
        return { kind: "legacy", version: null };
      }
      throw error;
    }
  }

  private async request<T>(
    path: string,
    options: {
      authenticated?: boolean;
      body?: BodyInit;
      contentType?: string;
      method?: "DELETE" | "GET" | "POST";
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const headers: Record<string, string> = {
      accept: "application/json",
    };
    if (options.contentType) headers["content-type"] = options.contentType;
    else if (typeof options.body === "string") headers["content-type"] = "application/json";
    if (options.authenticated !== false && this.token) headers.authorization = `Bearer ${this.token}`;

    try {
      const response = await this.fetchImpl(new URL(path, `${this.baseUrl}/`).toString(), {
        headers,
        method: options.method ?? "GET",
        signal: controller.signal,
        ...(options.body ? { body: options.body } : {}),
      });
      if (response.status === 401) throw new UnauthorizedError();
      if (!response.ok) throw new WmuxHttpError(response.status, await responseMessage(response));
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("The wmux server did not respond in time.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
