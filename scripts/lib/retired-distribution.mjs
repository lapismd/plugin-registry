// Match external distribution provenance. Bundled/native AI also uses id `ai`.
export function isRetiredDistribution(source) {
  return (
    source?.repository?.toLowerCase() === "lapismd/lapis-plugins" &&
    (source.packageName === "@lapis-notes/ai" ||
      source.pluginId === "ai" ||
      source.releaseTag?.split("@")[0] === "ai")
  );
}

export function assertDistributionIsActive(source) {
  if (isRetiredDistribution(source))
    throw new Error(
      "Shared @lapis-notes/ai distribution is retired; updates are forbidden.",
    );
}
