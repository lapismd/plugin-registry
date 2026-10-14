/** Open a release in the receiving App's configured, verified registry. */
export function pluginAppHref(pluginId, version, scheme = "lapis") {
  if (!["lapis", "web+lapis"].includes(scheme))
    throw new Error("Unsupported Lapis app-link scheme.");
  const url = new URL(`${scheme}://plugins`);
  url.searchParams.set("id", pluginId);
  url.searchParams.set("version", version);
  return url.href;
}
