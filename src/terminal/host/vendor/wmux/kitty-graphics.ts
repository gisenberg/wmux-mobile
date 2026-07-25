// @generated from wmux@8488e2396bc33f004389cb4bdb3d02d537f1d03c:src/client/src/kitty-graphics.ts; do not edit.
export interface KittyGraphicPayload {
  action: string;
  imageId?: string;
  placementId?: string;
  quiet: string;
  format: "24" | "32" | "100";
  compression?: string;
  width?: number;
  height?: number;
  virtualPlacement: boolean;
  displayColumns?: number;
  displayRows?: number;
  payloadBase64: string;
}

export interface KittyControlOperation {
  action: string;
  imageId?: string;
  quiet: string;
  error?: string;
}

export interface KittyParseResult {
  text: string;
  graphics: KittyGraphicPayload[];
  controls: KittyControlOperation[];
  events: KittyParseEvent[];
}

export type KittyParseEvent =
  | { kind: "text"; text: string }
  | { kind: "graphic"; graphic: KittyGraphicPayload }
  | { kind: "control"; control: KittyControlOperation };

export interface KittyMaterializedImage {
  name: string;
  mimeType: string;
  data: string;
}

export interface KittyPlaceholderStripState {
  pendingPlaceholderMarks: boolean;
}

interface KittyTransfer {
  control: Record<string, string>;
  payloadParts: string[];
}

const APC_START = "\x1b_G";
const ST = "\x1b\\";
const BEL = "\x07";
const MAX_CARRY_CHARS = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

export class KittyGraphicsParser {
  private carry = "";
  private transfer: KittyTransfer | null = null;

  push(data: string): KittyParseResult {
    const graphics: KittyGraphicPayload[] = [];
    const controls: KittyControlOperation[] = [];
    const events: KittyParseEvent[] = [];
    let text = "";
    let input = this.carry + data;
    this.carry = "";

    while (input.length > 0) {
      const start = input.indexOf(APC_START);
      if (start === -1) {
        text += input;
        if (input) events.push({ kind: "text", text: input });
        break;
      }

      const leadingText = input.slice(0, start);
      text += leadingText;
      if (leadingText) events.push({ kind: "text", text: leadingText });
      const bodyStart = start + APC_START.length;
      const end = findTerminator(input, bodyStart);
      if (!end) {
        this.carry = input.slice(start).slice(0, MAX_CARRY_CHARS);
        break;
      }

      const body = input.slice(bodyStart, end.index);
      const operation = this.parseOperation(body);
      if (operation.kind === "graphic") {
        graphics.push(operation.graphic);
        events.push({ kind: "graphic", graphic: operation.graphic });
      }
      if (operation.kind === "control") {
        controls.push(operation.control);
        events.push({ kind: "control", control: operation.control });
      }
      input = input.slice(end.index + end.length);
    }

    return { text, graphics, controls, events };
  }

  private parseOperation(body: string): { kind: "graphic"; graphic: KittyGraphicPayload } | { kind: "control"; control: KittyControlOperation } | { kind: "none" } {
    const semicolon = body.indexOf(";");
    const control = parseControl(semicolon === -1 ? body : body.slice(0, semicolon));
    const payload = semicolon === -1 ? "" : body.slice(semicolon + 1).replace(/\s+/g, "");
    const chunkState = control.m;
    const action = control.a ?? "";

    if (chunkState === "1") {
      if (!this.transfer) {
        this.transfer = { control, payloadParts: [payload] };
      } else {
        this.transfer.payloadParts.push(payload);
      }
      return { kind: "none" };
    }

    if (this.transfer) {
      this.transfer.payloadParts.push(payload);
      const merged = { ...this.transfer.control, ...control };
      const payloadBase64 = this.transfer.payloadParts.join("");
      this.transfer = null;
      return this.operationFromControl(merged, payloadBase64);
    }

    if (!payload) {
      return {
        kind: "control",
        control: {
          action,
          ...(control.i === undefined ? {} : { imageId: control.i }),
          quiet: control.q ?? "",
          error: "EINVAL: unsupported Kitty graphics transmission medium",
        },
      };
    }

    return this.operationFromControl(control, payload);
  }

