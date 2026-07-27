import { Buffer } from "node:buffer";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const encodedKeystore = requiredEnvironment("ANDROID_KEYSTORE_BASE64");
const keystore = Buffer.from(encodedKeystore.replaceAll(/\s/g, ""), "base64");
if (keystore.length < 1_000) {
  throw new Error("Decoded Android keystore is unexpectedly small.");
}

const temporaryDirectory = process.env.RUNNER_TEMP?.trim() || tmpdir();
const signingDirectory = join(temporaryDirectory, "wmux-mobile-android-signing");
const keystorePath = join(signingDirectory, "wmux-mobile-release.p12");
await mkdir(signingDirectory, { recursive: true, mode: 0o700 });
await writeFile(keystorePath, keystore, { mode: 0o600 });

if (process.env.GITHUB_ENV) {
  await appendFile(process.env.GITHUB_ENV, `ANDROID_KEYSTORE_PATH=${keystorePath}\n`, "utf8");
}
process.stdout.write("Materialized the temporary Android signing key.\n");
