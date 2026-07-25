import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist", "terminal-host");
const outputFile = path.join(outputDirectory, "index.html");
const entries = await readdir(outputDirectory);

if (entries.length !== 1 || entries[0] !== "index.html") {
  throw new Error(`Terminal host output must contain only index.html; found: ${entries.join(", ")}`);
}

const output = await readFile(outputFile, "utf8");
const outputStats = await stat(outputFile);

if (!output.includes("data:application/wasm;base64,")) {
  throw new Error("Terminal host does not contain an inline WASM module");
}

if (/<script\b[^>]*\bsrc=/iu.test(output) || /<link\b[^>]*\brel=["']?stylesheet/iu.test(output)) {
  throw new Error("Terminal host contains an external script or stylesheet");
}

if (/\b(?:https?|wss?):\/\//iu.test(output)) {
  throw new Error("Terminal host contains an unexpected absolute network URL");
}

console.log(`terminal host verified as one offline HTML file (${outputStats.size} bytes)`);
