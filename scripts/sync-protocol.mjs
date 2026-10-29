import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  adjacentWmuxDirectory,
  currentCommit,
  pathExists,
  protocolVendorContents,
  readAtCommit,
  readPinnedCommit,
  sameBytes,
} from "./source-sync.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDirectory = path.join(projectRoot, "protocol");
const metadataFile = path.join(vendorDirectory, "SOURCE");
const retiredFiles = [path.join(vendorDirectory, "keybindings.d.ts")];

// The runtime keybinding module is vendored so native hardware shortcuts parse and match chords exactly like the
// web client. Each replacement adapts upstream code to this project's noUncheckedIndexedAccess setting and must apply.
const sources = [
  {
    sourcePath: "src/shared/keybindings.ts",
    vendorFile: path.join(vendorDirectory, "keybindings.ts"),
    replacements: [
      ["  })[0];\n  return formatKeyChord(preferred, apple);", "  })[0]!;\n  return formatKeyChord(preferred, apple);"],
      ["const leftAction = KEYBINDING_ACTIONS[leftIndex];", "const leftAction = KEYBINDING_ACTIONS[leftIndex]!;"],
      ["const rightAction = KEYBINDING_ACTIONS[rightIndex];", "const rightAction = KEYBINDING_ACTIONS[rightIndex]!;"],
    ],
  },
  {
    sourcePath: "src/shared/protocol.ts",
    vendorFile: path.join(vendorDirectory, "wmux.ts"),
    replacements: [],
  },
];
const check = process.argv.includes("--check");
const repositoryDirectory = adjacentWmuxDirectory(projectRoot);

const commitArgument = (() => {
  const index = process.argv.indexOf("--commit");
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || !/^[0-9a-f]{40}$/.test(value))
    throw new Error("--commit requires one full 40-character Git commit SHA");
  return value;
})();

const commit = check ? await readPinnedCommit(metadataFile) : (commitArgument ?? currentCommit(repositoryDirectory));
const expectedFiles = await Promise.all(
  sources.map(async ({ sourcePath, vendorFile, replacements }) => {
    const source = await readAtCommit({ repositoryDirectory, commit, sourcePath });
    return {
      sourcePath,
      vendorFile,
      expected: protocolVendorContents({
        commit,
        source: applyReplacements(source.toString("utf8"), replacements, sourcePath),
      }),
    };
  }),
);

if (check) {
  for (const { vendorFile, expected } of expectedFiles) {
    const relativeVendorFile = path.relative(projectRoot, vendorFile);
    if (!(await pathExists(vendorFile))) {
      throw new Error(`${relativeVendorFile} is missing; run npm run sync:protocol`);
    }
    const actual = await readFile(vendorFile);
    if (!sameBytes(actual, expected)) {
      throw new Error(`${relativeVendorFile} differs from its pinned wmux commit; run npm run sync:protocol`);
    }
  }
  for (const retiredFile of retiredFiles) {
    if (await pathExists(retiredFile)) {
      throw new Error(`${path.relative(projectRoot, retiredFile)} is retired; run npm run sync:protocol`);
    }
  }
  console.log(`protocol verified at wmux@${commit.slice(0, 12)}`);
} else {
  await mkdir(vendorDirectory, { recursive: true });
  await Promise.all(expectedFiles.map(({ vendorFile, expected }) => writeFile(vendorFile, expected)));
  await Promise.all(retiredFiles.map((retiredFile) => rm(retiredFile, { force: true })));
  await writeFile(metadataFile, `${commit}\n`);
  console.log(`protocol synced from wmux@${commit.slice(0, 12)}`);
}

function applyReplacements(source, replacements, sourcePath) {
  return replacements.reduce((contents, [search, replacement]) => {
    if (!contents.includes(search)) {
      throw new Error(`${sourcePath} no longer contains ${JSON.stringify(search)}; update scripts/sync-protocol.mjs`);
    }
    return contents.replace(search, replacement);
  }, source);
}
