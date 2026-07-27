const allowedProtocols = new Set(["http:", "https:"]);

export const normalizeTerminalLink = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return allowedProtocols.has(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};
