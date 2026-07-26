import { useMemo, useState, type ReactNode } from "react";
import { Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  TERMINAL_COLOR_SCHEME_IDS,
  type BootstrapPayload,
  type SplitDirection,
  type WmuxSettings,
} from "../../protocol/wmux";

import { chromeTheme, type ChromeTheme } from "@/navigation/chrome-theme";
import type { ResolvedNavigation } from "@/navigation/model";
import { fonts } from "@/ui/theme";

export type WorkspaceAction =
  | { type: "create-workspace"; machineId: string }
  | { type: "create-tab"; machineId: string }
  | { type: "split"; direction: SplitDirection; machineId: string }
  | { type: "close-pane" }
  | { type: "close-tab" }
  | { type: "close-workspace" };

export type WorkspaceSurface = "chat" | "terminal";

interface WorkspaceChromeProps {
  bootstrap: BootstrapPayload;
  children: ReactNode;
  edgeSwipeEnabled?: boolean;
  isLandscape: boolean;
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
  isLandscape,
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
  const [actionsOpen, setActionsOpen] = useState(false);
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
          <Text numberOfLines={1} style={[styles.workspaceContext, { color: theme.muted }]}>
            {navigation.tab.title}
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
          accessibilityLabel="Open workspace actions"
          accessibilityRole="button"
          onPress={() => setActionsOpen(true)}
          style={({ pressed }) => [
            styles.squareButton,
            { backgroundColor: theme.accentDim, borderColor: theme.line },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.squareButtonText, { color: theme.accent }]}>＋</Text>
        </Pressable>
      </View>

