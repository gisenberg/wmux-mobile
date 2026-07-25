import { Platform } from "react-native";

export const colors = {
  accent: "#ffb454",
  accentDim: "#241d15",
  accentLine: "#4a3720",
  canvas: "#0a0c0f",
  line: "#252a31",
  muted: "#818996",
  panel: "#11151a",
  secondaryText: "#aab1bb",
  success: "#67d391",
  successDim: "#173326",
  terminal: "#080a0d",
  terminalText: "#b9c2cd",
  text: "#f4f6f8",
} as const;

export const fonts = {
  mono: Platform.select({
    android: "monospace",
    default: "Menlo",
    web: "monospace",
  }),
} as const;
