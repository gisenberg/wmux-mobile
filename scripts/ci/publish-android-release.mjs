import { appendFile, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

import { loadVerifiedAndroidApk } from "./verify-android-apk.mjs";

export const automatedAndroidTagPrefix = "android-ci-";
export const retainedAutomatedAndroidReleaseCount = 3;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function createAndroidReleasePlan({ refName, refType, runNumber, sha, versionCode, versionName }) {
  const deliberateTag = refType === "tag" && !refName.startsWith(automatedAndroidTagPrefix);
  const tagName = deliberateTag ? refName : `${automatedAndroidTagPrefix}${runNumber}`;
  return {
    assetName: `wmux-android-${versionName}-${versionCode}.apk`,
    deliberateTag,
    name: deliberateTag ? `wmux ${refName}` : `wmux Android ${versionName} (${versionCode})`,
    prerelease: !deliberateTag,
    sha,
    tagName,
    versionCode,
    versionName,
  };
}

export function selectAutomatedAndroidReleasesForDeletion(releases, keepCount = retainedAutomatedAndroidReleaseCount) {
  return releases
    .filter((release) => release.tag_name?.startsWith(automatedAndroidTagPrefix))
    .sort((first, second) => {
      const createdDifference = Date.parse(second.created_at ?? "") - Date.parse(first.created_at ?? "");
      if (createdDifference !== 0) return createdDifference;
      return Number(second.id ?? 0) - Number(first.id ?? 0);
    })
    .slice(keepCount);
}

function createGitHubClient({ apiUrl, repository, token }) {
  const baseUrl = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
  const repositoryPath = `/repos/${repository}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  async function request(path, { body, method = "GET", notFound = false } = {}) {
    const response = await fetch(new URL(path.replace(/^\//, ""), baseUrl), {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
      method,
    });
    if (notFound && response.status === 404) return undefined;
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub ${method} ${path} failed with ${response.status}: ${detail.slice(0, 800)}`);
    }
    return response.status === 204 ? undefined : response.json();
  }

  return {
    async createRelease(plan) {
      return request(`${repositoryPath}/releases`, {
        body: {
          body: plan.deliberateTag
            ? `Installable Android APK for \`${plan.tagName}\`.`
            : [
                "Automated installable Android build from `main`.",
                "",
                `- Commit: \`${plan.sha}\``,
                `- App version: \`${plan.versionName}\``,
                `- Android version code: \`${plan.versionCode}\``,
                "",
                "This is a CI distribution build, not a Play Store artifact.",
              ].join("\n"),
          draft: true,
          generate_release_notes: plan.deliberateTag,
          make_latest: plan.deliberateTag ? "true" : "false",
          name: plan.name,
          prerelease: plan.prerelease,
          tag_name: plan.tagName,
          target_commitish: plan.sha,
        },
        method: "POST",
      });
    },
    deleteAsset(assetId) {
      return request(`${repositoryPath}/releases/assets/${assetId}`, { method: "DELETE" });
    },
    async deleteRelease(release) {
      await request(`${repositoryPath}/releases/${release.id}`, { method: "DELETE" });
      await request(`${repositoryPath}/git/refs/tags/${encodeURIComponent(release.tag_name)}`, {
        method: "DELETE",
        notFound: true,
      });
    },
    findReleaseByTag(tagName) {
      return request(`${repositoryPath}/releases/tags/${encodeURIComponent(tagName)}`, {
        notFound: true,
      });
    },
    async listReleases() {
      const releases = [];
      for (let page = 1; ; page += 1) {
        const pageReleases = await request(`${repositoryPath}/releases?per_page=100&page=${page}`);
        releases.push(...pageReleases);
        if (pageReleases.length < 100) return releases;
      }
    },
    publishRelease(releaseId, plan) {
      return request(`${repositoryPath}/releases/${releaseId}`, {
        body: {
          draft: false,
          make_latest: plan.deliberateTag ? "true" : "false",
          prerelease: plan.prerelease,
        },
        method: "PATCH",
      });
    },
    async uploadAsset(release, assetName, apk) {
      const uploadUrl = release.upload_url.replace(/\{.*$/, "");
      const response = await fetch(`${uploadUrl}?name=${encodeURIComponent(assetName)}`, {
        body: apk,
        headers: {
          ...headers,
          "Content-Length": String(apk.length),
          "Content-Type": "application/vnd.android.package-archive",
        },
        method: "POST",
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`GitHub APK upload failed with ${response.status}: ${detail.slice(0, 800)}`);
      }
      return response.json();
    },
  };
}

async function main() {
  const metadataPath = process.argv[2];
  if (!metadataPath) {
    throw new Error("Usage: node scripts/ci/publish-android-release.mjs <output-metadata.json>");
  }

  const appConfig = JSON.parse(await readFile(new URL("../../app.json", import.meta.url), "utf8"));
  const versionName = appConfig.expo?.version;
  const versionCode = Number.parseInt(requiredEnvironment("ANDROID_VERSION_CODE"), 10);
  const releaseApk = await loadVerifiedAndroidApk(metadataPath, {
    versionCode,
    versionName,
  });
  const plan = createAndroidReleasePlan({
    refName: requiredEnvironment("GITHUB_REF_NAME"),
    refType: requiredEnvironment("GITHUB_REF_TYPE"),
    runNumber: requiredEnvironment("GITHUB_RUN_NUMBER"),
    sha: requiredEnvironment("GITHUB_SHA"),
    versionCode,
    versionName,
  });
  const github = createGitHubClient({
    apiUrl: process.env.GITHUB_API_URL?.trim() || "https://api.github.com",
    repository: requiredEnvironment("GITHUB_REPOSITORY"),
    token: requiredEnvironment("GITHUB_TOKEN"),
  });

  let release = await github.findReleaseByTag(plan.tagName);
  if (!release) {
    const existingReleases = await github.listReleases();
    release = existingReleases.find((candidate) => candidate.tag_name === plan.tagName);
  }
  let createdRelease = false;
  if (!release) {
    release = await github.createRelease(plan);
    createdRelease = true;
  }
  const existingAsset = release.assets?.find((asset) => asset.name === plan.assetName);
  if (existingAsset) {
    await github.deleteAsset(existingAsset.id);
  }
  const apk = await readFile(releaseApk.apkPath);
  await github.uploadAsset(release, plan.assetName, apk);
  if (createdRelease || !plan.deliberateTag) {
    release = await github.publishRelease(release.id, plan);
  }

  const releases = await github.listReleases();
  const releasesToDelete = selectAutomatedAndroidReleasesForDeletion(releases);
  for (const oldRelease of releasesToDelete) {
    await github.deleteRelease(oldRelease);
  }

  const releaseUrl = release.html_url;
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "## Android release",
        "",
        `- Release: [${plan.tagName}](${releaseUrl})`,
        `- APK: \`${plan.assetName}\``,
        `- Application ID: \`${releaseApk.applicationId}\``,
        `- Version: \`${plan.versionName} (${plan.versionCode})\``,
        `- Size: \`${releaseApk.size}\` bytes`,
        `- Rolling releases removed: \`${releasesToDelete.length}\``,
        "",
      ].join("\n"),
      "utf8",
    );
  }
  process.stdout.write(
    `Published ${basename(releaseApk.apkPath)} as ${plan.assetName} at ${releaseUrl}; removed ${releasesToDelete.length} old rolling release(s).\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
