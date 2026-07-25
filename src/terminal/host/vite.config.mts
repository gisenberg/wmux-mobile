import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const hostDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: hostDirectory,
  base: "./",
  plugins: [viteSingleFile()],
  build: {
    target: ["ios15", "chrome100"],
    outDir: path.resolve(hostDirectory, "../../../dist/terminal-host"),
    emptyOutDir: true,
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      input: path.join(hostDirectory, "index.html"),
    },
  },
});
