export function buildNumberComponents(version) {
  const components = version.split(".");
  if (!components.length || components.length > 3 || components.some((component) => !/^\d+$/.test(component))) {
    throw new Error(`Invalid App Store build number: ${version}`);
  }
  return components.map((component) => Number.parseInt(component, 10));
}

export function incrementBuildNumber(version) {
  if (!version) return "1";
  const components = buildNumberComponents(version);
  components[components.length - 1] += 1;
  return components.join(".");
}

export function compareBuildNumbers(first, second) {
  const firstComponents = buildNumberComponents(first);
  const secondComponents = buildNumberComponents(second);
  const length = Math.max(firstComponents.length, secondComponents.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (firstComponents[index] ?? 0) - (secondComponents[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function selectBuildNumber(latestBuildNumber, githubRunNumber) {
  const incremented = incrementBuildNumber(latestBuildNumber);
  if (!githubRunNumber) return incremented;
  buildNumberComponents(githubRunNumber);
  if (!latestBuildNumber || compareBuildNumbers(githubRunNumber, latestBuildNumber) > 0) return githubRunNumber;
  return incremented;
}
