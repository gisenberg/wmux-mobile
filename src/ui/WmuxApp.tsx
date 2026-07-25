import * as ImagePicker from "expo-image-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { BootstrapPayload, MachineStatus, WmuxSettings } from "../../protocol/wmux";
import type {
  WmuxKeyInputKeyEvent,
  WmuxKeyInputModifierEvent,
  WmuxKeyInputTextEvent,
} from "../../modules/wmux-key-input";

import { WmuxApiClient } from "@/api/client";
import {
  readNativeClipboardImage,
  readNativeClipboardText,
  writeNativeClipboardText,
} from "@/clipboard/native-clipboard";
import { TerminalInput, type TerminalInputHandle } from "@/input/TerminalInput";
import { chromeTheme, normalizeTerminalColorScheme, type ChromeTheme } from "@/navigation/chrome-theme";
import { navigationFixture } from "@/navigation/fixture";
import { cycleTab, resolveNavigation, type NavigationSelection, type ResolvedNavigation } from "@/navigation/model";
import { WorkspaceChrome, type WorkspaceAction } from "@/navigation/WorkspaceChrome";
import { type ConnectionPhase, useWmuxConnection } from "@/state/use-wmux-connection";
import {
  TerminalSurface,
  type TerminalSurfaceHandle,
  type TerminalSurfaceSession,
  type TerminalSurfaceStatus,
} from "@/terminal/TerminalSurface";
import { TerminalInteractionLayer } from "@/terminal/TerminalInteractionLayer";
import {
  base64FromDataUrl,
  quoteStagedImagePath,
  type TerminalCursor,
  type TerminalMetrics,
  type TerminalSelection,
} from "@/terminal/interactions";
import { colors, fonts } from "@/ui/theme";

const defaultEndpoint = process.env.EXPO_PUBLIC_WMUX_URL ?? "";

const busyPhases: ReadonlySet<ConnectionPhase> = new Set(["restoring", "probing", "connecting"]);