      <View style={[styles.tabBar, { backgroundColor: theme.canvas, borderColor: theme.line }]}>
        <ScrollView
          bounces={false}
          contentContainerStyle={styles.tabBarContent}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {navigation.workspace.tabs.map((tab) => {
            const active = tab.id === navigation.tab.id;
            return (
              <Pressable
                accessibilityLabel={`${tab.title} tab`}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                key={tab.id}
                onPress={() => {
                  const pane = tab.panes.find((candidate) => candidate.id === tab.activePaneId) ?? tab.panes[0];
                  if (!pane) return;
                  onNavigate({
                    pane,
                    selection: {
                      paneId: pane.id,
                      tabId: tab.id,
                      workspaceId: navigation.workspace.id,
                    },
                    tab,
                    workspace: navigation.workspace,
                  });
                }}
                style={({ pressed }) => [
                  styles.tabPill,
                  { borderColor: active ? theme.accent : theme.line },
                  active && { backgroundColor: theme.accentDim },
                  pressed && styles.pressed,
                ]}
              >
                <Text numberOfLines={1} style={[styles.tabLabel, { color: active ? theme.accent : theme.muted }]}>
                  {tab.title}
                </Text>
                {tab.panes.length > 1 ? (
                  <Text style={[styles.tabCount, { color: active ? theme.accent : theme.muted }]}>
                    {tab.panes.length}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {navigation.tab.panes.length > 1 ? (
        <View style={[styles.paneBar, { backgroundColor: theme.panel, borderColor: theme.line }]}>
          <Text style={[styles.paneBarLabel, { color: theme.muted }]}>PANES</Text>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.paneBarContent}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {navigation.tab.panes.map((pane) => {
              const active = pane.id === navigation.pane.id;
              return (
                <Pressable
                  accessibilityLabel={`${pane.title} pane`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  key={pane.id}
                  onPress={() =>
                    onNavigate({
                      ...navigation,
                      pane,
                      selection: { ...navigation.selection, paneId: pane.id },
                    })
                  }
                  style={({ pressed }) => [
                    styles.panePill,
                    { borderColor: active ? theme.accent : theme.line },
                    active && { backgroundColor: theme.accentDim },
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={[
                      styles.paneStatus,
                      {
                        backgroundColor:
                          pane.status === "running" ? "#67d391" : pane.status === "exited" ? "#ef7770" : theme.muted,
                      },
                    ]}
                  />
                  <Text style={[styles.paneLabel, { color: active ? theme.text : theme.muted }]}>{pane.title}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {children}

      <WorkspaceDrawer
        bootstrap={bootstrap}
        navigation={navigation}
        onClose={() => setDrawerOpen(false)}
        onNavigate={(next) => {
          onNavigate(next);
          setDrawerOpen(false);
        }}
        open={drawerOpen}
        theme={theme}
      />
      <WorkspaceActionSheet
        key={navigation.pane.id}
        bootstrap={bootstrap}
        busy={mutationBusy}
        isLandscape={isLandscape}
        navigation={navigation}
        onAction={(action) => {
          onAction(action);
          setActionsOpen(false);
        }}
        onClose={() => setActionsOpen(false)}
        onOpenDiagnostics={() => {
          setActionsOpen(false);
          onOpenDiagnostics();
        }}
        onForget={() => {
          setActionsOpen(false);
          onForget();
        }}
        onRefresh={() => {
          setActionsOpen(false);
          onRefresh();
        }}
        onOpenSettings={() => {
          setActionsOpen(false);
          setSettingsOpen(true);
        }}
        open={actionsOpen}
        theme={theme}
      />
      <WorkspaceSettingsSheet
        onApply={(settings) => {
          onUpdateSettings(settings);
          setSettingsOpen(false);
        }}
        onClose={() => setSettingsOpen(false)}
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
  navigation,
  onClose,
  onNavigate,
  open,
  theme,
}: {
  bootstrap: BootstrapPayload;
  navigation: ResolvedNavigation;
  onClose: () => void;
  onNavigate: (navigation: ResolvedNavigation) => void;
  open: boolean;
  theme: ChromeTheme;
}) {
  const insets = useSafeAreaInsets();
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
          <View style={styles.sheetHeader}>
            <View>
              <Text style={[styles.sheetKicker, { color: theme.accent }]}>NAVIGATION</Text>
              <Text style={[styles.sheetTitle, { color: theme.text }]}>Workspaces</Text>
            </View>
            <SheetCloseButton onPress={onClose} theme={theme} />
          </View>
          <ScrollView contentContainerStyle={styles.drawerList} showsVerticalScrollIndicator={false}>
            {bootstrap.workspaces.map((workspace) => {
              const active = workspace.id === navigation.workspace.id;
              const tab =
                workspace.tabs.find((candidate) => candidate.id === workspace.activeTabId) ?? workspace.tabs[0];
              const pane = tab?.panes.find((candidate) => candidate.id === tab.activePaneId) ?? tab?.panes[0];
              if (!tab || !pane) return null;
              const machine = bootstrap.machines.find((candidate) => candidate.id === workspace.machineId);
              const paneCount = workspace.tabs.reduce((total, candidate) => total + candidate.panes.length, 0);
              return (
                <Pressable
                  accessibilityLabel={`${workspace.name} workspace`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={workspace.id}
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
                  style={({ pressed }) => [
                    styles.drawerRow,
                    { borderColor: active ? theme.accent : theme.line },
                    active && { backgroundColor: theme.accentDim },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.drawerIcon, { backgroundColor: theme.accentDim }]}>
                    <Text style={[styles.drawerGlyph, { color: theme.accent }]}>›_</Text>
                  </View>
                  <View style={styles.drawerRowCopy}>
                    <Text numberOfLines={1} style={[styles.drawerRowTitle, { color: theme.text }]}>
                      {workspace.name}
                    </Text>
                    <Text numberOfLines={1} style={[styles.drawerRowMeta, { color: theme.muted }]}>
                      {workspace.tabs.length} tabs · {paneCount} panes · {machine?.name ?? workspace.machineId}
                    </Text>
                    {workspace.descriptor ? (
                      <Text numberOfLines={1} style={[styles.drawerDescriptor, { color: theme.muted }]}>
                        {workspace.descriptor}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function WorkspaceActionSheet({
  bootstrap,
  busy,
  isLandscape,
  navigation,
  onAction,
  onClose,
  onForget,
  onOpenDiagnostics,
  onRefresh,
  onOpenSettings,
  open,
  theme,
}: {
  bootstrap: BootstrapPayload;
  busy: boolean;
  isLandscape: boolean;
  navigation: ResolvedNavigation;
  onAction: (action: WorkspaceAction) => void;
  onClose: () => void;
  onForget: () => void;
  onOpenDiagnostics: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  open: boolean;
  theme: ChromeTheme;
}) {
  const [machineId, setMachineId] = useState(navigation.pane.machineId);
  const activeMachineId = bootstrap.machines.some((machine) => machine.id === machineId)
    ? machineId
    : navigation.pane.machineId;

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      supportedOrientations={["portrait", "landscape-left", "landscape-right"]}
      transparent
      visible={open}
    >
      <SafeAreaView style={styles.modalRoot}>
        <Pressable accessibilityLabel="Close workspace actions" onPress={onClose} style={styles.modalBackdrop} />
        <View
          style={[
            styles.actionSheet,
            isLandscape && styles.actionSheetLandscape,
            { backgroundColor: theme.panel, borderColor: theme.line },
          ]}
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={[styles.sheetKicker, { color: theme.accent }]}>WORKSPACE ACTIONS</Text>
              <Text style={[styles.sheetTitle, { color: theme.text }]}>{navigation.pane.title}</Text>
            </View>
            <SheetCloseButton onPress={onClose} theme={theme} />
          </View>
          <Text style={[styles.sectionLabel, { color: theme.muted }]}>TARGET HOST</Text>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.hostPicker}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {bootstrap.machines.map((machine) => {
              const selected = machine.id === activeMachineId;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: !machine.reachable }}
                  disabled={!machine.reachable}
                  key={machine.id}
                  onPress={() => setMachineId(machine.id)}
                  style={({ pressed }) => [
                    styles.hostPill,
                    { borderColor: selected ? theme.accent : theme.line },
                    selected && { backgroundColor: theme.accentDim },
                    !machine.reachable && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.hostDot, { backgroundColor: machine.reachable ? "#67d391" : "#ef7770" }]} />
                  <Text style={[styles.hostLabel, { color: selected ? theme.text : theme.muted }]}>{machine.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.actionGrid}>
            <ActionButton
              disabled={busy}
              label="New workspace"
              onPress={() => onAction({ type: "create-workspace", machineId: activeMachineId })}
              theme={theme}
            />
            <ActionButton
              disabled={busy}
              label="New tab"
              onPress={() => onAction({ type: "create-tab", machineId: activeMachineId })}
              theme={theme}
            />
            <ActionButton
              disabled={busy}
              label="Split right"
              onPress={() => onAction({ type: "split", direction: "horizontal", machineId: activeMachineId })}
              theme={theme}
            />
            <ActionButton
              disabled={busy}
              label="Split below"
              onPress={() => onAction({ type: "split", direction: "vertical", machineId: activeMachineId })}
              theme={theme}
            />
            <ActionButton label="Settings" onPress={onOpenSettings} theme={theme} />
            <ActionButton label="Diagnostics" onPress={onOpenDiagnostics} theme={theme} />
            <ActionButton label="Refresh" onPress={onRefresh} theme={theme} />
            <ActionButton label="Change server" onPress={onForget} theme={theme} />
          </View>
          <View style={[styles.dangerZone, { borderColor: theme.line }]}>
            <ActionButton
              danger
              disabled={busy}
              label="Close pane"
              onPress={() => onAction({ type: "close-pane" })}
              theme={theme}
            />
            <ActionButton
              danger
              disabled={busy}
              label="Close tab"
              onPress={() => onAction({ type: "close-tab" })}
              theme={theme}
            />
            <ActionButton
              danger
              disabled={busy}
              label="Close workspace"
              onPress={() => onAction({ type: "close-workspace" })}
              theme={theme}
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function WorkspaceSettingsSheet({
  onApply,
  onClose,
  open,
  settings,
  theme,
}: {
  onApply: (settings: WmuxSettings) => void;
  onClose: () => void;
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
  workspaceHeaderCopy: {
    flex: 1,
    minWidth: 54,
  },
  workspaceName: {
    fontSize: 12,
    fontWeight: "800",
  },
  workspaceContext: {
    fontFamily: fonts.mono,
    fontSize: 9,
    marginTop: 1,
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
  tabBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 38,
  },
  tabBarContent: {
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  tabPill: {
    alignItems: "center",
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    maxWidth: 160,
    minHeight: 29,
    paddingHorizontal: 9,
  },
  tabLabel: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "700",
  },
  tabCount: {
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "800",
  },
  paneBar: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 35,
    paddingLeft: 7,
  },
  paneBarLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    marginRight: 8,
  },
  paneBarContent: {
    alignItems: "center",
    gap: 6,
    paddingRight: 8,
  },
  panePill: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 27,
    paddingHorizontal: 8,
  },
  paneStatus: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  paneLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
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
    maxWidth: 390,
    padding: 16,
    position: "absolute",
    top: 0,
    width: "88%",
  },
  drawerList: {
    gap: 8,
    paddingBottom: 24,
  },
  drawerRow: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    minHeight: 74,
    padding: 11,
  },
  drawerIcon: {
    alignItems: "center",
    borderRadius: 9,
    height: 38,
    justifyContent: "center",
    width: 42,
  },
  drawerGlyph: {
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: "800",
  },
  drawerRowCopy: {
    flex: 1,
  },
  drawerRowTitle: {
    fontSize: 14,
    fontWeight: "800",
  },
  drawerRowMeta: {
    fontFamily: fonts.mono,
    fontSize: 9,
    marginTop: 4,
  },
  drawerDescriptor: {
    fontSize: 10,
    marginTop: 3,
  },
  actionSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    gap: 11,
    maxHeight: "86%",
    padding: 16,
  },
  actionSheetLandscape: {
    maxHeight: "96%",
    paddingVertical: 10,
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
    borderRadius: 9,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 42,
  },
  sheetCloseText: {
    fontSize: 22,
    lineHeight: 24,
  },
  sectionLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  hostPicker: {
    gap: 7,
  },
  hostPill: {
    alignItems: "center",
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 34,
    paddingHorizontal: 10,
  },
  hostDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  hostLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: "700",
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dangerZone: {
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingTop: 11,
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
