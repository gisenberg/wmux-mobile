export type Modifier = "ctrl" | "alt";
export type ModifierMode = "off" | "armed" | "locked";

export interface ModifierState {
  ctrl: ModifierMode;
  alt: ModifierMode;
  lastTap: { modifier: Modifier; at: number } | null;
}

export type ModifierAction = { type: "tap"; modifier: Modifier; at: number } | { type: "consume" } | { type: "reset" };

export const MODIFIER_DOUBLE_TAP_MS = 300;

export const initialModifierState: ModifierState = {
  ctrl: "off",
  alt: "off",
  lastTap: null,
};

export const modifierReducer = (state: ModifierState, action: ModifierAction): ModifierState => {
  if (action.type === "reset") return initialModifierState;

  if (action.type === "consume") {
    return {
      ctrl: state.ctrl === "armed" ? "off" : state.ctrl,
      alt: state.alt === "armed" ? "off" : state.alt,
      lastTap: null,
    };
  }

  const current = state[action.modifier];
  const doubleTap =
    current === "armed" &&
    state.lastTap?.modifier === action.modifier &&
    action.at - state.lastTap.at <= MODIFIER_DOUBLE_TAP_MS;
  const next: ModifierMode = doubleTap ? "locked" : current === "off" ? "armed" : "off";

  return {
    ...state,
    [action.modifier]: next,
    lastTap: next === "armed" ? { modifier: action.modifier, at: action.at } : null,
  };
};

export const modifierIsActive = (mode: ModifierMode): boolean => mode !== "off";
