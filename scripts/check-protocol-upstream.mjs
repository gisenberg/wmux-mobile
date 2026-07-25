import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPinnedCommit, WMUX_REPOSITORY } from "./source-sync.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pinned = await readPinnedCommit(path.join(projectRoot, "protocol", "SOURCE"));
const output = execFileSync("git", ["ls-remote", `${WMUX_REPOSITORY}.git`, "refs/heads/main"], {
  encoding: "utf8",
}).trim();
const upstream = output.split(/\s+/)[0];

if (!/^[0-9a-f]{40}$/.test(upstream)) {
  throw new Error("Unable to resolve wmux main");
}

const current = pinned === upstream;
console.log(JSON.stringify({ current, pinned, upstream }));
if (!current) process.exitCode = 2;
