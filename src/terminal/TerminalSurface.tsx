import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  PixelRatio,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { decodeToNative, encodeBridgeMessage, type HostSettings, type ToHost, type ToNative } from "@/terminal/bridge";
import { colors, fonts } from "@/ui/theme";

const terminalHostAsset = require("../../dist/terminal-host/index.html") as number;
const diagnosticsBaseUrl = "https://wmux.invalid/";

export type TerminalSurfaceStatus = "loading-asset" | "loading-host" | "ready" | "error";

export interface TerminalSurfaceSession {
  serverUrl: string;
  token: string;
  paneId: string;
  settings: HostSettings;
}

interface TerminalSurfaceProps {
  session?: TerminalSurfaceSession;
  onMessage?: (message: ToNative) => void;
  onStatusChange?: (status: TerminalSurfaceStatus, issue?: string) => void;
  style?: StyleProp<ViewStyle>;
}

export interface TerminalSurfaceHandle {
  activateLink(paneId: string, xPx: number, yPx: number): Promise<string | undefined>;
  send(message: ToHost): void;
}

interface Viewport {
  width: number;
  height: number;
}

interface PendingLinkRequest {
  resolve: (url: string | undefined) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export const TerminalSurface = forwardRef<TerminalSurfaceHandle, TerminalSurfaceProps>(function TerminalSurface(
  { session, onMessage, onStatusChange, style },
  forwardedRef,
) {
  const webViewRef = useRef<WebView>(null);
  const linkRequestIdRef = useRef(0);
  const pendingLinkRequestsRef = useRef(new Map<string, PendingLinkRequest>());
  const [html, setHtml] = useState<string | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const status: TerminalSurfaceStatus = issue ? "error" : !html ? "loading-asset" : ready ? "ready" : "loading-host";
  const baseUrl = useMemo(() => normalizedBaseUrl(session?.serverUrl ?? diagnosticsBaseUrl), [session?.serverUrl]);

  useEffect(() => {
    onStatusChange?.(status, issue ?? undefined);
  }, [issue, onStatusChange, status]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const asset = Asset.fromModule(terminalHostAsset);
        await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        if (!uri) throw new Error("The terminal host asset is unavailable");
        const contents = await readTerminalHostAsset(uri);
        if (!cancelled) setHtml(contents);
      } catch (error: unknown) {
        if (!cancelled) setIssue(error instanceof Error ? error.message : "Could not load the terminal host");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const post = useCallback((message: ToHost): void => {
    webViewRef.current?.postMessage(encodeBridgeMessage(message));
  }, []);

  const activateLink = useCallback(
    (paneId: string, xPx: number, yPx: number): Promise<string | undefined> => {
      if (!ready) return Promise.resolve(undefined);
      linkRequestIdRef.current += 1;
      const requestId = `link-${linkRequestIdRef.current}`;
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          pendingLinkRequestsRef.current.delete(requestId);
          resolve(undefined);
        }, 750);
        pendingLinkRequestsRef.current.set(requestId, { resolve, timeout });
        post({ t: "activateLink", paneId, requestId, xPx, yPx });
      });
    },
    [post, ready],
  );

  useImperativeHandle(forwardedRef, () => ({ activateLink, send: post }), [activateLink, post]);

  useEffect(
    () => () => {
      for (const request of pendingLinkRequestsRef.current.values()) {
        clearTimeout(request.timeout);
        request.resolve(undefined);
      }
      pendingLinkRequestsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!ready || !session) return;
    post({
      t: "init",
      serverUrl: session.serverUrl,
      token: session.token,
      settings: session.settings,
    });
    post({ t: "attach", paneId: session.paneId });
    post({ t: "show", paneId: session.paneId });
  }, [post, ready, session]);

  useEffect(() => {
    if (!ready || !session || viewport.width <= 0 || viewport.height <= 0) return;
    post({
      t: "viewport",
      paneId: session.paneId,
      widthPx: viewport.width,
      heightPx: viewport.height,
      dpr: PixelRatio.get(),
    });
  }, [post, ready, session, viewport.height, viewport.width]);

  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const { height, width } = event.nativeEvent.layout;
    setViewport((current) => (current.width === width && current.height === height ? current : { width, height }));
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent): void => {
      const decoded = decodeToNative(event.nativeEvent.data);
      if (!decoded.ok) {
        setIssue(`Terminal bridge error: ${decoded.issue}`);
        return;
      }
      if (decoded.value.t === "ready") {
        setReady(true);
        setIssue(null);
      }
      if (decoded.value.t === "link") {
        const request = pendingLinkRequestsRef.current.get(decoded.value.requestId);
        if (request) {
          clearTimeout(request.timeout);
          pendingLinkRequestsRef.current.delete(decoded.value.requestId);
          request.resolve(decoded.value.url);
        }
      }
      if (decoded.value.t === "log" && decoded.value.level === "error") setIssue(decoded.value.message);
      onMessage?.(decoded.value);
    },
    [onMessage],
  );

  return (
    <View onLayout={handleLayout} style={[styles.container, style]}>
      {html ? (
        <WebView
          ref={webViewRef}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          bounces={false}
          cacheEnabled
          contentInsetAdjustmentBehavior="never"
          domStorageEnabled={false}
          hideKeyboardAccessoryView
          incognito
          javaScriptCanOpenWindowsAutomatically={false}
          javaScriptEnabled
          keyboardDisplayRequiresUserAction
          mediaPlaybackRequiresUserAction
          mixedContentMode="never"
          onContentProcessDidTerminate={() => setIssue("The terminal renderer stopped unexpectedly")}
          onMessage={handleMessage}
          onRenderProcessGone={() => setIssue("The terminal renderer process stopped unexpectedly")}
          onShouldStartLoadWithRequest={(request) => allowedNavigation(request.url, baseUrl)}
          originWhitelist={["https://*", "http://*", "about:blank", "data:*"]}
          overScrollMode="never"
          pointerEvents="none"
          scrollEnabled={false}
          setSupportMultipleWindows={false}
          sharedCookiesEnabled={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          source={{ html, baseUrl }}
          style={styles.webView}
          textInteractionEnabled={false}
          thirdPartyCookiesEnabled={false}
          webviewDebuggingEnabled={__DEV__}
        />
      ) : null}
      {status !== "ready" ? <TerminalSurfaceOverlay issue={issue} status={status} /> : null}
    </View>
  );
});

