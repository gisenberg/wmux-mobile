import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { adjacentWmuxDirectory, currentCommit, pathExists, readAtCommit, sameBytes, sha256 } from "./source-sync.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = adjacentWmuxDirectory(projectRoot);
const vendorDirectory = path.join(projectRoot, "src", "terminal", "host", "vendor", "wmux");
const metadataFile = path.join(vendorDirectory, "SOURCE.json");
const check = process.argv.includes("--check");

const sources = [
  {
    sourcePath: "src/client/src/terminal-osc52.ts",
    destination: "terminal-osc52.ts",
    transform: (contents) => contents,
  },
  {
    sourcePath: "src/client/src/kitty-graphics.ts",
    destination: "kitty-graphics.ts",
    transform: (contents) =>
      contents
        .replaceAll("imageId: control.i,", "...(control.i === undefined ? {} : { imageId: control.i }),")
        .replace("placementId: control.p,", "...(control.p === undefined ? {} : { placementId: control.p }),")
        .replace("compression: control.o,", "...(control.o === undefined ? {} : { compression: control.o }),")
        .replace(
          "width: parsePositiveInt(control.s),",
          "...(parsePositiveInt(control.s) === undefined ? {} : { width: parsePositiveInt(control.s) as number }),",
        )
        .replace(
          "height: parsePositiveInt(control.v),",
          "...(parsePositiveInt(control.v) === undefined ? {} : { height: parsePositiveInt(control.v) as number }),",
        )
        .replace(
          "displayColumns: parsePositiveInt(control.c),",
          "...(parsePositiveInt(control.c) === undefined ? {} : { displayColumns: parsePositiveInt(control.c) as number }),",
        )
        .replace(
          "displayRows: parsePositiveInt(control.r),",
          "...(parsePositiveInt(control.r) === undefined ? {} : { displayRows: parsePositiveInt(control.r) as number }),",
        )
        .replace("rgba[dst] = bytes[src];", "rgba[dst] = bytes[src]!;")
        .replace("rgba[dst + 1] = bytes[src + 1];", "rgba[dst + 1] = bytes[src + 1]!;")
        .replace("rgba[dst + 2] = bytes[src + 2];", "rgba[dst + 2] = bytes[src + 2]!;"),
  },
  {
    sourcePath: "src/client/src/color-schemes.ts",
    destination: "color-schemes.ts",
    transform: (contents) =>
      contents
        .replace(
          'import type { TerminalColorSchemeId } from "./types";',
          'import type { TerminalColorSchemeId } from "../../../bridge";',
        )
        .replace("schemesById.get(id) ?? terminalColorSchemes[0];", "schemesById.get(id) ?? terminalColorSchemes[0]!;")
        .replace(
          'const channel = (index: number) => Math.round(left[index] + (right[index] - left[index]) * amount);\n  return `#${[channel(0), channel(1), channel(2)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;',
          'const channel = (index: 0 | 1 | 2) => Math.round(left[index] + (right[index] - left[index]) * amount);\n  return `#${[channel(0), channel(1), channel(2)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;',
        ),
  },
];

const generatedContents = (source, commit, contents) => {
  const header = `// @generated from wmux@${commit}:${source.sourcePath}; do not edit.\n`;
  return Buffer.from(`${header}${source.transform(contents.toString("utf8"))}`);
};

const readMetadata = async () => {
  const metadata = JSON.parse(await readFile(metadataFile, "utf8"));
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    typeof metadata.wmuxCommit !== "string" ||
    !Array.isArray(metadata.sources)
  ) {
    throw new Error("Terminal source metadata is invalid");
  }
  return metadata;
};

if (check) {
  if (!(await pathExists(metadataFile))) {
    throw new Error("Terminal source metadata is missing; run npm run sync:terminal-sources");
  }
  const metadata = await readMetadata();
  for (const source of sources) {
    const destinationFile = path.join(vendorDirectory, source.destination);
    if (!(await pathExists(destinationFile))) {
      throw new Error(`Terminal source ${source.destination} is missing; run npm run sync:terminal-sources`);
    }
    const pinned = metadata.sources.find((candidate) => candidate.destination === source.destination);
    if (
      !pinned ||
      pinned.sourcePath !== source.sourcePath ||
      typeof pinned.sourceSha256 !== "string" ||
      typeof pinned.generatedSha256 !== "string"
    ) {
      throw new Error(`Terminal source metadata for ${source.destination} is invalid`);
    }
    const sourceContents = await readAtCommit({
      repositoryDirectory,
      commit: metadata.wmuxCommit,
      sourcePath: source.sourcePath,
    });
    const expected = generatedContents(source, metadata.wmuxCommit, sourceContents);
    const actual = await readFile(destinationFile);
    if (
      sha256(sourceContents) !== pinned.sourceSha256 ||
      sha256(expected) !== pinned.generatedSha256 ||
      !sameBytes(actual, expected)
    ) {
      throw new Error(`Terminal source ${source.destination} differs from wmux; run npm run sync:terminal-sources`);
    }
  }
  console.log(`terminal runtime sources verified at wmux@${metadata.wmuxCommit.slice(0, 12)}`);
} else {
  const commit = currentCommit(repositoryDirectory);
  const metadata = {
    repository: "https://github.com/gisenberg/wmux",
    wmuxCommit: commit,
    sources: [],
  };
  await mkdir(vendorDirectory, { recursive: true });
  for (const source of sources) {
    const sourceContents = await readAtCommit({
      repositoryDirectory,
      commit,
      sourcePath: source.sourcePath,
    });
    const generated = generatedContents(source, commit, sourceContents);
    await writeFile(path.join(vendorDirectory, source.destination), generated);
    metadata.sources.push({
      sourcePath: source.sourcePath,
      destination: source.destination,
      sourceSha256: sha256(sourceContents),
      generatedSha256: sha256(generated),
    });
  }
  await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`terminal runtime sources synced from wmux@${commit.slice(0, 12)}`);
}