  private operationFromControl(control: Record<string, string>, payloadBase64: string): { kind: "graphic"; graphic: KittyGraphicPayload } | { kind: "control"; control: KittyControlOperation } {
    const action = control.a ?? "";
    const transmission = control.t ?? "d";
    if (transmission !== "d") {
      return { kind: "control", control: { action, ...(control.i === undefined ? {} : { imageId: control.i }), quiet: control.q ?? "" } };
    }

    const format = control.f === "24" || control.f === "100" ? control.f : "32";
    return {
      kind: "graphic",
      graphic: {
        action,
        ...(control.i === undefined ? {} : { imageId: control.i }),
        ...(control.p === undefined ? {} : { placementId: control.p }),
        quiet: control.q ?? "",
        format,
        ...(control.o === undefined ? {} : { compression: control.o }),
        ...(parsePositiveInt(control.s) === undefined ? {} : { width: parsePositiveInt(control.s) as number }),
        ...(parsePositiveInt(control.v) === undefined ? {} : { height: parsePositiveInt(control.v) as number }),
        virtualPlacement: control.U === "1",
        ...(parsePositiveInt(control.c) === undefined ? {} : { displayColumns: parsePositiveInt(control.c) as number }),
        ...(parsePositiveInt(control.r) === undefined ? {} : { displayRows: parsePositiveInt(control.r) as number }),
        payloadBase64,
      },
    };
  }
}

export const shouldDisplayKittyGraphic = (graphic: KittyGraphicPayload): boolean => {
  if (graphic.virtualPlacement) return false;
  if (graphic.action === "q" || graphic.action === "t") return false;
  if (graphic.action === "T") return true;
  return !graphic.imageId;
};

export const shouldRespondToKitty = (quiet: string, status: "ok" | "error"): boolean => {
  if (quiet === "2") return false;
  if (status === "ok" && quiet === "1") return false;
  return true;
};

export const kittyResponse = (imageId: string, message: string): string => `\x1b_Gi=${imageId};${message}\x1b\\`;

