import type { ILink, ILinkProvider, Terminal as GhosttyTerminal } from "ghostty-web";

interface BufferCell {
  getCodepoint(): number;
}

interface BufferLine {
  readonly isWrapped: boolean;
  readonly length: number;
  getCell(column: number): BufferCell | undefined;
}

interface TerminalBuffer {
  readonly length: number;
  getLine(row: number): BufferLine | undefined;
}

interface CellPosition {
  x: number;
  y: number;
}

export interface DetectedTerminalUrl {
  range: {
    start: CellPosition;
    end: CellPosition;
  };
  text: string;
}

const HTTP_URL = /https?:\/\/[\w\-.~:/?#@!$&*+,;=%()]+/gi;
const TRAILING_PUNCTUATION = /[.,;!?\]]+$/;

export class WrappedUrlProvider implements ILinkProvider {
  constructor(private readonly terminal: Pick<GhosttyTerminal, "buffer">) {}

  provideLinks(row: number, callback: (links: ILink[] | undefined) => void): void {
    const detected = detectTerminalUrls(this.terminal.buffer.active, row);
    callback(
      detected.length === 0
        ? undefined
        : detected.map((link) => ({
            ...link,
            activate: () => undefined,
          })),
    );
  }

  dispose(): void {}
}

export const detectTerminalUrls = (buffer: TerminalBuffer, row: number): DetectedTerminalUrl[] => {
  const bounds = wrappedLineBounds(buffer, row);
  if (!bounds) return [];

  let text = "";
  const positions: CellPosition[] = [];
  for (let currentRow = bounds.start; currentRow <= bounds.end; currentRow += 1) {
    const line = buffer.getLine(currentRow);
    if (!line) continue;
    for (let column = 0; column < line.length; column += 1) {
      const codepoint = line.getCell(column)?.getCodepoint() ?? 0;
      const character = codepoint >= 32 ? String.fromCodePoint(codepoint) : " ";
      text += character;
      for (let index = 0; index < character.length; index += 1) {
        positions.push({ x: column, y: currentRow });
      }
    }
  }

  const links: DetectedTerminalUrl[] = [];
  HTTP_URL.lastIndex = 0;
  for (let match = HTTP_URL.exec(text); match; match = HTTP_URL.exec(text)) {
    const candidate = trimUrlPunctuation(match[0]);
    const start = positions[match.index];
    const end = positions[match.index + candidate.length - 1];
    if (!start || !end || candidate.length <= "https://".length) continue;
    links.push({ range: { start, end }, text: candidate });
  }
  return links;
};

const wrappedLineBounds = (buffer: TerminalBuffer, row: number): { start: number; end: number } | undefined => {
  if (row < 0 || row >= buffer.length || !buffer.getLine(row)) return undefined;
  let start = row;
  while (start > 0 && buffer.getLine(start)?.isWrapped) start -= 1;
  let end = row;
  while (end + 1 < buffer.length && buffer.getLine(end + 1)?.isWrapped) end += 1;
  return { start, end };
};

const trimUrlPunctuation = (value: string): string => {
  let result = value.replace(TRAILING_PUNCTUATION, "");
  while (result.endsWith(")")) {
    const opens = result.split("(").length - 1;
    const closes = result.split(")").length - 1;
    if (closes <= opens) break;
    result = result.slice(0, -1);
  }
  return result;
};
