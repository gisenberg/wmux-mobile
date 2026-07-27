import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { TERMINAL_COLOR_SCHEME_IDS, type BootstrapPayload, type WmuxSettings } from "../../protocol/wmux";

import { chromeTheme, type ChromeTheme } from "@/navigation/chrome-theme";
import {
  drawerWorkspaceSignals,
  paneDrawerLabel,
  paneUnreadCount,
  type DrawerAgentSignal,
} from "@/navigation/drawer-model";
import type { ResolvedNavigation } from "@/navigation/model";
import { fonts } from "@/ui/theme";

const runningFrames = ["|", "/", "-", "\\"] as const;

export type WorkspaceAction = { type: "create-workspace"; machineId: string } | { type: "close-workspace" };

export type WorkspaceSurface = "chat" | "terminal";

interface WorkspaceChromeProps {
  bootstrap: BootstrapPayload;
  children: ReactNode;
  edgeSwipeEnabled?: boolean;
  mutationBusy?: boolean;
  navigation: ResolvedNavigation;
  onAction: (action: WorkspaceAction) => void;
  onForget: () => void;
  onNavigate: (navigation: ResolvedNavigation) => void;
  onOpenDiagnostics: () => void;
  onRefresh: () => void;
  onSurfaceChange: (surface: WorkspaceSurface) => void;
  onUpdateSettings: (settings: WmuxSettings) => void;
  surface: WorkspaceSurface;
}

export function WorkspaceChrome({
  bootstrap,
  children,
  edgeSwipeEnabled = true,
  mutationBusy = false,
  navigation,
  onAction,
  onForget,
  onNavigate,
  onOpenDiagnostics,
  onRefresh,
  onSurfaceChange,
  onUpdateSettings,
  surface,
}: WorkspaceChromeProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const theme = chromeTheme(bootstrap.settings.colorScheme);
  const edgeSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onPanResponderMove: (_event, gesture) => {
          if (gesture.dx >= 64) setDrawerOpen(true);
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx >= 64) setDrawerOpen(true);
        },
        onStartShouldSetPanResponder: () => edgeSwipeEnabled,
        onStartShouldSetPanResponderCapture: () => edgeSwipeEnabled,
      }),
    [edgeSwipeEnabled],
  );

  return (
    <View style={styles.root}>
      <View
        accessibilityLabel="Open workspace drawer with edge swipe"
        collapsable={false}
        style={styles.edgeSwipeZone}
        {...edgeSwipeResponder.panHandlers}
      />
      <View style={[styles.workspaceHeader, { backgroundColor: theme.panel, borderColor: theme.line }]}>
        <Pressable
          accessibilityLabel="Open workspace drawer"
          accessibilityRole="button"
          onPress={() => setDrawerOpen(true)}
          style={({ pressed }) => [
            styles.squareButton,
            { backgroundColor: theme.accentDim, borderColor: theme.line },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.squareButtonText, { color: theme.accent }]}>☰</Text>
        </Pressable>
        <View style={styles.workspaceHeaderCopy}>
          <Text numberOfLines={1} style={[styles.workspaceName, { color: theme.text }]}>
            {navigation.workspace.name}
          </Text>
        </View>
        <View style={[styles.surfaceSwitcher, { backgroundColor: theme.canvas, borderColor: theme.line }]}>
          <SurfaceButton
            active={surface === "terminal"}
            label="Terminal"
            onPress={() => onSurfaceChange("terminal")}
            theme={theme}
          />
          <SurfaceButton
            active={surface === "chat"}
            label="Chat"
            onPress={() => onSurfaceChange("chat")}
            theme={theme}
          />
        </View>
        <Pressable
          accessibilityLabel={`Close ${navigation.workspace.name} workspace`}
          accessibilityRole="button"
          disabled={mutationBusy}
          onPress={() => onAction({ type: "close-workspace" })}
          style={({ pressed }) => [
            styles.squareButton,
            styles.closeWorkspaceButton,
            mutationBusy && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.squareButtonText, styles.closeWorkspaceGlyph]}>×</Text>
        </Pressable>
      </View>

      {children}

      <WorkspaceDrawer
        bootstrap={bootstrap}
        busy={mutationBusy}
        navigation={navigation}
        onClose={() => setDrawerOpen(false)}
        onCreateWorkspace={(machineId) => {
          onAction({ type: "create-workspace", machineId });
          setDrawerOpen(false);
        }}
        onNavigate={(next) => {
          onNavigate(next);
          setDrawerOpen(false);
        }}
        onOpenSettings={() => {
          setDrawerOpen(false);
          setSettingsOpen(true);
        }}
        open={drawerOpen}
        theme={theme}
      />
      <WorkspaceSettingsSheet
        onApply={(settings) => {
          onUpdateSettings(settings);
          setSettingsOpen(false);
        }}
        onClose={() => setSettingsOpen(false)}
        onForget={() => {
          setSettingsOpen(false);
          onForget();
        }}
        onOpenDiagnostics={() => {
          setSettingsOpen(false);
          onOpenDiagnostics();
        }}
        onRefresh={() => {
          setSettingsOpen(false);
          onRefresh();
        }}
        open={settingsOpen}
        settings={bootstrap.settings}
        theme={theme}
      />
    </View>
  );
}

