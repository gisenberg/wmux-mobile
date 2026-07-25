import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

const keyPath = process.env.ASC_API_KEY_PATH?.trim();
const runnerTemp = process.env.RUNNER_TEMP?.trim();

if (keyPath && runnerTemp) {
  const resolvedKeyPath = resolve(keyPath);
  const resolvedRunnerTemp = `${resolve(runnerTemp)}${sep}`;
  if (!resolvedKeyPath.startsWith(resolvedRunnerTemp)) {
    throw new Error("Refusing to remove an App Store key outside RUNNER_TEMP.");
  }
  await rm(resolvedKeyPath, { force: true });
}
