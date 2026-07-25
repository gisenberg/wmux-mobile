import { KittyGraphicsParser, materializeKittyGraphic, shouldDisplayKittyGraphic } from "./vendor/wmux/kitty-graphics";
import { Osc52Parser } from "./vendor/wmux/terminal-osc52";

interface OutputPipelineOptions {
  write: (data: string) => void;
  onOsc52: (text: string) => void;
  onAlternateScreen: (active: boolean) => void;
  onMedia: (media: { name: string; mimeType: string; dataUrl: string }) => void;
  onIssue: (message: string) => void;
}

export class OutputPipeline {
  private osc52 = new Osc52Parser();
  private kitty = new KittyGraphicsParser();
  private alternateScreen = false;
  private alternateCarry = "";
  private generation = 0;

  constructor(private readonly options: OutputPipelineOptions) {}

  push(data: string): void {
    const generation = this.generation;
    const osc52 = this.osc52.push(data);
    for (const write of osc52.writes) this.options.onOsc52(write.text);
    this.trackAlternateScreen(osc52.text);
    const kitty = this.kitty.push(osc52.text);
    for (const graphic of kitty.graphics) {
      if (!shouldDisplayKittyGraphic(graphic)) continue;
      void materializeKittyGraphic(graphic)
        .then((image) => {
          if (generation !== this.generation) return;
          this.options.onMedia({
            name: image.name,
            mimeType: image.mimeType,
            dataUrl: `data:${image.mimeType};base64,${image.data}`,
          });
        })
        .catch((error: unknown) => {
          if (generation !== this.generation) return;
          this.options.onIssue(error instanceof Error ? error.message : "Kitty graphics decode failed");
        });
    }
    if (osc52.text) this.options.write(osc52.text);
  }

  reset(): void {
    this.generation += 1;
    this.osc52.reset();
    this.kitty = new KittyGraphicsParser();
    this.alternateCarry = "";
    if (this.alternateScreen) {
      this.alternateScreen = false;
      this.options.onAlternateScreen(false);
    }
  }

  private trackAlternateScreen(data: string): void {
    const input = this.alternateCarry + data;
    this.alternateCarry = input.slice(Math.max(0, input.length - 12));
    let active = this.alternateScreen;
    for (const match of input.matchAll(/\x1b\[\?(?:47|1047|1049)([hl])/g)) active = match[1] === "h";
    if (active === this.alternateScreen) return;
    this.alternateScreen = active;
    this.options.onAlternateScreen(active);
  }
}