function SurfaceButton({
  active,
  label,
  onPress,
  theme,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  theme: ChromeTheme;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.surfaceButton,
        active && { backgroundColor: theme.accentDim },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.surfaceButtonText, { color: active ? theme.accent : theme.muted }]}>{label}</Text>
    </Pressable>
  );
}

function WorkspaceDrawer({
  bootstrap,
  busy,
  navigation,
  onClose,
  onCreateWorkspace,
  onNavigate,
  onOpenSettings,
  open,
  theme,
}: {
  bootstrap: BootstrapPayload;
  busy: boolean;
  navigation: ResolvedNavigation;
  onClose: () => void;
  onCreateWorkspace: (machineId: string) => void;
  onNavigate: (navigation: ResolvedNavigation) => void;
  onOpenSettings: () => void;
  open: boolean;
  theme: ChromeTheme;
}) {
  const insets = useSafeAreaInsets();
  const [animationTick, setAnimationTick] = useState(0);
  const hasWorkingAgent = bootstrap.workspaces.some((workspace) => {
    const tab = workspace.tabs.find((candidate) => candidate.id === workspace.activeTabId) ?? workspace.tabs[0];
    const pane = tab?.panes.find((candidate) => candidate.id === tab.activePaneId) ?? tab?.panes[0];
    return pane ? drawerWorkspaceSignals(bootstrap, workspace, pane).agent?.state === "working" : false;
  });

  useEffect(() => {
    if (!open || !hasWorkingAgent) return;
    const timer = setInterval(() => setAnimationTick((value) => (value + 1) % runningFrames.length), 280);
    return () => clearInterval(timer);
  }, [hasWorkingAgent, open]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={["portrait", "landscape-left", "landscape-right"]}
      transparent
      visible={open}
    >
      <SafeAreaView style={styles.modalRoot}>
        <Pressable accessibilityLabel="Close workspace drawer" onPress={onClose} style={styles.modalBackdrop} />
        <View
          style={[
            styles.drawer,
            {
              backgroundColor: theme.panel,
              borderColor: theme.line,
              paddingBottom: Math.max(insets.bottom, 16),
              paddingTop: Math.max(insets.top, 16),
            },
          ]}
        >
          <View style={[styles.sheetHeader, styles.drawerHeader]}>
            <Text style={[styles.drawerTitle, { color: theme.text }]}>Spaces</Text>
            <SheetCloseButton onPress={onClose} theme={theme} />
          </View>
          <ScrollView contentContainerStyle={styles.drawerList} showsVerticalScrollIndicator={false}>
            <Text style={[styles.sectionLabel, { color: theme.muted }]}>HOSTS</Text>
            <View style={styles.hostList}>
              {bootstrap.machines.map((machine) => {
                const disabled = busy || !machine.reachable;
                return (
                  <View key={machine.id} style={[styles.hostRow, { borderColor: theme.line }]}>
                    <View style={[styles.hostDot, { backgroundColor: machine.reachable ? "#67d391" : "#ef7770" }]} />
                    <View style={styles.hostRowCopy}>
                      <Text numberOfLines={1} style={[styles.hostRowTitle, { color: theme.text }]}>
                        {machine.name}
                      </Text>
                      <Text numberOfLines={1} style={[styles.hostRowMeta, { color: theme.muted }]}>
                        {machine.reachable ? machine.kind : "offline"}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityLabel={`New workspace on ${machine.name}`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled }}
                      disabled={disabled}
                      onPress={() => onCreateWorkspace(machine.id)}
                      style={({ pressed }) => [
                        styles.hostCreateButton,
                        { backgroundColor: theme.accentDim, borderColor: theme.line },
                        disabled && styles.disabled,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.hostCreateGlyph, { color: theme.accent }]}>＋</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
            <Text style={[styles.sectionLabel, styles.workspaceSectionLabel, { color: theme.muted }]}>WORKSPACES</Text>
            {bootstrap.workspaces.map((workspace) => {
              const active = workspace.id === navigation.workspace.id;
              const tab =
                workspace.tabs.find((candidate) => candidate.id === workspace.activeTabId) ?? workspace.tabs[0];
              const pane = tab?.panes.find((candidate) => candidate.id === tab.activePaneId) ?? tab?.panes[0];
              if (!tab || !pane) return null;
              const machine = bootstrap.machines.find((candidate) => candidate.id === workspace.machineId);
              const machineLabel = machine?.name ?? workspace.machineId;
              const signals = drawerWorkspaceSignals(bootstrap, workspace, pane);
              const paneCount = workspace.tabs.reduce((count, workspaceTab) => count + workspaceTab.panes.length, 0);
              const showPaneList = workspace.tabs.length > 1 || paneCount > 1;
              return (
                <View
                  key={workspace.id}
                  style={[
                    styles.workspaceGroup,
                    { borderColor: active ? theme.accent : theme.line },
                    active && { backgroundColor: theme.accentDim },
                  ]}
                >
                  <Pressable
                    accessibilityLabel={[
                      `${workspace.name} workspace`,
                      signals.cwd || machineLabel,
                      signals.agent && ["working", "waiting", "failed"].includes(signals.agent.state)
                        ? `${signals.agent.name} ${signals.agent.status}`
                        : "",
                      signals.unreadCount > 0
                        ? `${signals.unreadCount} unread ${signals.unreadCount === 1 ? "alert" : "alerts"}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() =>
                      onNavigate({
                        pane,
                        selection: {
                          paneId: pane.id,
                          tabId: tab.id,
                          workspaceId: workspace.id,
                        },
                        tab,
                        workspace,
                      })
                    }
                    style={({ pressed }) => [styles.drawerRow, pressed && styles.pressed]}
                  >
                    <Text style={[styles.drawerActiveMarker, { color: active ? theme.accent : theme.muted }]}>
                      {active ? ">" : " "}
                    </Text>
                    <AgentStatusMarker
                      agent={signals.agent}
                      animationTick={animationTick}
                      reachable={Boolean(machine?.reachable)}
                      theme={theme}
                    />
                    <View style={styles.drawerRowCopy}>
                      <View style={styles.drawerPrimaryRow}>
                        <Text numberOfLines={1} style={[styles.drawerRowTitle, { color: theme.text }]}>
                          {workspace.name}
                        </Text>
                        {signals.agent && ["working", "waiting", "failed"].includes(signals.agent.state) ? (
                          <Text
                            numberOfLines={1}
                            style={[styles.agentLabel, { color: agentStateColor(signals.agent.state, theme) }]}
                          >
                            {signals.agent.name}
                          </Text>
                        ) : null}
                        {signals.unreadCount > 0 ? <AlertBadge count={signals.unreadCount} theme={theme} /> : null}
                      </View>
                      <View style={styles.drawerMetaRow}>
                        <Text
                          ellipsizeMode="middle"
                          numberOfLines={1}
                          style={[styles.drawerCwd, { color: signals.cwd ? theme.muted : theme.faint }]}
                        >
                          {signals.cwd || machineLabel}
                        </Text>
                        {signals.cwd ? (
                          <Text numberOfLines={1} style={[styles.drawerHost, { color: theme.faint }]}>
                            @{machineLabel}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                  {showPaneList ? (
                    <View style={[styles.paneList, { borderColor: theme.line }]}>
                      {workspace.tabs.flatMap((workspaceTab) =>
                        workspaceTab.panes.map((workspacePane, paneIndex) => {
                          const paneActive = workspacePane.id === navigation.pane.id;
                          const label = paneDrawerLabel(
                            workspaceTab,
                            workspacePane,
                            paneIndex,
                            workspace.tabs.length > 1,
                          );
                          const unreadCount = paneUnreadCount(bootstrap.notifications, workspacePane.id);
                          return (
                            <Pressable
                              accessibilityLabel={[
                                `${label} pane`,
                                unreadCount > 0
                                  ? `${unreadCount} unread ${unreadCount === 1 ? "alert" : "alerts"}`
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(", ")}
                              accessibilityRole="tab"
                              accessibilityState={{ selected: paneActive }}
                              key={`${workspaceTab.id}:${workspacePane.id}`}
                              onPress={() =>
                                onNavigate({
                                  pane: workspacePane,
                                  selection: {
                                    paneId: workspacePane.id,
                                    tabId: workspaceTab.id,
                                    workspaceId: workspace.id,
                                  },
                                  tab: workspaceTab,
                                  workspace,
                                })
                              }
                              style={({ pressed }) => [
                                styles.drawerPaneRow,
                                paneActive && { backgroundColor: theme.canvas },
                                pressed && styles.pressed,
                              ]}
                            >
                              <Text
                                style={[styles.drawerPaneMarker, { color: paneActive ? theme.accent : theme.faint }]}
                              >
                                {paneActive ? ">" : "·"}
                              </Text>
                              <Text
                                numberOfLines={1}
                                style={[styles.drawerPaneLabel, { color: paneActive ? theme.accent : theme.muted }]}
                              >
                                {label}
                              </Text>
                              {unreadCount > 0 ? <AlertBadge count={unreadCount} compact theme={theme} /> : null}
                            </Pressable>
                          );
                        }),
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
          <View style={[styles.drawerFooter, { borderColor: theme.line }]}>
            <Pressable
              accessibilityLabel="Open settings"
              accessibilityRole="button"
              onPress={onOpenSettings}
              style={({ pressed }) => [
                styles.settingsNavButton,
                { backgroundColor: theme.canvas, borderColor: theme.line },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.settingsNavGlyph, { color: theme.accent }]}>⚙</Text>
              <Text style={[styles.settingsNavLabel, { color: theme.text }]}>Settings</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function AgentStatusMarker({
  agent,
  animationTick,
  reachable,
  theme,
}: {
  agent: DrawerAgentSignal | undefined;
  animationTick: number;
  reachable: boolean;
  theme: ChromeTheme;
}) {
  const glyph =
    agent?.state === "working"
      ? runningFrames[animationTick]
      : agent?.state === "waiting"
        ? "?"
        : agent?.state === "failed"
          ? "!"
          : "•";
  const color = agent ? agentStateColor(agent.state, theme) : reachable ? "#67d391" : "#ef7770";
  const accessibilityLabel = agent ? `${agent.name} ${agent.status}` : reachable ? "Host reachable" : "Host offline";
  return (
    <Text accessibilityLabel={accessibilityLabel} style={[styles.drawerStatusMarker, { color }]}>
      {glyph}
    </Text>
  );
}

function AlertBadge({ compact = false, count, theme }: { compact?: boolean; count: number; theme: ChromeTheme }) {
  return (
    <View
      accessibilityLabel={`${count} unread ${count === 1 ? "alert" : "alerts"}`}
      style={[styles.alertBadge, compact && styles.alertBadgeCompact, { backgroundColor: theme.accent }]}
    >
      <Text style={[styles.alertBadgeText, { color: theme.canvas }]}>! {Math.min(count, 99)}</Text>
    </View>
  );
}

const agentStateColor = (state: DrawerAgentSignal["state"], theme: ChromeTheme): string => {
  if (state === "working") return "#73adff";
  if (state === "waiting" || state === "updated") return theme.accent;
  if (state === "failed") return "#ef7770";
  return "#67d391";
};

function WorkspaceSettingsSheet({
  onApply,
  onClose,
  onForget,
  onOpenDiagnostics,
  onRefresh,
  open,
  settings,
  theme,
}: {
  onApply: (settings: WmuxSettings) => void;
  onClose: () => void;
  onForget: () => void;
  onOpenDiagnostics: () => void;
  onRefresh: () => void;
  open: boolean;
  settings: WmuxSettings;
  theme: ChromeTheme;
}) {
  const [draft, setDraft] = useState(settings);
  const draftTheme = chromeTheme(draft.colorScheme);

  const close = (): void => {
    setDraft(settings);
    onClose();
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      supportedOrientations={["portrait", "landscape-left", "landscape-right"]}
      transparent
      visible={open}
    >
      <SafeAreaView style={styles.modalRoot}>
        <Pressable accessibilityLabel="Close terminal settings" onPress={close} style={styles.modalBackdrop} />
        <View style={[styles.settingsSheet, { backgroundColor: draftTheme.panel, borderColor: draftTheme.line }]}>
          <View style={styles.sheetHandle} />
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.settingsScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.sheetHeader}>
              <View>
                <Text style={[styles.sheetKicker, { color: draftTheme.accent }]}>TERMINAL</Text>
                <Text style={[styles.sheetTitle, { color: draftTheme.text }]}>Settings</Text>
              </View>
              <SheetCloseButton onPress={close} theme={draftTheme} />
            </View>
            <Text style={[styles.sectionLabel, { color: draftTheme.muted }]}>COLOR SCHEME</Text>
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.schemeList}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {TERMINAL_COLOR_SCHEME_IDS.map((scheme) => {
                const optionTheme = chromeTheme(scheme);
                const selected = scheme === draft.colorScheme;
                return (
                  <Pressable
                    accessibilityLabel={`${scheme} color scheme`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    key={scheme}
                    onPress={() => setDraft((current) => ({ ...current, colorScheme: scheme }))}
                    style={[
                      styles.schemeCard,
                      {
                        backgroundColor: optionTheme.canvas,
                        borderColor: selected ? optionTheme.accent : optionTheme.line,
                      },
                    ]}
                  >
                    <View style={[styles.schemeSwatch, { backgroundColor: optionTheme.accent }]} />
                    <Text numberOfLines={2} style={[styles.schemeLabel, { color: optionTheme.text }]}>
                      {scheme.replaceAll("-", " ")}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <SettingsStepper
              label="Font size"
              onDecrease={() =>
                setDraft((current) => ({ ...current, terminalFontSize: Math.max(10, current.terminalFontSize - 1) }))
              }
              onIncrease={() =>
                setDraft((current) => ({ ...current, terminalFontSize: Math.min(28, current.terminalFontSize + 1) }))
              }
              theme={draftTheme}
              value={`${draft.terminalFontSize}px`}
            />
            <Text style={[styles.sectionLabel, { color: draftTheme.muted }]}>TUI FRAME RATE</Text>
            <View style={styles.segmentedRow}>
              {([15, 30, 60] as const).map((frameRate) => (
                <SettingsChoice
                  active={draft.tuiFrameRate === frameRate}
                  key={frameRate}
                  label={`${frameRate} FPS`}
                  onPress={() => setDraft((current) => ({ ...current, tuiFrameRate: frameRate }))}
                  theme={draftTheme}
                />
              ))}
            </View>
            <Text style={[styles.sectionLabel, { color: draftTheme.muted }]}>SCROLL DELIVERY</Text>
            <View style={styles.segmentedRow}>
              <SettingsChoice
                active={draft.terminalScrollMode === "batched"}
                label="Batched"
                onPress={() => setDraft((current) => ({ ...current, terminalScrollMode: "batched" }))}
                theme={draftTheme}
              />
              <SettingsChoice
                active={draft.terminalScrollMode === "immediate"}
                label="Immediate"
                onPress={() => setDraft((current) => ({ ...current, terminalScrollMode: "immediate" }))}
                theme={draftTheme}
              />
            </View>
            <Text style={[styles.sectionLabel, { color: draftTheme.muted }]}>CONNECTION</Text>
            <View style={styles.connectionActions}>
              <ActionButton label="Reconnect" onPress={onRefresh} theme={draftTheme} />
              <ActionButton label="Diagnostics" onPress={onOpenDiagnostics} theme={draftTheme} />
              <ActionButton danger label="Change server" onPress={onForget} theme={draftTheme} />
            </View>
            <View style={styles.settingsActions}>
              <ActionButton label="Cancel" onPress={close} theme={draftTheme} />
              <ActionButton emphasized label="Apply settings" onPress={() => onApply(draft)} theme={draftTheme} />
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function SettingsStepper({
  label,
  onDecrease,
  onIncrease,
  theme,
  value,
}: {
  label: string;
  onDecrease: () => void;
  onIncrease: () => void;
  theme: ChromeTheme;
  value: string;
}) {
  return (
    <View style={[styles.stepper, { borderColor: theme.line }]}>
      <Text style={[styles.stepperLabel, { color: theme.text }]}>{label}</Text>
      <Pressable
        accessibilityLabel={`Decrease ${label.toLowerCase()}`}
        accessibilityRole="button"
        onPress={onDecrease}
        style={[styles.stepperButton, { backgroundColor: theme.accentDim }]}
      >
        <Text style={[styles.stepperButtonText, { color: theme.accent }]}>−</Text>
      </Pressable>
      <Text style={[styles.stepperValue, { color: theme.text }]}>{value}</Text>
      <Pressable
        accessibilityLabel={`Increase ${label.toLowerCase()}`}
        accessibilityRole="button"
        onPress={onIncrease}
        style={[styles.stepperButton, { backgroundColor: theme.accentDim }]}
      >
        <Text style={[styles.stepperButtonText, { color: theme.accent }]}>＋</Text>
      </Pressable>
    </View>
  );
}

function SettingsChoice({
  active,
  label,
  onPress,
  theme,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  theme: ChromeTheme;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={[
        styles.settingsChoice,
        { backgroundColor: active ? theme.accentDim : theme.canvas, borderColor: active ? theme.accent : theme.line },
      ]}
    >
      <Text style={[styles.settingsChoiceText, { color: active ? theme.accent : theme.muted }]}>{label}</Text>
    </Pressable>
  );
}

function ActionButton({
  danger = false,
  disabled = false,
  emphasized = false,
  label,
  onPress,
  theme,
}: {
  danger?: boolean;
  disabled?: boolean;
  emphasized?: boolean;
  label: string;
  onPress: () => void;
  theme: ChromeTheme;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: emphasized ? theme.accent : danger ? "#30191a" : theme.canvas,
          borderColor: danger ? "#633032" : emphasized ? theme.accent : theme.line,
        },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.actionButtonText, { color: emphasized ? theme.canvas : danger ? "#ff8d87" : theme.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function SheetCloseButton({ onPress, theme }: { onPress: () => void; theme: ChromeTheme }) {
  return (
    <Pressable
      accessibilityLabel="Close"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetClose,
        { backgroundColor: theme.canvas, borderColor: theme.line },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.sheetCloseText, { color: theme.muted }]}>×</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    width: "100%",
  },
  edgeSwipeZone: {
    bottom: 0,
    left: Platform.OS === "android" ? 24 : 0,
    position: "absolute",
    top: 0,
    width: Platform.OS === "android" ? 36 : 28,
    zIndex: 3,
  },
  workspaceHeader: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 7,
    minHeight: 48,
    paddingHorizontal: 7,
    paddingVertical: 5,
    zIndex: 4,
  },
  squareButton: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 38,
  },
  squareButtonText: {
    fontFamily: fonts.mono,
    fontSize: 17,
    fontWeight: "800",
  },
  closeWorkspaceButton: {
    backgroundColor: "#30191a",
    borderColor: "#633032",
  },
  closeWorkspaceGlyph: {
    color: "#ff8d87",
    fontSize: 22,
    lineHeight: 23,
  },
  workspaceHeaderCopy: {
    flex: 1,
    minWidth: 54,
  },
  workspaceName: {
    fontSize: 13,
    fontWeight: "800",
  },
  surfaceSwitcher: {
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: "row",
    padding: 2,
  },
  surfaceButton: {
    alignItems: "center",
    borderRadius: 7,
    height: 30,
    justifyContent: "center",
    minWidth: 55,
    paddingHorizontal: 7,
  },
  surfaceButtonText: {
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "800",
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    backgroundColor: "rgba(3, 5, 8, 0.72)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  drawer: {
    borderRightWidth: 1,
    bottom: 0,
    left: 0,
    maxWidth: 360,
    paddingHorizontal: 12,
    position: "absolute",
    top: 0,
    width: "86%",
  },
  drawerHeader: {
    minHeight: 40,
  },
  drawerTitle: {
    fontFamily: fonts.mono,
    fontSize: 18,
    fontWeight: "800",
  },
  drawerList: {
    gap: 5,
    paddingBottom: 12,
    paddingTop: 8,
  },
  hostList: {
    gap: 3,
  },
  hostRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 7,
    minHeight: 38,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  hostRowCopy: {
    alignItems: "baseline",
    flex: 1,
    flexDirection: "row",
    gap: 6,
  },
  hostRowTitle: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  hostRowMeta: {
    fontFamily: fonts.mono,
    fontSize: 8,
    textTransform: "uppercase",
  },
  hostCreateButton: {
    alignItems: "center",
    borderRadius: 6,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 32,
  },
  hostCreateGlyph: {
    fontFamily: fonts.mono,
    fontSize: 16,
    fontWeight: "800",
  },
  workspaceSectionLabel: {
    marginTop: 7,
  },
  workspaceGroup: {
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  drawerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    minHeight: 48,
    paddingHorizontal: 7,
    paddingVertical: 6,
  },
  drawerActiveMarker: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
    width: 9,
  },
  drawerStatusMarker: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
    width: 10,
  },
  drawerRowCopy: {
    flex: 1,
    minWidth: 0,
  },
  drawerPrimaryRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  drawerRowTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    minWidth: 0,
  },
  agentLabel: {
    fontFamily: fonts.mono,
    fontSize: 8,
    fontWeight: "800",
    maxWidth: 58,
    textTransform: "lowercase",
  },
  alertBadge: {
    alignItems: "center",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 17,
    minWidth: 28,
    paddingHorizontal: 5,
  },
  alertBadgeCompact: {
    minHeight: 15,
    minWidth: 24,
    paddingHorizontal: 4,
  },
  alertBadgeText: {
    fontFamily: fonts.mono,
    fontSize: 8,
    fontWeight: "900",
  },
  drawerMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    marginTop: 3,
  },
  drawerCwd: {
    flex: 1,
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "600",
    minWidth: 0,
  },
  drawerHost: {
    flexShrink: 1,
    fontFamily: fonts.mono,
    fontSize: 8,
  },
  paneList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 3,
  },
  drawerPaneRow: {
    alignItems: "center",
    borderRadius: 5,
    flexDirection: "row",
    gap: 5,
    minHeight: 29,
    paddingHorizontal: 8,
  },
  drawerPaneMarker: {
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center",
    width: 10,
  },
  drawerPaneLabel: {
    flex: 1,
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "700",
  },
  drawerFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  settingsNavButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 36,
    paddingHorizontal: 10,
  },
  settingsNavGlyph: {
    fontSize: 14,
  },
  settingsNavLabel: {
    fontSize: 11,
    fontWeight: "800",
  },
  settingsSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    gap: 12,
    maxHeight: "92%",
    padding: 16,
  },
  settingsScrollContent: {
    gap: 12,
    paddingBottom: 4,
  },
  sheetHandle: {
    alignSelf: "center",
    backgroundColor: "#4c5260",
    borderRadius: 2,
    height: 4,
    width: 42,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
  },
  sheetKicker: {
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  sheetTitle: {
    fontSize: 21,
    fontWeight: "800",
    marginTop: 3,
  },
  sheetClose: {
    alignItems: "center",
    borderRadius: 7,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 36,
  },
  sheetCloseText: {
    fontSize: 22,
    lineHeight: 24,
  },
  sectionLabel: {
    fontFamily: fonts.mono,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  hostDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  connectionActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionButton: {
    alignItems: "center",
    borderRadius: 9,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 42,
    minWidth: "30%",
    paddingHorizontal: 10,
  },
  actionButtonText: {
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  schemeList: {
    gap: 8,
  },
  schemeCard: {
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    height: 82,
    justifyContent: "center",
    padding: 10,
    width: 112,
  },
  schemeSwatch: {
    borderRadius: 4,
    height: 8,
    width: 28,
  },
  schemeLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "700",
    lineHeight: 12,
  },
  stepper: {
    alignItems: "center",
    borderBottomWidth: 1,
    borderTopWidth: 1,
    flexDirection: "row",
    minHeight: 50,
  },
  stepperLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
  },
  stepperButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 34,
    justifyContent: "center",
    width: 38,
  },
  stepperButtonText: {
    fontSize: 18,
    fontWeight: "800",
  },
  stepperValue: {
    fontFamily: fonts.mono,
    fontSize: 11,
    minWidth: 54,
    textAlign: "center",
  },
  segmentedRow: {
    flexDirection: "row",
    gap: 8,
  },
  settingsChoice: {
    alignItems: "center",
    borderRadius: 9,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 8,
  },
  settingsChoiceText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "800",
  },
  settingsActions: {
    flexDirection: "row",
    gap: 9,
  },
  pressed: {
    opacity: 0.68,
  },
  disabled: {
    opacity: 0.42,
  },
});
