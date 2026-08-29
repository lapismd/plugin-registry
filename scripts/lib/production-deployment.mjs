export async function readProductionCommit({
  accountId,
  apiToken,
  projectName = "lapis-plugin-registry",
  fetchImpl = fetch,
}) {
  if (!accountId || !apiToken) {
    throw new Error("Cloudflare account ID and Pages API token are required");
  }
  const endpoint = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/deployments`,
  );
  endpoint.searchParams.set("env", "production");
  endpoint.searchParams.set("page", "1");
  endpoint.searchParams.set("per_page", "1");
  const response = await fetchImpl(endpoint, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  if (!response.ok) {
    throw new Error(`Cloudflare Pages API returned HTTP ${response.status}`);
  }
  const value = await response.json();
  const deployment = value?.success === true ? value.result?.[0] : undefined;
  const commit = deployment?.deployment_trigger?.metadata?.commit_hash;
  if (typeof commit !== "string" || !/^[0-9a-f]{7,64}$/i.test(commit)) {
    throw new Error("Cloudflare Pages API did not return a production commit");
  }
  return commit;
}

export function isStatsOnlyDeployment(files) {
  return (
    Array.isArray(files) &&
    files.length > 0 &&
    files.every(
      (filename) =>
        typeof filename === "string" &&
        filename.startsWith("stats/") &&
        !filename.includes(".."),
    )
  );
}
