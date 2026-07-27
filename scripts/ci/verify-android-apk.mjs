import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const expectedAndroidApplicationId = "com.gisenberg.wmuxmobile";

export function verifyAndroidApkMetadata(
  metadata,
  { applicationId = expectedAndroidApplicationId, versionCode, versionName },
) {
  if (metadata?.artifactType?.type !== "APK" || metadata?.variantName !== "release") {
    throw new Error("Android build output is not a release APK.");
  }
  if (metadata.applicationId !== applicationId) {
    throw new Error(`Android application ID is ${String(metadata.applicationId)}, expected ${applicationId}.`);
  }
  if (!Array.isArray(metadata.elements) || metadata.elements.length !== 1) {
    throw new Error("Android release must contain exactly one universal APK.");
  }

  const element = metadata.elements[0];
  if (element.type !== "SINGLE" || !Array.isArray(element.filters) || element.filters.length) {
    throw new Error("Android release output is not a universal APK.");
  }
  if (element.versionCode !== versionCode) {
    throw new Error(`Android APK version code is ${String(element.versionCode)}, expected ${versionCode}.`);
  }
  if (element.versionName !== versionName) {
    throw new Error(`Android APK version name is ${String(element.versionName)}, expected ${versionName}.`);
  }
  if (typeof element.outputFile !== "string" || !element.outputFile.endsWith(".apk")) {
    throw new Error("Android release metadata does not identify an APK file.");
  }

  return {
    applicationId,
    outputFile: element.outputFile,
    versionCode,
    versionName,
  };
}

export async function loadVerifiedAndroidApk(metadataPath, { versionCode, versionName }) {
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const release = verifyAndroidApkMetadata(metadata, {
    versionCode,
    versionName,
  });
  const apkPath = join(dirname(metadataPath), release.outputFile);
  const apkStat = await stat(apkPath);
  if (!apkStat.isFile() || apkStat.size < 1_000_000) {
    throw new Error(`Android release APK is missing or unexpectedly small: ${apkPath}`);
  }
  return {
    ...release,
    apkPath,
    size: apkStat.size,
  };
}

async function main() {
  const metadataPath = process.argv[2];
  if (!metadataPath) {
    throw new Error("Usage: node scripts/ci/verify-android-apk.mjs <output-metadata.json>");
  }

  const appConfig = JSON.parse(await readFile(new URL("../../app.json", import.meta.url), "utf8"));
  const versionName = appConfig.expo?.version;
  const versionCode = Number.parseInt(process.env.ANDROID_VERSION_CODE ?? "", 10);
  const release = await loadVerifiedAndroidApk(metadataPath, {
    versionCode,
    versionName,
  });
  process.stdout.write(
    `Verified signed Android APK: ${JSON.stringify({
      applicationId: release.applicationId,
      size: release.size,
      versionCode: release.versionCode,
      versionName: release.versionName,
    })}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