export function WmuxApp() {
  const connection = useWmuxConnection(defaultEndpoint);
  const inputRef = useRef<TerminalInputHandle>(null);
  const inputTargetRef = useRef<"diagnostic" | "terminal" | null>(null);
  const terminalRef = useRef<TerminalSurfaceHandle>(null);
  const [accessToken, setAccessToken] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "token">("login");
  const [endpointDraft, setEndpointDraft] = useState<string | null>(null);
  const [inputDiagnosticEvents, setInputDiagnosticEvents] = useState<string[]>([]);
  const [inputFocused, setInputFocused] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [navigationPreference, setNavigationPreference] = useState<NavigationSelection | null>(null);
  const [password, setPassword] = useState("");
  const [diagnosticsView, setDiagnosticsView] = useState<"navigation" | "renderer" | null>(null);
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
  const clipboardNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { height, width } = useWindowDimensions();
  const isLandscape = width > height;

  const endpointInput = endpointDraft ?? connection.endpoint;
  const username = usernameDraft ?? connection.username;
  const isBusy = busyPhases.has(connection.phase);
  const dashboardPhase =
    connection.phase === "connected" || connection.phase === "reconnecting" ? connection.phase : null;
  const navigation = useMemo(
    () => resolveNavigation(connection.bootstrap, navigationPreference),
    [connection.bootstrap, navigationPreference],
  );
  const activePaneId = navigation?.pane.id;
  const activeChromeTheme = chromeTheme(connection.bootstrap?.settings.colorScheme ?? "wmux");

  const showClipboardNotice = useCallback((message: string): void => {
    if (clipboardNoticeTimerRef.current) clearTimeout(clipboardNoticeTimerRef.current);
    setClipboardNotice(message);
    clipboardNoticeTimerRef.current = setTimeout(() => setClipboardNotice(null), 2_200);
  }, []);

  useEffect(() => {
    const handoff = connection.clipboardHandoff;
    if (!handoff) return;
    void writeNativeClipboardText(handoff.text)
      .then(() => showClipboardNotice("wmux clipboard copied"))
      .catch(() => showClipboardNotice("Clipboard handoff failed"));
  }, [connection.clipboardHandoff, showClipboardNotice]);

  useEffect(
    () => () => {
      if (clipboardNoticeTimerRef.current) clearTimeout(clipboardNoticeTimerRef.current);
    },
    [],
  );

  const pushInputDiagnosticEvent = useCallback((message: string): void => {
    setInputDiagnosticEvents((current) => [message, ...current].slice(0, 5));
  }, []);

  const focusInput = useCallback((target: "diagnostic" | "terminal"): void => {
    inputTargetRef.current = target;
    requestAnimationFrame(() => void inputRef.current?.focus());
  }, []);

  const handleInputFocusChange = useCallback(
    (focused: boolean): void => {
      setInputFocused(focused);
      if (inputTargetRef.current === "diagnostic") {
        pushInputDiagnosticEvent(focused ? "focus: software keyboard active" : "focus: keyboard dismissed");
      }
    },
    [pushInputDiagnosticEvent],
  );

  const handleInputKey = useCallback(
    (event: WmuxKeyInputKeyEvent): void => {
      if (inputTargetRef.current === "diagnostic") {
        const modifiers = [
          event.ctrl ? "ctrl" : "",
          event.alt ? "alt" : "",
          event.shift ? "shift" : "",
          event.meta ? "meta" : "",
        ]
          .filter(Boolean)
          .join("+");
        pushInputDiagnosticEvent(
          `key: ${modifiers ? `${modifiers}+` : ""}${event.key} · ${event.source}${event.repeat ? " · repeat" : ""}`,
        );
        return;
      }
      if (!activePaneId) return;
      terminalRef.current?.send({
        t: "key",
        paneId: activePaneId,
        key: event.key,
        code: event.code,
        ctrl: event.ctrl,
        alt: event.alt,
        shift: event.shift,
        meta: event.meta,
      });
    },
    [activePaneId, pushInputDiagnosticEvent],
  );

  const handleInputText = useCallback(
    (event: WmuxKeyInputTextEvent): void => {
      if (inputTargetRef.current === "diagnostic") {
        pushInputDiagnosticEvent(`text: ${JSON.stringify(event.data)}`);
        return;
      }
      if (!activePaneId) return;
      terminalRef.current?.send({ t: "text", paneId: activePaneId, data: event.data });
    },
    [activePaneId, pushInputDiagnosticEvent],
  );

  const handleModifierState = useCallback(
    (event: WmuxKeyInputModifierEvent): void => {
      if (inputTargetRef.current === "diagnostic") {
        pushInputDiagnosticEvent(`modifiers: ctrl ${event.ctrl} · alt ${event.alt}`);
      }
    },
    [pushInputDiagnosticEvent],
  );

  const submitLogin = async (): Promise<void> => {
    const submittedPassword = password;
    setPassword("");
    await connection.signIn(username, submittedPassword);
  };

  const submitToken = async (): Promise<void> => {
    const submittedToken = accessToken;
    setAccessToken("");
    await connection.useAccessToken(submittedToken);
  };

  const performWorkspaceAction = useCallback(
    async (action: WorkspaceAction): Promise<void> => {
      if (!navigation) return;
      setMutationBusy(true);
      try {
        if (action.type === "create-workspace") {
          const result = await connection.mutate((client) =>
            client.createWorkspace(action.machineId, navigation.pane.id),
          );
          const next = result ? resolveNavigation(result.state, { workspaceId: result.workspace.id }) : null;
          if (next) setNavigationPreference(next.selection);
          return;
        }
        if (action.type === "create-tab") {
          const result = await connection.mutate((client) =>
            client.createTab(navigation.workspace.id, action.machineId, navigation.pane.id),
          );
          const next = result
            ? resolveNavigation(result.state, {
                tabId: result.tab.id,
                workspaceId: navigation.workspace.id,
              })
            : null;
          if (next) setNavigationPreference(next.selection);
          return;
        }
        if (action.type === "split") {
          const result = await connection.mutate((client) =>
            client.splitPane(navigation.tab.id, navigation.pane.id, action.direction, action.machineId),
          );
          const next = result
            ? resolveNavigation(result.state, {
                paneId: result.tab.activePaneId,
                tabId: result.tab.id,
                workspaceId: navigation.workspace.id,
              })
            : null;
          if (next) setNavigationPreference(next.selection);
          return;
        }

        const result =
          action.type === "close-pane"
            ? await connection.mutate((client) => client.closePane(navigation.tab.id, navigation.pane.id))
            : action.type === "close-tab"
              ? await connection.mutate((client) => client.closeTab(navigation.workspace.id, navigation.tab.id))
              : await connection.mutate((client) => client.closeWorkspace(navigation.workspace.id));
        const next = result ? resolveNavigation(result.state, navigation.selection) : null;
        setNavigationPreference(next?.selection ?? null);
      } finally {
        setMutationBusy(false);
      }
    },
    [connection, navigation],
  );

  const handleWorkspaceAction = useCallback(
    (action: WorkspaceAction): void => {
      if (!action.type.startsWith("close-")) {
        void performWorkspaceAction(action);
        return;
      }
      const target = action.type.replace("close-", "");
      Alert.alert(`Close ${target}?`, `The current ${target} and its running session will be closed.`, [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => void performWorkspaceAction(action),
          style: "destructive",
          text: `Close ${target}`,
        },
      ]);
    },
    [performWorkspaceAction],
  );

  const updateSettings = useCallback(
    async (settings: WmuxSettings): Promise<void> => {
      setMutationBusy(true);
      try {
        await connection.mutate((client) => client.updateSettings(settings));
      } finally {
        setMutationBusy(false);
      }
    },
    [connection],
  );

  const closeDiagnostics = useCallback((): void => {
    setDiagnosticsView(null);
    if (inputTargetRef.current === "diagnostic") {
      inputTargetRef.current = null;
      void inputRef.current?.blur();
    }
  }, []);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: activeChromeTheme.canvas }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView
          bounces={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.flex}
        >
          <View
            style={[
              styles.screen,
              isLandscape && styles.screenLandscape,
              { backgroundColor: activeChromeTheme.canvas },
            ]}
          >
            <AppHeader
              onOpenDiagnostics={() => setDiagnosticsView("renderer")}
              phase={connection.phase}
              theme={activeChromeTheme}
            />

            {diagnosticsView === "renderer" ? (
              <TerminalDiagnosticsCard
                inputEvents={inputDiagnosticEvents}
                inputFocused={inputFocused}
                isLandscape={isLandscape}
                onClose={closeDiagnostics}
                onOpenNavigation={() => setDiagnosticsView("navigation")}
                onOpenInput={() => {
                  setInputDiagnosticEvents([]);
                  focusInput("diagnostic");
                }}
              />
            ) : diagnosticsView === "navigation" ? (
              <NavigationDiagnosticsCard isLandscape={isLandscape} onClose={closeDiagnostics} />
            ) : connection.bootstrap && dashboardPhase && navigation ? (
              <Dashboard
                accessToken={connection.terminalAccessToken}
                bootstrap={connection.bootstrap}
                endpoint={connection.endpoint}
                error={connection.error}
                isLandscape={isLandscape}
                mutationBusy={mutationBusy}
                navigation={navigation}
                onAction={handleWorkspaceAction}
                onClipboardNotice={showClipboardNotice}
                onFocusInput={() => focusInput("terminal")}
                onForget={() => {
                  setEndpointDraft(null);
                  setNavigationPreference(null);
                  setUsernameDraft(null);
                  void connection.forget();
                }}
                onNavigate={(next) => setNavigationPreference(next.selection)}
                onOpenDiagnostics={() => setDiagnosticsView("renderer")}
                onRetry={() => void connection.retry()}
                onUpdateSettings={(settings) => void updateSettings(settings)}
                phase={dashboardPhase}
                protocolKind={connection.protocolStatus?.kind ?? "legacy"}
                terminalRef={terminalRef}
              />
            ) : connection.phase === "authentication-required" ? (
              <AuthenticationCard
                accessToken={accessToken}
                authMode={authMode}
                endpoint={connection.endpoint}
                error={connection.error}
                isLandscape={isLandscape}
                loginEnabled={connection.authLoginEnabled}
                onAccessTokenChange={setAccessToken}
                onAuthModeChange={setAuthMode}
                onChangeServer={() => {
                  setEndpointDraft(connection.endpoint);
                  setNavigationPreference(null);
                  connection.changeServer();
                }}
                onPasswordChange={setPassword}
                onSubmitLogin={() => void submitLogin()}
                onSubmitToken={() => void submitToken()}
                onUsernameChange={setUsernameDraft}
                password={password}
                username={username}
              />
            ) : connection.phase === "protocol-mismatch" ? (
              <MessageCard
                actionLabel="Check again"
                eyebrow="UPDATE REQUIRED"
                message={connection.error ?? "The app and server protocol versions do not match."}
                onAction={() => void connection.retry()}
                onSecondary={() => {
                  setEndpointDraft(connection.endpoint);
                  setNavigationPreference(null);
                  connection.changeServer();
                }}
                secondaryLabel="Change server"
                title="wmux versions do not match"
                tone="danger"
              />
            ) : (
              <EndpointCard
                endpoint={endpointInput}
                error={connection.error}
                isBusy={isBusy}
                onEndpointChange={setEndpointDraft}
                onSubmit={() => void connection.probe(endpointInput)}
                phase={connection.phase}
              />
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <TerminalInput
        onFocusChange={handleInputFocusChange}
        onKey={handleInputKey}
        onModifierState={handleModifierState}
        onText={handleInputText}
        ref={inputRef}
      />
      {clipboardNotice ? <ClipboardToast message={clipboardNotice} /> : null}
    </SafeAreaView>
  );
}

