import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const sourcePath = "src/shared/protocol.ts";
const vendorDirectory = path.join(projectRoot, "protocol");
const vendorFile = path.join(vendorDirectory, "wmux.ts");
const sourceFile = path.join(vendorDirectory, "SOURCE");
const check = process.argv.includes("--check");
const repositoryDirectory = adjacentWmuxDirectory(projectRoot);

const commit = check ? await readPinnedCommit(sourceFile) : currentCommit(repositoryDirectory);
const source = await readAtCommit({ repositoryDirectory, commit, sourcePath });
const expected = protocolVendorContents({ commit, source: source.toString("utf8") });

if (check) {
  if (!(await pathExists(vendorFile))) {
    throw new Error("protocol/wmux.ts is missing; run npm run sync:protocol");
  }
  const actual = await readFile(vendorFile);
  if (!sameBytes(actual, expected)) {
    throw new Error("protocol/wmux.ts differs from its pinned wmux commit; run npm run sync:protocol");
  }
  console.log(`protocol verified at wmux@${commit.slice(0, 12)}`);
} else {
  await mkdir(vendorDirectory, { recursive: true });
  await writeFile(vendorFile, expected);
  await writeFile(sourceFile, `${commit}\n`);
  console.log(`protocol synced from wmux@${commit.slice(0, 12)}`);
}