export const materializeKittyGraphic = async (graphic: KittyGraphicPayload): Promise<KittyMaterializedImage> => {
  let bytes = base64ToBytes(graphic.payloadBase64);
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("image too large");
  if (graphic.compression === "z") bytes = await decompressZlib(bytes);
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("image too large");

  if (graphic.format === "100") {
    return {
      name: graphic.imageId ? `kitty-${graphic.imageId}.png` : "kitty-image.png",
      mimeType: "image/png",
      data: bytesToBase64(bytes),
    };
  }

  const width = graphic.width;
  const height = graphic.height;
  if (!width || !height) throw new Error("RGB/RGBA Kitty images require width and height");
  const bytesPerPixel = graphic.format === "24" ? 3 : 4;
  if (bytes.byteLength < width * height * bytesPerPixel) throw new Error("image payload is truncated");

  const rgba = new Uint8ClampedArray(width * height * 4);
  if (graphic.format === "24") {
    for (let src = 0, dst = 0; dst < rgba.length; src += 3, dst += 4) {
      rgba[dst] = bytes[src]!;
      rgba[dst + 1] = bytes[src + 1]!;
      rgba[dst + 2] = bytes[src + 2]!;
      rgba[dst + 3] = 255;
    }
  } else {
    rgba.set(bytes.slice(0, rgba.length));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.putImageData(new ImageData(rgba, width, height), 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  return {
    name: graphic.imageId ? `kitty-${graphic.imageId}.png` : "kitty-image.png",
    mimeType: "image/png",
    data: dataUrl.slice(dataUrl.indexOf(",") + 1),
  };
};

export const stripKittyPlaceholders = (value: string, state?: KittyPlaceholderStripState): string => {
  let stripped = "";
  const chars = Array.from(value);
  let previousWasPlaceholder = state?.pendingPlaceholderMarks ?? false;
  if (state) state.pendingPlaceholderMarks = false;
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    if (isKittyPlaceholder(char)) {
      while (isKittyPlaceholderMark(chars[index + 1])) index += 1;
      previousWasPlaceholder = true;
      continue;
    }
    if (previousWasPlaceholder && isKittyPlaceholderMark(char)) {
      previousWasPlaceholder = true;
      continue;
    }
    if (char === "\b" && (previousWasPlaceholder || nextNonMarkIsPlaceholder(chars, index + 1))) {
      previousWasPlaceholder = true;
      continue;
    }
    stripped += char;
    previousWasPlaceholder = false;
  }
  if (state) state.pendingPlaceholderMarks = previousWasPlaceholder;
  return stripped;
};

export const isKittyPlaceholder = (value?: string): boolean => value?.codePointAt(0) === 0x10eeee;

export const nextNonMarkIsPlaceholder = (chars: string[], start: number): boolean => {
  for (let index = start; index < chars.length; index += 1) {
    if (isKittyPlaceholderMark(chars[index])) continue;
    return isKittyPlaceholder(chars[index]);
  }
  return false;
};

const KITTY_PLACEHOLDER_MARK_RANGES: Array<[number, number]> = [
  [0x0305, 0x0305],
  [0x030d, 0x030e],
  [0x0310, 0x0310],
  [0x0312, 0x0312],
  [0x033d, 0x033f],
  [0x0346, 0x0346],
  [0x034a, 0x034c],
  [0x0350, 0x0352],
  [0x0357, 0x0357],
  [0x035b, 0x035b],
  [0x0363, 0x036f],
  [0x0483, 0x0487],
  [0x0592, 0x0595],
  [0x0597, 0x0599],
  [0x059c, 0x05a1],
  [0x05a8, 0x05a9],
  [0x05ab, 0x05ac],
  [0x05af, 0x05af],
  [0x05c4, 0x05c4],
  [0x0610, 0x0617],
  [0x0657, 0x065b],
  [0x065d, 0x065e],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e2],
  [0x06e4, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06eb, 0x06ec],
  [0x0730, 0x0730],
  [0x0732, 0x0733],
  [0x0735, 0x0736],
  [0x073a, 0x073a],
  [0x073d, 0x073d],
  [0x073f, 0x0741],
  [0x0743, 0x0743],
  [0x0745, 0x0745],
  [0x0747, 0x0747],
  [0x0749, 0x074a],
  [0x07eb, 0x07f1],
  [0x07f3, 0x07f3],
  [0x0816, 0x0819],
  [0x081b, 0x0823],
  [0x0825, 0x0827],
  [0x0829, 0x082d],
  [0x0951, 0x0951],
  [0x0953, 0x0954],
  [0x0f82, 0x0f83],
  [0x0f86, 0x0f87],
  [0x135d, 0x135f],
  [0x17dd, 0x17dd],
  [0x193a, 0x193a],
  [0x1a17, 0x1a17],
  [0x1a75, 0x1a7c],
  [0x1b6b, 0x1b6b],
  [0x1b6d, 0x1b73],
  [0x1cd0, 0x1cd2],
  [0x1cda, 0x1cdb],
  [0x1ce0, 0x1ce0],
  [0x1dc0, 0x1dc1],
  [0x1dc3, 0x1dc9],
  [0x1dcb, 0x1dcc],
  [0x1dd1, 0x1de6],
  [0x1dfe, 0x1dfe],
  [0x20d0, 0x20d1],
  [0x20d4, 0x20d7],
  [0x20db, 0x20dc],
  [0x20e1, 0x20e1],
  [0x20e7, 0x20e7],
  [0x20e9, 0x20e9],
  [0x20f0, 0x20f0],
  [0x2cef, 0x2cf1],
  [0x2de0, 0x2dff],
  [0xa66f, 0xa66f],
  [0xa67c, 0xa67d],
  [0xa6f0, 0xa6f1],
  [0xa8e0, 0xa8f1],
  [0xaab0, 0xaab0],
  [0xaab2, 0xaab3],
  [0xaab7, 0xaab8],
  [0xaabe, 0xaabf],
  [0xaac1, 0xaac1],
  [0xfe20, 0xfe26],
  [0x10a0f, 0x10a0f],
  [0x10a38, 0x10a38],
  [0x1d185, 0x1d189],
  [0x1d1aa, 0x1d1ad],
  [0x1d242, 0x1d244],
];

export const isKittyPlaceholderMark = (value?: string): boolean => {
  const codePoint = value?.codePointAt(0);
  if (!codePoint) return false;
  return KITTY_PLACEHOLDER_MARK_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
};

const findTerminator = (value: string, from: number): { index: number; length: number } | null => {
  const st = value.indexOf(ST, from);
  const bel = value.indexOf(BEL, from);
  if (st === -1 && bel === -1) return null;
  if (st !== -1 && (bel === -1 || st < bel)) return { index: st, length: ST.length };
  return { index: bel, length: BEL.length };
};

const parseControl = (value: string): Record<string, string> => {
  const control: Record<string, string> = {};
  for (const part of value.split(",")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) {
      control[part] = "";
    } else {
      control[part.slice(0, eq)] = part.slice(eq + 1);
    }
  }
  return control;
};

const parsePositiveInt = (value?: string): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const base64ToBytes = (value: string): Uint8Array => {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const decompressZlib = async (bytes: Uint8Array): Promise<Uint8Array> => {
  if (!("DecompressionStream" in globalThis)) throw new Error("zlib decompression is unavailable in this browser");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};
