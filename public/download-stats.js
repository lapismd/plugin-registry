const metric = "approximate_redirect_requests";
const maximumAgeDays = 5;
const oneDay = 86_400_000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isUsableDownloadSummary(value, now = new Date()) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    value.dataset !== "lapis_plugin_downloads_v1" ||
    value.metric !== metric ||
    !validDate(value.trackedSince) ||
    !validDate(value.through) ||
    value.trackedSince > value.through ||
    !validTimestamp(value.generatedAt) ||
    !validPeriod(value.periods?.lifetime) ||
    !validPeriod(value.periods?.["7d"]) ||
    !validPeriod(value.periods?.["30d"])
  ) {
    return false;
  }
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const through = Date.parse(`${value.through}T00:00:00.000Z`);
  const age = (today - through) / oneDay;
  return age >= 0 && age <= maximumAgeDays;
}

export function formatApproximateCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) return null;
  if (value < 1_000) return String(value);
  for (const [threshold, suffix] of [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ]) {
    if (value >= threshold) {
      const scaled = value / threshold;
      return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/, "")}${suffix}`;
    }
  }
  return String(value);
}

export function statsForPlugin(summary, pluginId) {
  if (typeof pluginId !== "string" || pluginId.length === 0) return null;
  const lifetime = summary.periods.lifetime.plugins[pluginId]?.total ?? 0;
  const recent = summary.periods["30d"].plugins[pluginId]?.total ?? 0;
  const lifetimeLabel = formatApproximateCount(lifetime);
  const recentLabel = formatApproximateCount(recent);
  if (lifetimeLabel === null || recentLabel === null) return null;
  return { lifetime, recent, lifetimeLabel, recentLabel };
}

export function hydrateDownloadStats(root, summary) {
  for (const element of root.querySelectorAll(
    "[data-download-count][data-plugin-id]",
  )) {
    const stats = statsForPlugin(summary, element.dataset.pluginId);
    if (!stats) continue;
    element.textContent = ` · ~${stats.recentLabel} downloads (30d)`;
    element.hidden = false;
  }

  for (const element of root.querySelectorAll(
    "[data-download-detail][data-plugin-id]",
  )) {
    const stats = statsForPlugin(summary, element.dataset.pluginId);
    if (!stats) continue;
    const lifetime = element.querySelector("[data-download-lifetime]");
    const recent = element.querySelector("[data-download-30d]");
    const note = element.querySelector("[data-download-tracked-since]");
    const values = element.querySelector("[data-download-stats-values]");
    const unavailable = element.querySelector(
      "[data-download-stats-unavailable]",
    );
    if (!lifetime || !recent || !note || !values || !unavailable) continue;
    lifetime.textContent = `~${stats.lifetimeLabel}`;
    recent.textContent = `~${stats.recentLabel}`;
    note.textContent = `Tracked downloads since ${summary.trackedSince}. Approximate redirect requests.`;
    values.hidden = false;
    unavailable.hidden = true;
  }
}

export async function loadDownloadStats({
  fetchImpl = fetch,
  root = document,
  now = new Date(),
} = {}) {
  try {
    const response = await fetchImpl("/stats/summary.json", {
      cache: "no-cache",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return false;
    const summary = await response.json();
    if (!isUsableDownloadSummary(summary, now)) return false;
    hydrateDownloadStats(root, summary);
    return true;
  } catch {
    return false;
  }
}

export function normalizedBrowserOs(navigatorValue = globalThis.navigator) {
  const source =
    `${navigatorValue?.userAgentData?.platform ?? ""} ${navigatorValue?.platform ?? ""} ${navigatorValue?.userAgent ?? ""}`.toLowerCase();
  if (/iphone|ipad|ipod/.test(source)) return "ios";
  if (source.includes("android")) return "android";
  if (/mac|darwin/.test(source)) return "macos";
  if (/win/.test(source)) return "windows";
  if (/linux|x11/.test(source)) return "linux";
  return "unknown";
}

export function hydrateDownloadLinks(
  root = document,
  navigatorValue = globalThis.navigator,
) {
  const os = normalizedBrowserOs(navigatorValue);
  for (const link of root.querySelectorAll("a[data-download-link]")) {
    try {
      const url = new URL(link.href, globalThis.location?.href);
      if (url.origin !== globalThis.location?.origin) continue;
      if (!url.pathname.startsWith("/download/")) continue;
      url.searchParams.set("action", "download");
      url.searchParams.set("platform", "web");
      url.searchParams.set("os", os);
      link.href = `${url.pathname}${url.search}`;
    } catch {
      // Direct origin links and malformed optional tracking URLs remain unchanged.
    }
  }
}

function validPeriod(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !Number.isSafeInteger(value.total) ||
    value.total < 0 ||
    !validDate(value.from) ||
    !validDate(value.through) ||
    !value.plugins ||
    typeof value.plugins !== "object" ||
    Array.isArray(value.plugins)
  ) {
    return false;
  }
  return (
    Object.values(value.plugins).every(
      (plugin) =>
        plugin &&
        typeof plugin === "object" &&
        Number.isSafeInteger(plugin.total) &&
        plugin.total >= 0 &&
        validCounts(plugin.versions),
    ) &&
    validCounts(value.versions) &&
    validCounts(value.actions) &&
    validCounts(value.platforms) &&
    validCounts(value.os)
  );
}

function validCounts(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    )
  );
}

function validDate(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    value.endsWith("Z") &&
    !Number.isNaN(Date.parse(value))
  );
}

if (typeof document !== "undefined") {
  hydrateDownloadLinks();
  void loadDownloadStats();
}
