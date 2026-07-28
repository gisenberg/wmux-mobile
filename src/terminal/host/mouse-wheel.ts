export interface MouseWheelTerminal {
  cols: number;
  rows: number;
  hasMouseTracking(): boolean;
  getMode(mode: number): boolean;
  renderer?: { getMetrics(): { width: number; height: number } | undefined };
}

const MAX_WHEEL_EVENTS = 5;

export const mouseWheelInput = (
  terminal: MouseWheelTerminal,
  deltaLines: number,
  xPx: number,
  yPx: number,
): string | undefined => {
  if (!hasMouseTracking(terminal) || !Number.isFinite(deltaLines) || deltaLines === 0) return undefined;
  const { col, row } = mouseCell(terminal, xPx, yPx, supportsUtf8Coordinates(terminal));
  const button = deltaLines < 0 ? 64 : 65;
  const sequence = supportsSgrMouse(terminal)
    ? `\x1b[<${button};${col};${row}M`
    : `\x1b[M${String.fromCharCode(32 + button)}${String.fromCharCode(32 + col)}${String.fromCharCode(32 + row)}`;
  return sequence.repeat(Math.min(MAX_WHEEL_EVENTS, Math.max(1, Math.round(Math.abs(deltaLines)))));
};

const hasMouseTracking = (terminal: MouseWheelTerminal): boolean => {
  try {
    return terminal.hasMouseTracking();
  } catch {
    return false;
  }
};

const supportsSgrMouse = (terminal: MouseWheelTerminal): boolean => {
  try {
    return terminal.getMode(1006);
  } catch {
    return true;
  }
};

const supportsUtf8Coordinates = (terminal: MouseWheelTerminal): boolean => {
  try {
    return terminal.getMode(1005);
  } catch {
    return false;
  }
};

const mouseCell = (
  terminal: MouseWheelTerminal,
  xPx: number,
  yPx: number,
  supportsUtf8: boolean,
): { col: number; row: number } => {
  const metrics = terminal.renderer?.getMetrics();
  const width = metrics?.width ?? 8;
  const height = metrics?.height ?? 16;
  const maximum = supportsUtf8 ? Number.MAX_SAFE_INTEGER : 95;
  return {
    col: clamp(Math.floor(xPx / width) + 1, 1, Math.min(maximum, Math.max(1, terminal.cols))),
    row: clamp(Math.floor(yPx / height) + 1, 1, Math.min(maximum, Math.max(1, terminal.rows))),
  };
};

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(Math.max(value, minimum), maximum);
