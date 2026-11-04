export type FormFactor = "compact" | "regular";

/**
 * Window widths at or above this keep the workspace sidebar beside the terminal. It covers every iPad in landscape,
 * a 13-inch iPad in portrait, and large Stage Manager or Split View windows; narrower windows use the phone drawer.
 */
export const REGULAR_LAYOUT_MIN_WIDTH = 900;

export const SIDEBAR_WIDTH = 296;

export const formFactorForWidth = (width: number): FormFactor =>
  width >= REGULAR_LAYOUT_MIN_WIDTH ? "regular" : "compact";
