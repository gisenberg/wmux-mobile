import { DEFAULT_TERMINAL_FONT_FAMILY } from "../../../protocol/wmux";

import mesloBoldItalicUrl from "./fonts/meslo/meslo-lgm-nerd-font-mono-bold-italic.woff2?url";
import mesloBoldUrl from "./fonts/meslo/meslo-lgm-nerd-font-mono-bold.woff2?url";
import mesloItalicUrl from "./fonts/meslo/meslo-lgm-nerd-font-mono-italic.woff2?url";
import mesloRegularUrl from "./fonts/meslo/meslo-lgm-nerd-font-mono-regular.woff2?url";

export const BUNDLED_MESLO_FONT_FAMILY = "MesloLGM Nerd Font";

export const bundledMesloFontFaces = [
  new FontFace(BUNDLED_MESLO_FONT_FAMILY, `url(${mesloRegularUrl}) format("woff2")`, {
    style: "normal",
    weight: "400",
  }),
  new FontFace(BUNDLED_MESLO_FONT_FAMILY, `url(${mesloBoldUrl}) format("woff2")`, {
    style: "normal",
    weight: "700",
  }),
  new FontFace(BUNDLED_MESLO_FONT_FAMILY, `url(${mesloItalicUrl}) format("woff2")`, {
    style: "italic",
    weight: "400",
  }),
  new FontFace(BUNDLED_MESLO_FONT_FAMILY, `url(${mesloBoldItalicUrl}) format("woff2")`, {
    style: "italic",
    weight: "700",
  }),
];

export const terminalFontFamilyStack = (preferred: string): string => {
  const cleaned = preferred.trim();
  if (!cleaned || cleaned === DEFAULT_TERMINAL_FONT_FAMILY) return DEFAULT_TERMINAL_FONT_FAMILY;
  if (!CSS.supports("font-family", cleaned)) return DEFAULT_TERMINAL_FONT_FAMILY;
  return `${cleaned}, ${DEFAULT_TERMINAL_FONT_FAMILY}`;
};