function AppHeader({
  onOpenDiagnostics,
  phase,
  theme,
}: {
  onOpenDiagnostics: () => void;
  phase: ConnectionPhase;
  theme: ChromeTheme;
}) {
  const isLive = phase === "connected";
  return (
    <View style={styles.topBar}>
      <View style={[styles.brandMark, { backgroundColor: theme.accent }]}>
        <Text style={[styles.brandGlyph, { color: theme.canvas }]}>›_</Text>
      </View>
      <View style={styles.brandCopy}>
        <Text style={[styles.eyebrow, { color: theme.muted }]}>WMUX MOBILE</Text>
        <Text style={[styles.title, { color: theme.text }]}>Your terminal, native.</Text>
      </View>
      <Pressable
        accessibilityLabel="Open terminal renderer diagnostics"
        accessibilityRole="button"
        hitSlop={{ bottom: 6, left: 20, top: 6 }}
        onPress={onOpenDiagnostics}
        style={({ pressed }) => [
          styles.diagnosticsButton,
          __DEV__ && styles.diagnosticsButtonDevelopment,
          { backgroundColor: theme.panel, borderColor: theme.line },
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={[styles.diagnosticsGlyph, { color: theme.muted }]}>›_?</Text>
        <View
          accessibilityLabel={isLive ? "Connection live" : "Connection not live"}
          style={[styles.statusDot, isLive ? styles.statusDotLive : styles.statusDotIdle]}
        />
      </Pressable>
    </View>
  );
}

function TerminalDiagnosticsCard({
  inputEvents,
  inputFocused,
  isLandscape,
  onClose,
  onOpenNavigation,
  onOpenInput,
}: {
  inputEvents: string[];
  inputFocused: boolean;
  isLandscape: boolean;
  onClose: () => void;
  onOpenNavigation: () => void;
  onOpenInput: () => void;
}) {
  const [status, setStatus] = useState<TerminalSurfaceStatus>("loading-asset");
  const [issue, setIssue] = useState<string | undefined>();
  const ready = status === "ready";

  return (
    <View
      style={[
        styles.formCard,
        styles.diagnosticsCard,
        isLandscape && styles.formCardLandscape,
        isLandscape && styles.diagnosticsCardLandscape,
        inputFocused && styles.diagnosticsCardInputFocused,
      ]}
    >
      <Text style={styles.cardKicker}>NATIVE RENDERER DIAGNOSTIC</Text>
      <Text style={[styles.cardTitle, isLandscape && styles.cardTitleLandscape]}>Offline Ghostty host</Text>
      {inputFocused ? null : (
        <Text
          numberOfLines={isLandscape ? 1 : undefined}
          style={[styles.cardCopy, isLandscape && styles.diagnosticsCardCopyLandscape]}
        >
          This verifies that the bundled terminal page, fonts, JavaScript, and WebAssembly initialize inside this
          device&apos;s native WebView.
        </Text>
      )}
      <TerminalSurface
        onStatusChange={(nextStatus, nextIssue) => {
          setStatus(nextStatus);
          setIssue(nextIssue);
        }}
        style={[
          styles.diagnosticsSurface,
          isLandscape && styles.diagnosticsSurfaceLandscape,
          inputFocused && styles.diagnosticsSurfaceInputFocused,
        ]}
      />
      <View
        style={[
          styles.diagnosticsStatus,
          isLandscape && styles.diagnosticsStatusLandscape,
          inputFocused && styles.diagnosticsStatusInputFocused,
          ready ? styles.diagnosticsStatusReady : styles.diagnosticsStatusPending,
        ]}
      >
        <View style={[styles.liveIndicator, !ready && styles.liveIndicatorWarning]} />
        <Text style={[styles.diagnosticsStatusText, ready && styles.diagnosticsStatusTextReady]}>
          {ready
            ? "Renderer ready. Ghostty WASM initialized without network access."
            : issue
              ? `Renderer failed: ${issue}`
              : "Starting the native terminal renderer…"}
        </Text>
      </View>
      <View style={[styles.inputDiagnostic, isLandscape && styles.inputDiagnosticLandscape]}>
        <View style={styles.inputDiagnosticHeader}>
          <Text style={styles.inputDiagnosticTitle}>NATIVE KEY INPUT</Text>
          <Text style={[styles.inputDiagnosticFocus, inputFocused && styles.inputDiagnosticFocusActive]}>
            {inputFocused ? "FOCUSED" : "IDLE"}
          </Text>
        </View>
        {inputEvents.length ? (
          inputEvents.slice(0, isLandscape ? 2 : 3).map((event, index) => (
            <Text key={`${event}-${index}`} numberOfLines={1} style={styles.inputDiagnosticEvent}>
              {event}
            </Text>
          ))
        ) : (
          <Text style={styles.inputDiagnosticEmpty}>Open the keyboard, then type or use the terminal key row.</Text>
        )}
      </View>
      {inputFocused ? null : <TerminalTouchDiagnostics onFocusInput={onOpenInput} />}
      {inputFocused ? null : (
        <View style={styles.diagnosticsActions}>
          <View style={styles.diagnosticsAction}>
            <PrimaryButton compact={isLandscape} label="Test native keyboard" onPress={onOpenInput} />
          </View>
          <View style={styles.diagnosticsAction}>
            <SecondaryButton compact={isLandscape} label="Navigation chrome" onPress={onOpenNavigation} />
          </View>
        </View>
      )}
      {inputFocused ? null : <SecondaryButton compact={isLandscape} label="Back" onPress={onClose} />}
    </View>
  );
}

function TerminalTouchDiagnostics({ onFocusInput }: { onFocusInput: () => void }) {
  const [layout, setLayout] = useState({ height: 0, width: 0 });
  const [selection, setSelection] = useState<TerminalSelection>({ active: false });
  const [status, setStatus] = useState("Long-press, double-tap, triple-tap, or drag vertically.");
  const anchorRef = useRef({ x: 20, y: 38 });
  const metrics = useMemo<TerminalMetrics>(
    () => ({
      cellH: 18,
      cellW: 8,
      cols: Math.max(1, Math.floor(layout.width / 8)),
      rows: Math.max(1, Math.floor(layout.height / 18)),
    }),
    [layout.height, layout.width],
  );

  const copyDiagnosticText = useCallback(async (): Promise<void> => {
    const text = selection.text || "wmux native clipboard diagnostic";
    await writeNativeClipboardText(text);
    setStatus(`Copied: ${text.slice(0, 38)}`);
  }, [selection.text]);

  const pasteDiagnosticText = useCallback(async (): Promise<void> => {
    const text = await readNativeClipboardText();
    setStatus(text ? `Pasted: ${text.replace(/\s+/g, " ").slice(0, 38)}` : "Clipboard has no text.");
  }, []);

  return (
    <View style={styles.touchDiagnostic}>
      <View style={styles.inputDiagnosticHeader}>
        <Text style={styles.inputDiagnosticTitle}>NATIVE TOUCH + CLIPBOARD</Text>
        <Text style={styles.touchDiagnosticBadge}>M6</Text>
      </View>
      <View
        onLayout={(event) => {
          const { height, width } = event.nativeEvent.layout;
          setLayout({ height, width });
        }}
        style={styles.touchDiagnosticTerminal}
      >
        <Text style={styles.touchDiagnosticPrompt}>
          <Text style={styles.touchDiagnosticAccent}>wmux</Text> touch % select this terminal text
        </Text>
        <Text style={styles.touchDiagnosticLine}>drag ↕ scroll · swipe ↔ tab · tap keyboard</Text>
        {layout.width && layout.height ? (
          <TerminalInteractionLayer
            altScreen={false}
            height={layout.height}
            metrics={metrics}
            onCopy={() => void copyDiagnosticText()}
            onCycleTab={(direction) => setStatus(`Tab swipe: ${direction > 0 ? "next" : "previous"}`)}
            onFocusInput={onFocusInput}
            onSend={(message) => {
              if (message.t === "scroll") {
                setStatus(`Scroll delivered: ${message.deltaLines > 0 ? "+" : ""}${message.deltaLines} lines`);
                return;
              }
              if (message.t === "scrollToBottom") {
                setStatus("Pulled past bottom: snapped to live.");
                return;
              }
              if (message.t !== "selection") return;
              if (message.action === "clear") {
                setSelection({ active: false });
                setStatus("Selection cleared.");
                return;
              }
              if (message.action === "all") {
                setSelection({
                  active: true,
                  endPx: { x: Math.max(32, layout.width - 24), y: Math.max(50, layout.height - 20) },
                  startPx: { x: 16, y: 24 },
                  text: "wmux touch diagnostic selected all",
                });
                setStatus("Select all delivered.");
                return;
              }
              if (message.action === "word" || message.action === "line") {
                const x = message.action === "line" ? 12 : Math.max(12, (message.xPx ?? 40) - 24);
                setSelection({
                  active: true,
                  endPx: {
                    x: message.action === "line" ? Math.max(60, layout.width - 16) : x + 72,
                    y: (message.yPx ?? 42) + 18,
                  },
                  startPx: { x, y: message.yPx ?? 42 },
                  text: message.action === "line" ? "selected terminal line" : "selected",
                });
                setStatus(`${message.action === "word" ? "Double" : "Triple"} tap delivered.`);
                return;
              }
              const point = { x: message.xPx ?? 20, y: message.yPx ?? 38 };
              if (message.action === "start") {
                anchorRef.current = point;
                return;
              }
              setSelection({
                active: true,
                endPx: {
                  x: Math.max(anchorRef.current.x, point.x) + 8,
                  y: Math.max(anchorRef.current.y, point.y) + 18,
                },
                startPx: {
                  x: Math.min(anchorRef.current.x, point.x),
                  y: Math.min(anchorRef.current.y, point.y),
                },
                text: "native selection diagnostic",
              });
              setStatus(message.action === "end" ? "Selection handles active." : "Selection moving.");
            }}
            paneId="diagnostic-pane"
            selection={selection}
            width={layout.width}
          />
        ) : null}
      </View>
      <Text numberOfLines={1} style={styles.touchDiagnosticStatus}>
        {status}
      </Text>
      <View style={styles.touchDiagnosticActions}>
        <SecondaryButton compact label="Copy sample" onPress={() => void copyDiagnosticText()} />
        <SecondaryButton compact label="Paste test" onPress={() => void pasteDiagnosticText()} />
      </View>
    </View>
  );
}

function NavigationDiagnosticsCard({ isLandscape, onClose }: { isLandscape: boolean; onClose: () => void }) {
  const [bootstrap, setBootstrap] = useState(navigationFixture);
  const [lastAction, setLastAction] = useState("Open the drawer, switch tabs, select a pane, or use the action sheet.");
  const [preference, setPreference] = useState<NavigationSelection | null>(null);
  const navigation = useMemo(() => resolveNavigation(bootstrap, preference), [bootstrap, preference]);
  const tabSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onPanResponderRelease: (_event, gesture) => {
          if (!navigation || Math.abs(gesture.dx) < 72) return;
          const next = cycleTab(bootstrap, navigation.selection, gesture.dx < 0 ? 1 : -1);
          if (!next) return;
          setPreference(next.selection);
          setLastAction(`Swiped to ${next.tab.title} / ${next.pane.title}`);
        },
        onPanResponderTerminationRequest: () => false,
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
      }),
    [bootstrap, navigation],
  );
  if (!navigation) return null;
  const theme = chromeTheme(bootstrap.settings.colorScheme);

  return (
    <View style={styles.navigationDiagnosticsCard}>
      <View style={styles.navigationDiagnosticsHeader}>
        <View style={styles.navigationDiagnosticsCopy}>
          <Text style={[styles.cardKicker, { color: theme.accent }]}>OFFLINE NAVIGATION DIAGNOSTIC</Text>
          <Text style={[styles.navigationDiagnosticsTitle, { color: theme.text }]}>Workspace chrome</Text>
        </View>
        <SecondaryButton compact label="Done" onPress={onClose} />
      </View>
      <WorkspaceChrome
        bootstrap={bootstrap}
        isLandscape={isLandscape}
        navigation={navigation}
        onAction={(action) => setLastAction(`Action reached: ${action.type.replaceAll("-", " ")}`)}
        onNavigate={(next) => {
          setPreference(next.selection);
          setLastAction(`Selected ${next.workspace.name} / ${next.tab.title} / ${next.pane.title}`);
        }}
        onOpenDiagnostics={() => setLastAction("Diagnostics action reached")}
        onUpdateSettings={(settings) => {
          setBootstrap((current) => ({
            ...current,
            revision: current.revision + 1,
            settings,
          }));
          setLastAction(`Applied ${settings.colorScheme} at ${settings.terminalFontSize}px`);
        }}
      >
        <View
          accessibilityLabel="Swipe horizontally to change terminal tabs"
          style={[styles.navigationTerminal, { backgroundColor: theme.canvas, borderColor: theme.line }]}
        >
          <View style={styles.gestureOverlay} {...tabSwipeResponder.panHandlers} />
          <Text style={[styles.navigationTerminalKicker, { color: theme.muted }]}>
            {navigation.pane.machineId} · {navigation.pane.status}
          </Text>
          <Text style={[styles.navigationPrompt, { color: theme.text }]}>
            <Text style={{ color: theme.accent }}>wmux</Text> {navigation.workspace.name} %{" "}
            <Text style={{ color: theme.muted }}>
              {navigation.tab.title}/{navigation.pane.title}
            </Text>
          </Text>
          <Text style={[styles.navigationTerminalCopy, { color: theme.muted }]}>{lastAction}</Text>
        </View>
      </WorkspaceChrome>
    </View>
  );
}

