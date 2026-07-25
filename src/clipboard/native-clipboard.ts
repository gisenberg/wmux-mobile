import * as Clipboard from "expo-clipboard";

export interface NativeClipboardImage {
  dataUrl: string;
  height: number;
  width: number;
}

export const writeNativeClipboardText = async (text: string): Promise<void> => {
  await Clipboard.setStringAsync(text, { inputFormat: Clipboard.StringFormat.PLAIN_TEXT });
};

export const readNativeClipboardText = async (): Promise<string> =>
  Clipboard.getStringAsync({ preferredFormat: Clipboard.StringFormat.PLAIN_TEXT });

export const readNativeClipboardImage = async (): Promise<NativeClipboardImage | null> => {
  const image = await Clipboard.getImageAsync({ format: "png" });
  return image
    ? {
        dataUrl: image.data,
        height: image.size.height,
        width: image.size.width,
      }
    : null;
};
