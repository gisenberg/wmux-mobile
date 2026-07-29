import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import ts from "typescript";

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
const sources = [
  {
    sourcePath: "src/shared/keybindings.ts",
    vendorFile: path.join(vendorDirectory, "keybindings.d.ts"),
    declarationOnly: true,
  },
  {
    sourcePath: "src/shared/protocol.ts",
    vendorFile: path.join(vendorDirectory, "wmux.ts"),
  },
];
const check = process.argv.includes("--check");
const repositoryDirectory = adjacentWmuxDirectory(projectRoot);

const commit = check ? await readPinnedCommit(metadataFile) : currentCommit(repositoryDirectory);
const expectedFiles = await Promise.all(
  sources.map(async ({ sourcePath, vendorFile, declarationOnly = false }) => {
    const source = await readAtCommit({ repositoryDirectory, commit, sourcePath });
    const sourceText = source.toString("utf8");
    return {
      sourcePath,
      vendorFile,
      expected: protocolVendorContents({
        commit,
        source: declarationOnly ? await declarationContents(sourceText, sourcePath) : sourceText,
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
  console.log(`protocol verified at wmux@${commit.slice(0, 12)}`);
} else {
  await mkdir(vendorDirectory, { recursive: true });
  await Promise.all(expectedFiles.map(({ vendorFile, expected }) => writeFile(vendorFile, expected)));
  await writeFile(metadataFile, `${commit}\n`);
  console.log(`protocol synced from wmux@${commit.slice(0, 12)}`);
}

async function declarationContents(source, sourcePath) {
  const result = ts.transpileDeclaration(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: path.basename(sourcePath),
    reportDiagnostics: true,
  });
  if ((result.diagnostics?.length ?? 0) > 0) {
    throw new Error(
      ts.formatDiagnostics(result.diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => projectRoot,
        getNewLine: () => "\n",
      }),
    );
  }
  return format(result.outputText, {
    ...(await resolveConfig(path.join(projectRoot, "protocol", "keybindings.d.ts"))),
    parser: "typescript",
  });
}