interface EndpointCardProps {
  endpoint: string;
  error: string | null;
  isBusy: boolean;
  onEndpointChange: (value: string) => void;
  onSubmit: () => void;
  phase: ConnectionPhase;
}

function EndpointCard({ endpoint, error, isBusy, onEndpointChange, onSubmit, phase }: EndpointCardProps) {
  const progress =
    phase === "restoring"
      ? "Restoring your saved connection…"
      : phase === "probing"
        ? "Checking the private endpoint…"
        : phase === "connecting"
          ? "Loading wmux state…"
          : null;

  return (
    <View style={styles.formCard}>
      <Text style={styles.cardKicker}>PRIVATE CONNECTION</Text>
      <Text style={styles.cardTitle}>Connect to your wmux host</Text>
      <Text style={styles.cardCopy}>
        Enter the HTTPS address reachable from this device over Tailscale or your private network.
      </Text>

      <Text style={styles.fieldLabel}>SERVER URL</Text>
      <TextInput
        accessibilityLabel="wmux server URL"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isBusy}
        keyboardType="url"
        onChangeText={onEndpointChange}
        onSubmitEditing={onSubmit}
        placeholder="https://wmux-host.tailnet.ts.net:3478"
        placeholderTextColor={colors.muted}
        returnKeyType="go"
        selectionColor={colors.accent}
        style={styles.input}
        value={endpoint}
      />

      {error ? <InlineMessage message={error} tone="danger" /> : null}
      {progress ? (
        <View style={styles.progressRow}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.progressText}>{progress}</Text>
        </View>
      ) : null}

      <PrimaryButton disabled={isBusy} label="Connect securely" onPress={onSubmit} />
      <Text style={styles.securityNote}>
        Tokens are stored in Keychain or Android Keystore. Passwords are never saved.
      </Text>
    </View>
  );
}

interface AuthenticationCardProps {
  accessToken: string;
  authMode: "login" | "token";
  endpoint: string;
  error: string | null;
  isLandscape: boolean;
  loginEnabled: boolean;
  onAccessTokenChange: (value: string) => void;
  onAuthModeChange: (mode: "login" | "token") => void;
  onChangeServer: () => void;
  onPasswordChange: (value: string) => void;
  onSubmitLogin: () => void;
  onSubmitToken: () => void;
  onUsernameChange: (value: string) => void;
  password: string;
  username: string;
}

