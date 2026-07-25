import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { adjacentWmuxDirectory, currentCommit, pathExists, readAtCommit, sameBytes, sha256 } from "./source-sync.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = adjacentWmuxDirectory(projectRoot);
const vendorDirectory = path.join(projectRoot, "src", "terminal", "host", "vendor");
const vendorFile = path.join(vendorDirectory, "ghostty-web.tgz");
const metadataFile = path.join(vendorDirectory, "SOURCE.json");
const check = process.argv.includes("--check");

const readMetadata = async () => {
  const metadata = JSON.parse(await readFile(metadataFile, "utf8"));
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    typeof metadata.wmuxCommit !== "string" ||
    typeof metadata.sourcePath !== "string" ||
    typeof metadata.sha256 !== "string"
  ) {
    throw new Error("Ghostty source metadata is invalid");
  }
  return metadata;
};

if (check) {
  if (!(await pathExists(vendorFile)) || !(await pathExists(metadataFile))) {
    throw new Error("Ghostty vendor files are missing; run npm run sync:ghostty");
  }
  const metadata = await readMetadata();
  const expected = await readAtCommit({
    repositoryDirectory,
    commit: metadata.wmuxCommit,
    sourcePath: metadata.sourcePath,
  });
  const actual = await readFile(vendorFile);
  if (!sameBytes(actual, expected) || sha256(actual) !== metadata.sha256) {
    throw new Error("Ghostty vendor package differs from its pinned wmux source; run npm run sync:ghostty");
  }
  console.log(`ghostty-web verified at wmux@${metadata.wmuxCommit.slice(0, 12)}`);
} else {
  const wmuxPackage = JSON.parse(await readFile(path.join(repositoryDirectory, "package.json"), "utf8"));
  const dependency = wmuxPackage.dependencies?.["ghostty-web"];
  if (typeof dependency !== "string" || !dependency.startsWith("file:vendor/") || !dependency.endsWith(".tgz")) {
    throw new Error("wmux package.json must select one vendored Ghostty Web tarball");
  }
  const commit = currentCommit(repositoryDirectory);
  const sourcePath = dependency.slice("file:".length);
  const contents = await readFile(path.join(repositoryDirectory, sourcePath));
  const metadata = {
    repository: "https://github.com/gisenberg/wmux",
    sourcePath,
    wmuxCommit: commit,
    sha256: sha256(contents),
  };
  await mkdir(vendorDirectory, { recursive: true });
  await writeFile(vendorFile, contents);
  await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`ghostty-web synced from wmux@${commit.slice(0, 12)}`);
}
