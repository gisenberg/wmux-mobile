import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { BootstrapPayload } from "../../protocol/wmux";

import { buildChatThread, detectedAgentName, type ChatThreadItem } from "@/chat/model";
import { chromeTheme } from "@/navigation/chrome-theme";
import type { ResolvedNavigation } from "@/navigation/model";
import { colors, fonts } from "@/ui/theme";

interface LocalMessage {
  id: string;
  paneId: string;
  text: string;
  createdAt: string;
  state: "failed" | "sending" | "sent";
}

interface ChatSurfaceProps {
  bootstrap: BootstrapPayload;
  navigation: ResolvedNavigation;
  onOpenTerminal: () => void;
  onSend: (text: string) => Promise<void>;
}

type VisibleThreadItem = ChatThreadItem | { kind: "user"; id: string; createdAt: string; message: LocalMessage };

export function ChatSurface({ bootstrap, navigation, onOpenTerminal, onSend }: ChatSurfaceProps) {
  const [draft, setDraft] = useState("");
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [sendIssue, setSendIssue] = useState<string | null>(null);
  const listRef = useRef<FlatList<VisibleThreadItem>>(null);
  const theme = chromeTheme(bootstrap.settings.colorScheme);
  const agentName = detectedAgentName(navigation.pane, bootstrap.agentEvents);
  const serverItems = useMemo(
    () => buildChatThread(bootstrap, navigation.workspace.id, navigation.pane.id),
    [bootstrap, navigation.pane.id, navigation.workspace.id],
  );
  const items = useMemo<VisibleThreadItem[]>(
    () =>
      [
        ...serverItems,
        ...localMessages
          .filter((message) => message.paneId === navigation.pane.id)
          .map((message) => ({
            kind: "user" as const,
            id: message.id,
            createdAt: message.createdAt,
            message,
          })),
      ].sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt)),
    [localMessages, navigation.pane.id, serverItems],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [items.length, navigation.pane.id]);

  const submit = async (): Promise<void> => {
    const text = draft.trimEnd();
    if (!text.trim() || !agentName || sending) return;
    const id = `local:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const message: LocalMessage = {
      id,
      paneId: navigation.pane.id,
      text,
      createdAt: new Date().toISOString(),
      state: "sending",
    };
    setDraft("");
    setSendIssue(null);
    setSending(true);
    setLocalMessages((current) => [...current, message].slice(-120));
    try {
      await onSend(text);
      setLocalMessages((current) =>
        current.map((candidate) => (candidate.id === id ? { ...candidate, state: "sent" } : candidate)),
      );
    } catch (error) {
      setLocalMessages((current) =>
        current.map((candidate) => (candidate.id === id ? { ...candidate, state: "failed" } : candidate)),
      );
      setSendIssue(error instanceof Error ? error.message : "The message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.canvas }]}>
      <FlatList
        contentContainerStyle={[styles.thread, items.length === 0 && styles.emptyThread]}
        data={items}
        keyExtractor={(item) => item.id}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={[styles.emptyGlyph, { backgroundColor: theme.accentDim }]}>
              <Text style={[styles.emptyGlyphText, { color: theme.accent }]}>›_</Text>
            </View>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No agent activity yet</Text>
            <Text style={[styles.emptyCopy, { color: theme.muted }]}>
              Start Codex or Claude in this pane, then use Chat as a focused view of its activity.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={onOpenTerminal}
              style={({ pressed }) => [styles.terminalButton, { borderColor: theme.line }, pressed && styles.pressed]}
            >
              <Text style={[styles.terminalButtonText, { color: theme.text }]}>Open terminal</Text>
            </Pressable>
          </View>
        }
        ref={listRef}
        renderItem={({ item }) => <ThreadItem item={item} />}
        showsVerticalScrollIndicator={false}
      />
      <View style={[styles.composer, { backgroundColor: theme.panel, borderColor: theme.line }]}>
        {!agentName ? (
          <Text style={[styles.composerHint, { color: theme.muted }]}>
            Start an agent in Terminal before sending chat messages.
          </Text>
        ) : null}
        {sendIssue ? <Text style={styles.sendIssue}>{sendIssue}</Text> : null}
        <View style={styles.composerRow}>
          <TextInput
            accessibilityLabel="Agent message"
            autoCapitalize="sentences"
            autoCorrect
            blurOnSubmit={false}
            editable={Boolean(agentName) && !sending}
            multiline
            onChangeText={setDraft}
            placeholder={agentName ? `Message ${agentName}` : "No agent detected"}
            placeholderTextColor={theme.muted}
            selectionColor={theme.accent}
            style={[
              styles.input,
              {
                backgroundColor: theme.canvas,
                borderColor: theme.line,
                color: theme.text,
              },
            ]}
            value={draft}
          />
          <Pressable
            accessibilityLabel="Send agent message"
            accessibilityRole="button"
            disabled={!agentName || !draft.trim() || sending}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.sendButton,
              { backgroundColor: theme.accent },
              (!agentName || !draft.trim() || sending) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {sending ? (
              <ActivityIndicator color={theme.canvas} size="small" />
            ) : (
              <Text style={[styles.sendButtonText, { color: theme.canvas }]}>↑</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function ThreadItem({ item }: { item: VisibleThreadItem }) {
  if (item.kind === "user") {
    return (
      <View style={[styles.message, styles.userMessage]}>
        <View style={styles.messageMeta}>
          <Text style={styles.messageAuthor}>YOU</Text>
          <Text style={[styles.messageTime, item.message.state === "failed" && styles.failed]}>
            {item.message.state === "sending"
              ? "SENDING"
              : item.message.state === "failed"
                ? "FAILED"
                : relativeTime(item.createdAt)}
          </Text>
        </View>
        <Text style={styles.messageBody}>{item.message.text}</Text>
      </View>
    );
  }
  if (item.kind === "agent") {
    const body = item.event.message?.trim() || item.event.summary?.trim() || item.event.title;
    return (
      <View style={[styles.message, styles.agentMessage]}>
        <View style={styles.messageMeta}>
          <Text style={styles.messageAuthor}>{item.event.agent.toUpperCase()}</Text>
          <Text style={styles.messageTime}>
            {item.event.status.toUpperCase()} · {relativeTime(item.createdAt)}
          </Text>
        </View>
        {item.event.title ? <Text style={styles.messageTitle}>{item.event.title}</Text> : null}
        {body && body !== item.event.title ? <Text style={styles.messageBody}>{body}</Text> : null}
      </View>
    );
  }
  if (item.kind === "run") {
    return (
      <View style={[styles.message, styles.systemMessage]}>
        <View style={styles.messageMeta}>
          <Text style={styles.messageAuthor}>RUN</Text>
          <Text style={styles.messageTime}>
            {item.run.status.toUpperCase()} · {relativeTime(item.createdAt)}
          </Text>
        </View>
        <Text style={[styles.messageBody, styles.command]}>{item.run.command}</Text>
      </View>
    );
  }
  const notificationBody = [item.notification.subtitle, item.notification.body].filter(Boolean).join("\n");
  return (
    <View style={[styles.message, styles.systemMessage]}>
      <View style={styles.messageMeta}>
        <Text style={styles.messageAuthor}>NOTIFY</Text>
        <Text style={styles.messageTime}>{relativeTime(item.createdAt)}</Text>
      </View>
      <Text style={styles.messageTitle}>{item.notification.title}</Text>
      {notificationBody ? <Text style={styles.messageBody}>{notificationBody}</Text> : null}
    </View>
  );
}

const relativeTime = (value: string): string => {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "NOW";
  if (minutes < 60) return `${minutes}M`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H`;
  return `${Math.floor(hours / 24)}D`;
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
  },
  thread: {
    gap: 10,
    padding: 12,
    paddingBottom: 18,
  },
  emptyThread: {
    flexGrow: 1,
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    alignSelf: "center",
    maxWidth: 320,
    padding: 24,
  },
  emptyGlyph: {
    alignItems: "center",
    borderRadius: 14,
    height: 54,
    justifyContent: "center",
    marginBottom: 16,
    width: 58,
  },
  emptyGlyphText: {
    fontFamily: fonts.mono,
    fontSize: 20,
    fontWeight: "900",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "800",
  },
  emptyCopy: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    textAlign: "center",
  },
  terminalButton: {
    borderRadius: 9,
    borderWidth: 1,
    marginTop: 18,
    minHeight: 40,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  terminalButtonText: {
    fontSize: 12,
    fontWeight: "800",
  },
  message: {
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
    maxWidth: "92%",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  userMessage: {
    alignSelf: "flex-end",
    backgroundColor: "#2a2015",
    borderColor: "#4a3720",
  },
  agentMessage: {
    alignSelf: "flex-start",
    backgroundColor: "#11151a",
    borderColor: "#252a31",
  },
  systemMessage: {
    alignSelf: "stretch",
    backgroundColor: "#0e1116",
    borderColor: "#20252c",
  },
  messageMeta: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  messageAuthor: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  messageTime: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 8,
    fontWeight: "700",
  },
  messageTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  messageBody: {
    color: colors.terminalText,
    fontSize: 13,
    lineHeight: 19,
  },
  command: {
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  failed: {
    color: "#ff8d87",
  },
  composer: {
    borderTopWidth: 1,
    gap: 7,
    padding: 8,
  },
  composerHint: {
    fontFamily: fonts.mono,
    fontSize: 9,
    paddingHorizontal: 3,
  },
  sendIssue: {
    color: "#ff8d87",
    fontFamily: fonts.mono,
    fontSize: 9,
    paddingHorizontal: 3,
  },
  composerRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 7,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    maxHeight: 120,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sendButton: {
    alignItems: "center",
    borderRadius: 10,
    height: 42,
    justifyContent: "center",
    width: 44,
  },
  sendButtonText: {
    fontSize: 20,
    fontWeight: "900",
    marginTop: -2,
  },
  disabled: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.68,
  },
});
