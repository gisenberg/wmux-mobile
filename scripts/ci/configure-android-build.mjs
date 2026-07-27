import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const maximumAndroidVersionCode = 2_100_000_000;

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}.`);
  }
  return value.trim();
}

export function normalizeAndroidVersionCode(value) {
  const normalized = requiredString(String(value ?? ""), "Android version code");
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid Android version code: ${normalized}`);
  }
  const parsed = Number.parseInt(normalized, 10);
  if (parsed < 1 || parsed > maximumAndroidVersionCode) {
    throw new Error(`Android version code must be between 1 and ${maximumAndroidVersionCode}.`);
  }
  return parsed;
}

function replaceExactlyOnce(source, pattern, replacement, description) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error(`Expected exactly one ${description}, found ${matches?.length ?? 0}.`);
  }
  return source.replace(pattern, replacement);
}

export function configureAndroidBuild(buildGradle, { versionCode, versionName }) {
  const normalizedVersionCode = normalizeAndroidVersionCode(versionCode);
  const normalizedVersionName = requiredString(versionName, "Android version name");
  if (/[\r\n"]/.test(normalizedVersionName)) {
    throw new Error(`Invalid Android version name: ${normalizedVersionName}`);
  }

  let configured = replaceExactlyOnce(
    buildGradle,
    /^\s*versionCode \d+$/gm,
    `        versionCode ${normalizedVersionCode}`,
    "versionCode declaration",
  );
  configured = replaceExactlyOnce(
    configured,
    /^\s*versionName "[^"]*"$/gm,
    `        versionName "${normalizedVersionName}"`,
    "versionName declaration",
  );

  const debugSigningConfig = [
    "        debug {",
    "            storeFile file('debug.keystore')",
    "            storePassword 'android'",
    "            keyAlias 'androiddebugkey'",
    "            keyPassword 'android'",
    "        }",
  ].join("\n");
  const releaseSigningConfig = [
    "        release {",
    '            def releaseStorePath = System.getenv("ANDROID_KEYSTORE_PATH")',
    '            def releaseStorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")',
    '            def releaseKeyAlias = System.getenv("ANDROID_KEY_ALIAS")',
    '            def releaseKeyPassword = System.getenv("ANDROID_KEY_PASSWORD")',
    "            if (!releaseStorePath || !releaseStorePassword || !releaseKeyAlias || !releaseKeyPassword) {",
    '                throw new GradleException("Missing Android release signing configuration.")',
    "            }",
    "            storeFile file(releaseStorePath)",
    '            storeType "PKCS12"',
    "            storePassword releaseStorePassword",
    "            keyAlias releaseKeyAlias",
    "            keyPassword releaseKeyPassword",
    "        }",
  ].join("\n");
  configured = replaceExactlyOnce(
    configured,
    new RegExp(debugSigningConfig.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
    `${debugSigningConfig}\n${releaseSigningConfig}`,
    "debug signing configuration",
  );

  const releaseBuildType = /(buildTypes \{[\s\S]*?\n        release \{[\s\S]*?)signingConfig signingConfigs\.debug/g;
  configured = replaceExactlyOnce(
    configured,
    releaseBuildType,
    "$1signingConfig signingConfigs.release",
    "release build signing configuration",
  );
  return configured;
}

async function main() {
  const buildGradlePath = process.argv[2];
  if (!buildGradlePath) {
    throw new Error("Usage: node scripts/ci/configure-android-build.mjs <android/app/build.gradle>");
  }

  const appConfig = JSON.parse(await readFile(new URL("../../app.json", import.meta.url), "utf8"));
  const versionName = requiredString(appConfig.expo?.version, "Expo application version");
  const versionCode = normalizeAndroidVersionCode(process.env.ANDROID_VERSION_CODE);
  const buildGradle = await readFile(buildGradlePath, "utf8");
  await writeFile(
    buildGradlePath,
    configureAndroidBuild(buildGradle, {
      versionCode,
      versionName,
    }),
    "utf8",
  );
  process.stdout.write(`Configured Android release version ${versionName} (${versionCode}) with CI signing.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