async function readTerminalHostAsset(uri: string): Promise<string> {
  try {
    return await new File(uri).text();
  } catch (fileError: unknown) {
    try {
      return await (await fetch(uri)).text();
    } catch {
      throw fileError;
    }
  }
}

function TerminalSurfaceOverlay({
  issue,
  status,
}: {
  issue: string | null;
  status: Exclude<TerminalSurfaceStatus, "ready">;
}) {
  return (
    <View pointerEvents="none" style={styles.overlay}>
      {status === "error" ? null : <ActivityIndicator color={colors.accent} size="small" />}
      <Text style={[styles.status, status === "error" && styles.error]}>
        {status === "loading-asset"
          ? "Loading offline terminal bundle"
          : status === "loading-host"
            ? "Starting Ghostty renderer"
            : (issue ?? "Terminal renderer unavailable")}
      </Text>
    </View>
  );
}

const normalizedBaseUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return diagnosticsBaseUrl;
  }
};

const allowedNavigation = (value: string, baseUrl: string): boolean => {
  if (value === "about:blank" || value.startsWith("data:text/html")) return true;
  try {
    return new URL(value).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.terminal,
    minHeight: 180,
    overflow: "hidden",
    position: "relative",
  },
  webView: {
    backgroundColor: colors.terminal,
    flex: 1,
    opacity: 0.99,
  },
  overlay: {
    alignItems: "center",
    backgroundColor: colors.terminal,
    bottom: 0,
    gap: 12,
    justifyContent: "center",
    left: 0,
    padding: 24,
    position: "absolute",
    right: 0,
    top: 0,
  },
  status: {
    color: colors.secondaryText,
    fontFamily: fonts.mono,
    fontSize: 12,
    textAlign: "center",
  },
  error: {
    color: "#ef7770",
  },
});
