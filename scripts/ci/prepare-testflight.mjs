import { Buffer } from "node:buffer";
import { createPrivateKey, sign } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const expectedBundleIdentifier = "com.gisenberg.wmuxmobile";
const appStoreConnectBaseUrl = "https://api.appstoreconnect.apple.com";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function normalizePrivateKey(value) {
  const trimmed = value.trim();
  if (trimmed.includes("BEGIN PRIVATE KEY")) {
    return trimmed.includes("\\n") && !trimmed.includes("\n") ? trimmed.replaceAll("\\n", "\n") : trimmed;
  }

  const decoded = Buffer.from(trimmed, "base64").toString("utf8").trim();
  if (!decoded.includes("BEGIN PRIVATE KEY")) {
    throw new Error("ASC_API_PRIVATE_KEY is neither a PEM private key nor a base64-encoded PEM private key.");
  }
  return decoded;
}

async function loadPrivateKey() {
  const inlineKey = process.env.ASC_API_PRIVATE_KEY;
  if (inlineKey?.trim()) return normalizePrivateKey(inlineKey);

  const privateKeyFile = process.env.ASC_API_PRIVATE_KEY_FILE?.trim();
  if (!privateKeyFile) {
    throw new Error("Provide ASC_API_PRIVATE_KEY or ASC_API_PRIVATE_KEY_FILE.");
  }
  return normalizePrivateKey(await readFile(privateKeyFile, "utf8"));
}

function createAppStoreConnectToken({ issuerId, keyId, privateKey }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const encodedHeader = base64Url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const encodedPayload = base64Url(
    JSON.stringify({
      aud: "appstoreconnect-v1",
      exp: issuedAt + 15 * 60,
      iat: issuedAt - 30,
      iss: issuerId,
    }),
  );
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = sign("sha256", Buffer.from(unsignedToken), {
    dsaEncoding: "ieee-p1363",
    key: privateKey,
  });
  return `${unsignedToken}.${signature.toString("base64url")}`;
}

async function appStoreConnectRequest(path, token) {
  const response = await fetch(new URL(path, appStoreConnectBaseUrl), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`App Store Connect ${response.status}: ${detail.slice(0, 600)}`);
  }
  return response.json();
}

function incrementBuildNumber(version) {
  if (!version) return "1";
  const components = version.split(".");
  if (!components.length || components.length > 3 || components.some((component) => !/^\d+$/.test(component))) {
    throw new Error(`Cannot increment existing App Store build number: ${version}`);
  }
  const lastIndex = components.length - 1;
  components[lastIndex] = String(Number.parseInt(components[lastIndex], 10) + 1);
  return components.join(".");
}

async function writeGitHubVariable(file, name, value) {
  if (!file) return;
  await appendFile(file, `${name}=${value}\n`, "utf8");
}

const appId = requiredEnvironment("ASC_APP_ID");
const issuerId = requiredEnvironment("ASC_API_KEY_ISSUER_ID");
const keyId = requiredEnvironment("ASC_API_KEY_ID");
const teamId = requiredEnvironment("APPLE_TEAM_ID");
const privateKey = await loadPrivateKey();
createPrivateKey(privateKey);

const token = createAppStoreConnectToken({ issuerId, keyId, privateKey });
const appResponse = await appStoreConnectRequest(
  `/v1/apps/${encodeURIComponent(appId)}?fields[apps]=bundleId,name,sku`,
  token,
);
const app = appResponse.data;
if (!app || app.type !== "apps") throw new Error(`App Store Connect did not return app ${appId}.`);
if (app.attributes?.bundleId !== expectedBundleIdentifier) {
  throw new Error(
    `App Store Connect app ${appId} uses ${app.attributes?.bundleId ?? "an unknown bundle ID"}, expected ${expectedBundleIdentifier}.`,
  );
}

const buildsUrl = new URL("/v1/builds", appStoreConnectBaseUrl);
buildsUrl.searchParams.set("filter[app]", appId);
buildsUrl.searchParams.set("fields[builds]", "version");
buildsUrl.searchParams.set("limit", "1");
buildsUrl.searchParams.set("sort", "-uploadedDate");
const buildsResponse = await appStoreConnectRequest(`${buildsUrl.pathname}${buildsUrl.search}`, token);
const latestBuildNumber = buildsResponse.data?.[0]?.attributes?.version;
const nextBuildNumber = incrementBuildNumber(latestBuildNumber);

const appConfig = JSON.parse(await readFile(new URL("../../app.json", import.meta.url), "utf8"));
const marketingVersion = appConfig.expo?.version;
if (typeof marketingVersion !== "string" || !/^\d+(?:\.\d+){1,2}$/.test(marketingVersion)) {
  throw new Error(`Invalid Expo application version: ${String(marketingVersion)}`);
}

const keyDirectory = process.env.RUNNER_TEMP?.trim() || tmpdir();
await mkdir(keyDirectory, { recursive: true });
const keyPath = join(keyDirectory, `AuthKey_${keyId}.p8`);
await writeFile(keyPath, `${privateKey}\n`, { mode: 0o600 });

await writeGitHubVariable(process.env.GITHUB_ENV, "ASC_API_KEY_PATH", keyPath);
await writeGitHubVariable(process.env.GITHUB_ENV, "IOS_BUILD_NUMBER", nextBuildNumber);
await writeGitHubVariable(process.env.GITHUB_ENV, "IOS_MARKETING_VERSION", marketingVersion);
await writeGitHubVariable(process.env.GITHUB_OUTPUT, "build_number", nextBuildNumber);
await writeGitHubVariable(process.env.GITHUB_OUTPUT, "marketing_version", marketingVersion);

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## TestFlight release",
      "",
      `- App: ${app.attributes?.name ?? basename(expectedBundleIdentifier)}`,
      `- Bundle identifier: \`${expectedBundleIdentifier}\``,
      `- Marketing version: \`${marketingVersion}\``,
      `- Build number: \`${nextBuildNumber}\``,
      `- Apple team: \`${teamId}\``,
      "",
    ].join("\n"),
    "utf8",
  );
} else {
  process.stdout.write(
    `${JSON.stringify({
      appId,
      appName: app.attributes?.name,
      bundleIdentifier: app.attributes?.bundleId,
      latestBuildNumber: latestBuildNumber ?? null,
      nextBuildNumber,
      teamId,
    })}\n`,
  );
}