function AuthenticationCard(props: AuthenticationCardProps) {
  const tokenMode = props.authMode === "token" || !props.loginEnabled;
  return (
    <View style={[styles.formCard, props.isLandscape && styles.formCardLandscape]}>
      <Text style={styles.cardKicker}>AUTHENTICATION</Text>
      <Text style={[styles.cardTitle, props.isLandscape && styles.cardTitleLandscape]}>Sign in to wmux</Text>
      <Text numberOfLines={1} style={styles.endpointLabel}>
        {props.endpoint}
      </Text>

      {props.loginEnabled ? (
        <View style={styles.segmentedControl}>
          <SegmentButton active={!tokenMode} label="Password" onPress={() => props.onAuthModeChange("login")} />
          <SegmentButton active={tokenMode} label="Access token" onPress={() => props.onAuthModeChange("token")} />
        </View>
      ) : null}

      {tokenMode ? (
        <>
          <Text style={styles.fieldLabel}>ACCESS TOKEN</Text>
          <TextInput
            accessibilityLabel="wmux access token"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={props.onAccessTokenChange}
            onSubmitEditing={props.onSubmitToken}
            placeholder="Paste the server access token"
            placeholderTextColor={colors.muted}
            returnKeyType="go"
            secureTextEntry
            selectionColor={colors.accent}
            style={[styles.input, props.isLandscape && styles.inputLandscape]}
            value={props.accessToken}
          />
        </>
      ) : (
        <View style={[styles.authFieldRow, !props.isLandscape && styles.authFieldRowStacked]}>
          <View style={styles.authField}>
            <Text style={styles.fieldLabel}>USERNAME</Text>
            <TextInput
              accessibilityLabel="wmux username"
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect={false}
              onChangeText={props.onUsernameChange}
              placeholder="Username"
              placeholderTextColor={colors.muted}
              returnKeyType="next"
              selectionColor={colors.accent}
              style={[styles.input, props.isLandscape && styles.inputLandscape]}
              textContentType="username"
              value={props.username}
            />
          </View>
          <View style={styles.authField}>
            <Text style={styles.fieldLabel}>PASSWORD</Text>
            <TextInput
              accessibilityLabel="wmux password"
              autoCapitalize="none"
              autoComplete="current-password"
              autoCorrect={false}
              onChangeText={props.onPasswordChange}
              onSubmitEditing={props.onSubmitLogin}
              placeholder="Password"
              placeholderTextColor={colors.muted}
              returnKeyType="go"
              secureTextEntry
              selectionColor={colors.accent}
              style={[styles.input, props.isLandscape && styles.inputLandscape]}
              textContentType="password"
              value={props.password}
            />
          </View>
        </View>
      )}

      {props.error ? <InlineMessage message={props.error} tone="danger" /> : null}
      <View style={[styles.authActionRow, !props.isLandscape && styles.authActionRowStacked]}>
        <View style={styles.authAction}>
          <PrimaryButton
            label={tokenMode ? "Use access token" : "Sign in"}
            onPress={tokenMode ? props.onSubmitToken : props.onSubmitLogin}
          />
        </View>
        <View style={styles.authAction}>
          <SecondaryButton label="Change server" onPress={props.onChangeServer} />
        </View>
      </View>
    </View>
  );
}

interface DashboardProps {
  accessToken: string | undefined;
  bootstrap: BootstrapPayload;
  endpoint: string;
  error: string | null;
  isLandscape: boolean;
  mutationBusy: boolean;
  navigation: ResolvedNavigation;
  onAction: (action: WorkspaceAction) => void;
  onClipboardNotice: (message: string) => void;
  onFocusInput: () => void;
  onForget: () => void;
  onNavigate: (navigation: ResolvedNavigation) => void;
  onOpenDiagnostics: () => void;
  onRetry: () => void;
  onUpdateSettings: (settings: WmuxSettings) => void;
  phase: "connected" | "reconnecting";
  protocolKind: "legacy" | "verified";
  terminalRef: RefObject<TerminalSurfaceHandle | null>;
}

function Dashboard({
  accessToken,
  bootstrap,
  endpoint,
  error,
  isLandscape,
  mutationBusy,
  navigation,
  onAction,
  onClipboardNotice,
  onFocusInput,
  onForget,
  onNavigate,
  onOpenDiagnostics,
  onRetry,
  onUpdateSettings,
  phase,
  protocolKind,
  terminalRef,
}: DashboardProps) {
  const paneCount = useMemo(
    () =>
      bootstrap.workspaces.reduce(
        (workspaceTotal, workspace) =>
          workspaceTotal + workspace.tabs.reduce((tabTotal, tab) => tabTotal + tab.panes.length, 0),
        0,
      ),
    [bootstrap.workspaces],
  );

  return (
    <WorkspaceChrome
      bootstrap={bootstrap}
      edgeSwipeEnabled
      isLandscape={isLandscape}
      mutationBusy={mutationBusy}
      navigation={navigation}
      onAction={onAction}
      onNavigate={onNavigate}
      onOpenDiagnostics={onOpenDiagnostics}
      onUpdateSettings={onUpdateSettings}
    >
      <ConnectionBanner endpoint={endpoint} phase={phase} revision={bootstrap.revision} />
      {error ? <InlineMessage message={error} tone="danger" /> : null}
      <View style={styles.metricGrid}>
        <MetricCard label="WORKSPACES" value={bootstrap.workspaces.length} />
        <MetricCard label="PANES" value={paneCount} />
        <MetricCard label="HOSTS ONLINE" value={bootstrap.machines.filter((machine) => machine.reachable).length} />
      </View>

      <LiveTerminalCard
        accessToken={accessToken}
        bootstrap={bootstrap}
        endpoint={endpoint}
        isLandscape={isLandscape}
        key={navigation.pane.id}
        navigation={navigation}
        onClipboardNotice={onClipboardNotice}
        onCycleTab={(direction) => {
          const next = cycleTab(bootstrap, navigation.selection, direction);
          if (next) onNavigate(next);
        }}
        onFocusInput={onFocusInput}
        terminalRef={terminalRef}
      />

      <View style={styles.dashboardColumn}>
        <SectionHeader count={bootstrap.machines.length} title="Machines" />
        <View style={styles.listCard}>
          {bootstrap.machines.length ? (
            bootstrap.machines.map((machine) => <MachineRow key={machine.id} machine={machine} />)
          ) : (
            <EmptyRow message="No machines are configured." />
          )}
        </View>
      </View>

      <View style={styles.sessionFooter}>
        <View style={styles.sessionCopy}>
          <Text style={styles.sessionTitle}>Secure session stored on this device</Text>
          <Text style={styles.sessionMeta}>
            {protocolKind === "verified"
              ? "Protocol verified · live event stream"
              : "Legacy protocol endpoint · live event stream"}
          </Text>
        </View>
        <View style={styles.footerActions}>
          <SecondaryButton compact label="Refresh" onPress={onRetry} />
          <SecondaryButton compact label="Forget" onPress={onForget} tone="danger" />
        </View>
      </View>
    </WorkspaceChrome>
  );
}

