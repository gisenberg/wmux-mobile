import { rm } from "node:fs/promises";

const keystorePath = process.env.ANDROID_KEYSTORE_PATH?.trim();
if (keystorePath) {
  await rm(keystorePath, { force: true });
  process.stdout.write("Removed the temporary Android signing key.\n");
}
