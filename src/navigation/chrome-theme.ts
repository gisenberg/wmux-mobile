import type { TerminalColorSchemeId } from "../../protocol/wmux";

export interface ChromeTheme {
  accent: string;
  accentDim: string;
  canvas: string;
  line: string;
  muted: string;
  panel: string;
  text: string;
}

export const normalizeTerminalColorScheme = (scheme: string | undefined): TerminalColorSchemeId =>
  scheme && Object.hasOwn(themes, scheme) ? (scheme as TerminalColorSchemeId) : "wmux";

export const chromeTheme = (scheme: string | undefined): ChromeTheme => themes[normalizeTerminalColorScheme(scheme)];

const themes: Record<TerminalColorSchemeId, ChromeTheme> = {
  wmux: {
    accent: "#ffb454",
    accentDim: "#2a2015",
    canvas: "#0a0c0f",
    line: "#252a31",
    muted: "#818996",
    panel: "#11151a",
    text: "#f4f6f8",
  },
  "catppuccin-mocha": {
    accent: "#cba6f7",
    accentDim: "#29243a",
    canvas: "#11111b",
    line: "#313244",
    muted: "#9399b2",
    panel: "#181825",
    text: "#cdd6f4",
  },
  dracula: {
    accent: "#bd93f9",
    accentDim: "#302645",
    canvas: "#191a21",
    line: "#44475a",
    muted: "#9295a8",
    panel: "#282a36",
    text: "#f8f8f2",
  },
  nord: {
    accent: "#88c0d0",
    accentDim: "#243640",
    canvas: "#242933",
    line: "#4c566a",
    muted: "#8d98aa",
    panel: "#2e3440",
    text: "#eceff4",
  },
  "solarized-dark": {
    accent: "#2aa198",
    accentDim: "#123b3a",
    canvas: "#001f27",
    line: "#174652",
    muted: "#839496",
    panel: "#002b36",
    text: "#eee8d5",
  },
  "gruvbox-dark": {
    accent: "#fabd2f",
    accentDim: "#3a301c",
    canvas: "#1d2021",
    line: "#504945",
    muted: "#a89984",
    panel: "#282828",
    text: "#ebdbb2",
  },
  "tokyo-night": {
    accent: "#7aa2f7",
    accentDim: "#202c4a",
    canvas: "#16161e",
    line: "#3b4261",
    muted: "#787c99",
    panel: "#1a1b26",
    text: "#c0caf5",
  },
};
