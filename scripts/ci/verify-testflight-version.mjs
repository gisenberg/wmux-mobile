import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const expectedBundleIdentifier = "com.gisenberg.wmuxmobile";

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}.`);
  }
  return value.trim();
}

export function verifyTestFlightVersion(
  applicationInfo,
  { buildNumber, bundleIdentifier = expectedBundleIdentifier, marketingVersion },
) {
  const expectedBuildNumber = requiredString(buildNumber, "expected build number");
  const expectedMarketingVersion = requiredString(marketingVersion, "expected marketing version");
  const expectedBundleId = requiredString(bundleIdentifier, "expected bundle identifier");
  const actualBuildNumber = requiredString(applicationInfo?.CFBundleVersion, "archived CFBundleVersion");
  const actualMarketingVersion = requiredString(
    applicationInfo?.CFBundleShortVersionString,
    "archived CFBundleShortVersionString",
  );
  const actualBundleId = requiredString(applicationInfo?.CFBundleIdentifier, "archived CFBundleIdentifier");

  if (actualBundleId !== expectedBundleId) {
    throw new Error(`Archived bundle identifier is ${actualBundleId}, expected ${expectedBundleId}.`);
  }
  if (actualMarketingVersion !== expectedMarketingVersion) {
    throw new Error(`Archived marketing version is ${actualMarketingVersion}, expected ${expectedMarketingVersion}.`);
  }
  if (actualBuildNumber !== expectedBuildNumber) {
    throw new Error(`Archived build number is ${actualBuildNumber}, expected ${expectedBuildNumber}.`);
  }

  return {
    buildNumber: actualBuildNumber,
    bundleIdentifier: actualBundleId,
    marketingVersion: actualMarketingVersion,
  };
}

async function main() {
  const metadataPath = process.argv[2];
  if (!metadataPath) {
    throw new Error("Usage: node scripts/ci/verify-testflight-version.mjs <application-info.json>");
  }

  const applicationInfo = JSON.parse(await readFile(metadataPath, "utf8"));
  const verifiedVersion = verifyTestFlightVersion(applicationInfo, {
    buildNumber: process.env.IOS_BUILD_NUMBER,
    marketingVersion: process.env.IOS_MARKETING_VERSION,
  });
  process.stdout.write(`Verified archived TestFlight application: ${JSON.stringify(verifiedVersion)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