function LiveTerminalCard({
  accessToken,
  bootstrap,
  endpoint,
  isLandscape,
  navigation,
  onClipboardNotice,
  onCycleTab,
  onFocusInput,
  terminalRef,
}: {
  accessToken: string | undefined;
  bootstrap: BootstrapPayload;
  endpoint: string;
  isLandscape: boolean;
  navigation: ResolvedNavigation;
  onClipboardNotice: (message: string) => void;
  onCycleTab: (direction: -1 | 1) => void;
  onFocusInput: () => void;
  terminalRef: RefObject<TerminalSurfaceHandle | null>;
}) {
  const [altScreen, setAltScreen] = useState(false);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const [cursor, setCursor] = useState<TerminalCursor>();
  const [metrics, setMetrics] = useState<TerminalMetrics>();
  const [paneConnection, setPaneConnection] = useState<"connecting" | "live" | "lost" | "exited">("connecting");
  const [paneIssue, setPaneIssue] = useState<string | undefined>();
  const [selection, setSelection] = useState<TerminalSelection>({ active: false });
  const [terminalSize, setTerminalSize] = useState({ height: 0, width: 0 });
  const mountedRef = useRef(true);
  const paneId = navigation.pane.id;
  const api = useMemo(() => new WmuxApiClient(endpoint, accessToken), [accessToken, endpoint]);
  const terminalSession = useMemo<TerminalSurfaceSession>(
    () => ({
      paneId,
      serverUrl: endpoint,
      settings: {
        colorScheme: normalizeTerminalColorScheme(bootstrap.settings.colorScheme),
        terminalFontSize: bootstrap.settings.terminalFontSize,
        terminalScrollMode: bootstrap.settings.terminalScrollMode,
        terminalScrollbackRows: bootstrap.settings.terminalScrollbackRows,
        tuiFrameRate: bootstrap.settings.tuiFrameRate,
      },
      token: accessToken ?? "",
    }),
    [
      accessToken,
      bootstrap.settings.colorScheme,
      bootstrap.settings.terminalFontSize,
      bootstrap.settings.terminalScrollMode,
      bootstrap.settings.terminalScrollbackRows,
      bootstrap.settings.tuiFrameRate,
      endpoint,
      paneId,
    ],
  );

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const send = useCallback(
    (message: Parameters<TerminalSurfaceHandle["send"]>[0]): void => {
      terminalRef.current?.send(message);
    },
    [terminalRef],
  );

  const copyText = useCallback(
    async (text: string, notice: string): Promise<void> => {
      if (!text) {
        onClipboardNotice("The terminal selection is empty");
        return;
      }
      try {
        await writeNativeClipboardText(text);
        if (mountedRef.current) onClipboardNotice(notice);
      } catch {
        if (mountedRef.current) setPaneIssue("Could not write to the system clipboard.");
      }
    },
    [onClipboardNotice],
  );

  const pasteText = useCallback(async (): Promise<void> => {
    if (clipboardBusy) return;
    setClipboardBusy(true);
    try {
      const text = await readNativeClipboardText();
      if (!mountedRef.current) return;
      if (!text) {
        onClipboardNotice("Clipboard has no text");
        return;
      }
      send({ t: "paste", paneId, text });
      setSelection({ active: false });
      onClipboardNotice("Clipboard pasted");
    } catch {
      if (mountedRef.current) setPaneIssue("Could not read text from the system clipboard.");
    } finally {
      if (mountedRef.current) setClipboardBusy(false);
    }
  }, [clipboardBusy, onClipboardNotice, paneId, send]);

  const pasteClipboardImage = useCallback(async (): Promise<void> => {
    if (clipboardBusy) return;
    setClipboardBusy(true);
    let stagedId: string | undefined;
    try {
      const image = await readNativeClipboardImage();
      if (!image) {
        onClipboardNotice("Clipboard has no image");
        return;
      }
      base64FromDataUrl(image.dataUrl);
      const response = await fetch(image.dataUrl);
      const staged = await api.stagePanePasteImage(paneId, await response.blob());
      stagedId = staged.stageId;
      if (!mountedRef.current) {
        await api.discardPanePasteImage(paneId, staged.stageId).catch(() => undefined);
        return;
      }
      send({ t: "paste", paneId, text: quoteStagedImagePath(staged.targetPath) });
      onClipboardNotice(`Image staged for ${navigation.pane.title}`);
    } catch (error) {
      if (stagedId) await api.discardPanePasteImage(paneId, stagedId).catch(() => undefined);
      if (mountedRef.current) {
        setPaneIssue(error instanceof Error ? `Image paste failed: ${error.message}` : "Image paste failed.");
      }
    } finally {
      if (mountedRef.current) setClipboardBusy(false);
    }
  }, [api, clipboardBusy, navigation.pane.title, onClipboardNotice, paneId, send]);

  const attachPhotos = useCallback(async (): Promise<void> => {
    if (clipboardBusy) return;
    setClipboardBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        base64: true,
        mediaTypes: ["images"],
        quality: 0.95,
        selectionLimit: 4,
      });
      if (result.canceled || !mountedRef.current) return;
      const urls: string[] = [];
      for (const [index, asset] of result.assets.entries()) {
        if (!asset.base64) throw new Error("The selected image could not be read");
        const uploaded = await api.uploadPaneAttachment(paneId, {
          data: asset.base64,
          mimeType: "image/jpeg",
          name: asset.fileName?.replace(/\.[^.]+$/, ".jpg") || `terminal-photo-${index + 1}.jpg`,
        });
        urls.push(new URL(uploaded.attachment.url, `${endpoint}/`).toString());
      }
      if (!mountedRef.current) return;
      send({ t: "paste", paneId, text: urls.join(" ") });
      onClipboardNotice(`${urls.length} attachment${urls.length === 1 ? "" : "s"} uploaded`);
    } catch (error) {
      if (mountedRef.current) {
        setPaneIssue(error instanceof Error ? `Attachment failed: ${error.message}` : "Attachment upload failed.");
      }
    } finally {
      if (mountedRef.current) setClipboardBusy(false);
    }
  }, [api, clipboardBusy, endpoint, onClipboardNotice, paneId, send]);

  const openMediaActions = useCallback((): void => {
    Alert.alert("Terminal media", "Paste an image from the system clipboard or upload photos as pane attachments.", [
      { style: "cancel", text: "Cancel" },
      { onPress: () => void pasteClipboardImage(), text: "Paste clipboard image" },
      { onPress: () => void attachPhotos(), text: "Attach photos" },
    ]);
  }, [attachPhotos, pasteClipboardImage]);

  const handleTerminalLayout = useCallback((event: LayoutChangeEvent): void => {
    const { height, width } = event.nativeEvent.layout;
    setTerminalSize((current) => (current.height === height && current.width === width ? current : { height, width }));
  }, []);

  return (
    <View style={styles.terminalCard}>
      <View style={styles.terminalHeader}>
        <View style={styles.terminalHeaderCopy}>
          <Text numberOfLines={1} style={styles.terminalTitle}>
            {navigation.tab.title}
          </Text>
          <Text numberOfLines={1} style={styles.terminalMeta}>
            {navigation.workspace.name} · {navigation.pane.title}
          </Text>
        </View>
        <View style={styles.terminalTools}>
          <TerminalToolButton busy={clipboardBusy} label="Paste" onPress={() => void pasteText()} />
          <TerminalToolButton busy={clipboardBusy} label="Media" onPress={openMediaActions} />
        </View>
        <View style={styles.terminalState}>
          <View
            style={[
              styles.liveIndicator,
              paneConnection !== "live" && styles.liveIndicatorWarning,
              paneConnection === "lost" && styles.liveIndicatorLost,
            ]}
          />
          <Text style={styles.terminalStateText}>{paneConnection}</Text>
        </View>
      </View>
      <View onLayout={handleTerminalLayout} style={styles.terminalGestureSurface}>
        <TerminalSurface
          onMessage={(message) => {
            if ("paneId" in message && message.paneId !== terminalSession.paneId) return;
            if (message.t === "pane") {
              setPaneConnection(message.state);
              setPaneIssue(message.issue);
            }
            if (message.t === "altScreen") setAltScreen(message.active);
            if (message.t === "metrics") {
              setMetrics({
                cellH: message.cellH,
                cellW: message.cellW,
                cols: message.cols,
                rows: message.rows,
              });
            }
            if (message.t === "cursor") {
              setCursor({ visible: message.visible, xPx: message.xPx, yPx: message.yPx });
            }
            if (message.t === "selection") {
              setSelection({
                active: message.active,
                ...(message.startPx ? { startPx: message.startPx } : {}),
                ...(message.endPx ? { endPx: message.endPx } : {}),
                ...(message.text === undefined ? {} : { text: message.text }),
              });
              if (message.active && message.text !== undefined) {
                void copyText(message.text, "Terminal selection copied");
              }
            }
            if (message.t === "osc52") void copyText(message.text, "Terminal copied with OSC 52");
          }}
          ref={terminalRef}
          session={terminalSession}
          style={[styles.liveTerminalSurface, isLandscape && styles.liveTerminalSurfaceLandscape]}
        />
        {terminalSize.width > 0 && terminalSize.height > 0 ? (
          <TerminalInteractionLayer
            altScreen={altScreen}
            height={terminalSize.height}
            onCopy={() => send({ t: "copySelection", paneId })}
            onCycleTab={onCycleTab}
            onFocusInput={onFocusInput}
            onSend={send}
            paneId={paneId}
            selection={selection}
            width={terminalSize.width}
            {...(cursor ? { cursor } : {})}
            {...(metrics ? { metrics } : {})}
          />
        ) : null}
      </View>
      {paneIssue ? <Text style={styles.terminalIssue}>{paneIssue}</Text> : null}
    </View>
  );
}

function TerminalToolButton({ busy, label, onPress }: { busy: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`${label} in terminal`}
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.terminalToolButton,
        pressed && styles.buttonPressed,
        busy && styles.buttonDisabled,
      ]}
    >
      <Text style={styles.terminalToolButtonText}>{label}</Text>
    </Pressable>
  );
}

function ClipboardToast({ message }: { message: string }) {
  return (
    <View accessibilityLiveRegion="polite" pointerEvents="none" style={styles.clipboardToast}>
      <View style={styles.clipboardToastDot} />
      <Text numberOfLines={2} style={styles.clipboardToastText}>
        {message}
      </Text>
    </View>
  );
}

function ConnectionBanner({
  endpoint,
  phase,
  revision,
}: {
  endpoint: string;
  phase: "connected" | "reconnecting";
  revision: number;
}) {
  const isConnected = phase === "connected";
  return (
    <View style={[styles.connectionBanner, !isConnected && styles.connectionBannerWarning]}>
      <View style={[styles.liveIndicator, !isConnected && styles.liveIndicatorWarning]} />
      <View style={styles.connectionCopy}>
        <Text style={styles.connectionTitle}>{isConnected ? "Live on Tailscale" : "Reconnecting"}</Text>
        <Text numberOfLines={1} style={styles.connectionEndpoint}>
          {endpoint}
        </Text>
      </View>
      <Text style={styles.connectionRevision}>r{revision}</Text>
    </View>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function SectionHeader({ count, title }: { count: number; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );
}

function MachineRow({ machine }: { machine: MachineStatus }) {
  return (
    <View style={styles.listRow}>
      <View style={[styles.machineDot, machine.reachable ? styles.machineOnline : styles.machineOffline]} />
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {machine.name}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {machine.platform} · {machine.kind}
        </Text>
      </View>
      <Text style={[styles.machineState, !machine.reachable && styles.machineStateOffline]}>
        {machine.reachable ? "online" : "offline"}
      </Text>
    </View>
  );
}

function EmptyRow({ message }: { message: string }) {
  return <Text style={styles.emptyRow}>{message}</Text>;
}

interface MessageCardProps {
  actionLabel: string;
  eyebrow: string;
  message: string;
  onAction: () => void;
  onSecondary: () => void;
  secondaryLabel: string;
  title: string;
  tone: "danger";
}

function MessageCard(props: MessageCardProps) {
  return (
    <View style={styles.formCard}>
      <Text style={[styles.cardKicker, props.tone === "danger" && styles.dangerText]}>{props.eyebrow}</Text>
      <Text style={styles.cardTitle}>{props.title}</Text>
      <Text style={styles.cardCopy}>{props.message}</Text>
      <PrimaryButton label={props.actionLabel} onPress={props.onAction} />
      <SecondaryButton label={props.secondaryLabel} onPress={props.onSecondary} />
    </View>
  );
}

function InlineMessage({ message, tone }: { message: string; tone: "danger" }) {
  return (
    <View style={[styles.inlineMessage, tone === "danger" && styles.inlineMessageDanger]}>
      <Text style={[styles.inlineMessageText, tone === "danger" && styles.dangerText]}>{message}</Text>
    </View>
  );
}

function PrimaryButton({
  compact = false,
  disabled = false,
  label,
  onPress,
}: {
  compact?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        compact && styles.primaryButtonCompact,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  compact = false,
  label,
  onPress,
  tone = "normal",
}: {
  compact?: boolean;
  label: string;
  onPress: () => void;
  tone?: "danger" | "normal";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        compact && styles.secondaryButtonCompact,
        tone === "danger" && styles.secondaryButtonDanger,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.secondaryButtonText, tone === "danger" && styles.dangerText]}>{label}</Text>
    </Pressable>
  );
}

function SegmentButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.segmentButton, active && styles.segmentButtonActive]}
    >
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  screen: {
    alignSelf: "center",
    flexGrow: 1,
    gap: 20,
    maxWidth: 920,
    paddingBottom: 20,
    paddingHorizontal: 20,
    paddingTop: 14,
    width: "100%",
  },
  screenLandscape: {
    gap: 14,
    paddingHorizontal: 28,
    paddingTop: 8,
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 52,
  },
  brandMark: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 9,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  brandGlyph: {
    color: colors.canvas,
    fontFamily: fonts.mono,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -2,
    marginLeft: -2,
    marginTop: -1,
  },
  brandCopy: {
    flex: 1,
    marginLeft: 12,
  },
  eyebrow: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.7,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.4,
    marginTop: 3,
  },
  diagnosticsButton: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    height: 40,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  diagnosticsButtonDevelopment: {
    marginRight: 46,
  },
  diagnosticsGlyph: {
    color: colors.secondaryText,
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: -1,
  },
  statusDot: {
    borderRadius: 5,
    borderWidth: 3,
    height: 10,
    width: 10,
  },
  statusDotLive: {
    backgroundColor: colors.success,
    borderColor: colors.successDim,
  },
  statusDotIdle: {
    backgroundColor: colors.muted,
    borderColor: colors.line,
  },
  formCard: {
    alignSelf: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    maxWidth: 540,
    padding: 20,
    width: "100%",
  },
  formCardLandscape: {
    gap: 8,
    padding: 14,
  },
  diagnosticsCard: {
    maxWidth: 760,
  },
  diagnosticsCardLandscape: {
    gap: 5,
    paddingVertical: 10,
  },
  diagnosticsCardInputFocused: {
    gap: 6,
    padding: 14,
  },
  diagnosticsCardCopyLandscape: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 0,
  },
  diagnosticsSurface: {
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    height: 220,
    minHeight: 220,
  },
  diagnosticsSurfaceLandscape: {
    height: 48,
    minHeight: 48,
  },
  diagnosticsSurfaceInputFocused: {
    height: 48,
    minHeight: 48,
  },
  diagnosticsStatus: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 13,
  },
  diagnosticsStatusReady: {
    backgroundColor: colors.successDim,
    borderColor: "#285f42",
  },
  diagnosticsStatusPending: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accentLine,
  },
  diagnosticsStatusLandscape: {
    minHeight: 36,
  },
  diagnosticsStatusInputFocused: {
    minHeight: 36,
  },
  diagnosticsStatusText: {
    color: colors.secondaryText,
    flex: 1,
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 16,
  },
  diagnosticsStatusTextReady: {
    color: colors.success,
  },
  inputDiagnostic: {
    backgroundColor: colors.terminal,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    minHeight: 66,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  inputDiagnosticHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  inputDiagnosticLandscape: {
    minHeight: 46,
    paddingVertical: 6,
  },
  inputDiagnosticTitle: {
    color: colors.secondaryText,
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  inputDiagnosticFocus: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "800",
  },
  inputDiagnosticFocusActive: {
    color: colors.success,
  },
  inputDiagnosticEvent: {
    color: colors.terminalText,
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 14,
  },
  inputDiagnosticEmpty: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 15,
  },
  touchDiagnostic: {
    backgroundColor: colors.terminal,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    gap: 7,
    padding: 10,
  },
  touchDiagnosticBadge: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "900",
  },
  touchDiagnosticTerminal: {
    backgroundColor: "#090c11",
    borderColor: "#252b36",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 118,
    overflow: "hidden",
    padding: 14,
    position: "relative",
  },
  touchDiagnosticPrompt: {
    color: colors.terminalText,
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 18,
  },
  touchDiagnosticAccent: {
    color: colors.accent,
    fontWeight: "800",
  },
  touchDiagnosticLine: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 9,
    lineHeight: 18,
  },
  touchDiagnosticStatus: {
    color: colors.secondaryText,
    fontFamily: fonts.mono,
    fontSize: 9,
  },
  touchDiagnosticActions: {
    flexDirection: "row",
    gap: 8,
  },
  diagnosticsActions: {
    flexDirection: "row",
    gap: 10,
  },
  diagnosticsAction: {
    flex: 1,
  },
  navigationDiagnosticsCard: {
    alignSelf: "center",
    gap: 12,
    maxWidth: 840,
    width: "100%",
  },
  navigationDiagnosticsHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  navigationDiagnosticsCopy: {
    flex: 1,
  },
  navigationDiagnosticsTitle: {
    fontSize: 22,
    fontWeight: "800",
    marginTop: 3,
  },
  navigationTerminal: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 9,
    minHeight: 210,
    padding: 18,
  },
  navigationTerminalKicker: {
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  navigationPrompt: {
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 19,
  },
  navigationTerminalCopy: {
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 17,
  },
  gestureOverlay: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 2,
  },
  cardKicker: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  cardTitleLandscape: {
    fontSize: 20,
  },
  cardCopy: {
    color: colors.secondaryText,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  endpointLabel: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 11,
    marginBottom: 4,
  },
  fieldLabel: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.15,
    marginTop: 5,
  },
  input: {
    backgroundColor: colors.terminal,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 14,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputLandscape: {
    minHeight: 42,
    paddingVertical: 8,
  },
  authFieldRow: {
    flexDirection: "row",
    gap: 10,
  },
  authFieldRowStacked: {
    flexDirection: "column",
    gap: 7,
  },
  authField: {
    flex: 1,
    gap: 7,
  },
  authActionRow: {
    flexDirection: "row",
    gap: 10,
  },
  authActionRowStacked: {
    flexDirection: "column",
    gap: 12,
  },
  authAction: {
    flex: 1,
  },
  progressRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    minHeight: 28,
  },
  progressText: {
    color: colors.secondaryText,
    fontSize: 13,
  },
  securityNote: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
  inlineMessage: {
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineMessageDanger: {
    backgroundColor: "#30191a",
    borderColor: "#633032",
  },
  inlineMessageText: {
    fontSize: 12,
    lineHeight: 17,
  },
  dangerText: {
    color: "#ff8d87",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 49,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: colors.canvas,
    fontSize: 14,
    fontWeight: "800",
  },
  primaryButtonCompact: {
    minHeight: 36,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 45,
    paddingHorizontal: 16,
  },
  secondaryButtonCompact: {
    minHeight: 36,
    paddingHorizontal: 12,
  },
  secondaryButtonDanger: {
    borderColor: "#633032",
  },
  secondaryButtonText: {
    color: colors.secondaryText,
    fontSize: 13,
    fontWeight: "700",
  },
  buttonPressed: {
    opacity: 0.72,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  segmentedControl: {
    backgroundColor: colors.terminal,
    borderRadius: 10,
    flexDirection: "row",
    padding: 3,
  },
  segmentButton: {
    alignItems: "center",
    borderRadius: 8,
    flex: 1,
    minHeight: 36,
    justifyContent: "center",
  },
  segmentButtonActive: {
    backgroundColor: colors.line,
  },
  segmentText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  segmentTextActive: {
    color: colors.text,
  },
  connectionBanner: {
    alignItems: "center",
    backgroundColor: colors.successDim,
    borderColor: "#285b40",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 58,
    paddingHorizontal: 14,
  },
  connectionBannerWarning: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accentLine,
  },
  liveIndicator: {
    backgroundColor: colors.success,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  liveIndicatorWarning: {
    backgroundColor: colors.accent,
  },
  liveIndicatorLost: {
    backgroundColor: "#ef7770",
  },
  connectionCopy: {
    flex: 1,
    marginHorizontal: 11,
  },
  connectionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  connectionEndpoint: {
    color: colors.secondaryText,
    fontFamily: fonts.mono,
    fontSize: 10,
    marginTop: 3,
  },
  connectionRevision: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 10,
  },
  metricGrid: {
    flexDirection: "row",
    gap: 10,
  },
  metricCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  metricValue: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 24,
    fontWeight: "800",
  },
  metricLabel: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.9,
    marginTop: 5,
  },
  terminalCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  terminalGestureSurface: {
    position: "relative",
  },
  terminalHeader: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 54,
    paddingHorizontal: 14,
  },
  terminalHeaderCopy: {
    flex: 1,
    minWidth: 60,
  },
  terminalTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  terminalMeta: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 10,
    marginTop: 3,
  },
  terminalState: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    marginLeft: 10,
  },
  terminalStateText: {
    color: colors.secondaryText,
    fontFamily: fonts.mono,
    fontSize: 10,
    textTransform: "uppercase",
  },
  terminalTools: {
    flexDirection: "row",
    gap: 5,
    marginLeft: 8,
  },
  terminalToolButton: {
    backgroundColor: colors.terminal,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 32,
    minWidth: 50,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  terminalToolButtonText: {
    color: colors.secondaryText,
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center",
    textTransform: "uppercase",
  },
  liveTerminalSurface: {
    height: 360,
    minHeight: 360,
  },
  liveTerminalSurfaceLandscape: {
    height: 280,
    minHeight: 280,
  },
  terminalIssue: {
    backgroundColor: "#30191a",
    color: "#ff8d87",
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 15,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  clipboardToast: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#171b22f5",
    borderColor: colors.accentLine,
    borderRadius: 12,
    borderWidth: 1,
    bottom: 14,
    flexDirection: "row",
    gap: 9,
    maxWidth: 360,
    minHeight: 44,
    paddingHorizontal: 14,
    position: "absolute",
    zIndex: 50,
  },
  clipboardToastDot: {
    backgroundColor: colors.success,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  clipboardToastText: {
    color: colors.text,
    flexShrink: 1,
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "700",
  },
  dashboardColumns: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 14,
  },
  dashboardColumnsStacked: {
    flexDirection: "column",
  },
  dashboardColumn: {
    flex: 1,
    width: "100%",
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  sectionCount: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  listCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 13,
    borderWidth: 1,
    overflow: "hidden",
  },
  listRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 58,
    paddingHorizontal: 13,
  },
  workspaceIcon: {
    alignItems: "center",
    backgroundColor: colors.accentDim,
    borderRadius: 8,
    height: 32,
    justifyContent: "center",
    width: 36,
  },
  workspaceGlyph: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "800",
  },
  machineDot: {
    borderRadius: 5,
    height: 10,
    marginHorizontal: 10,
    width: 10,
  },
  machineOnline: {
    backgroundColor: colors.success,
  },
  machineOffline: {
    backgroundColor: colors.muted,
  },
  rowCopy: {
    flex: 1,
    marginLeft: 10,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  rowMeta: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 10,
    marginTop: 4,
  },
  machineState: {
    color: colors.success,
    fontFamily: fonts.mono,
    fontSize: 10,
  },
  machineStateOffline: {
    color: colors.muted,
  },
  emptyRow: {
    color: colors.muted,
    fontSize: 13,
    padding: 18,
    textAlign: "center",
  },
  sessionFooter: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  sessionCopy: {
    flex: 1,
  },
  sessionTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
  sessionMeta: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 9,
    marginTop: 4,
  },
  footerActions: {
    flexDirection: "row",
    gap: 8,
  },
});
