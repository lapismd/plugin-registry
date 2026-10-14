import { downloadTargets } from "../../../generated/download-targets.mjs";

export const DOWNLOAD_ACTIONS = new Set(["install", "update", "download"]);
export const DOWNLOAD_PLATFORMS = new Set(["web", "desktop"]);
export const DOWNLOAD_OSES = new Set([
  "macos",
  "windows",
  "linux",
  "ios",
  "android",
]);

const allowedMethods = "GET, HEAD, OPTIONS";

export async function onRequest(context) {
  return handleDownloadRequest(context);
}

/**
 * @param {{ targets: Record<string, { pluginId: string, version: string, originUrl: string, status: string }> }} targets
 */
export async function handleDownloadRequest(
  context,
  targets = downloadTargets,
  fetchImpl = fetch,
) {
  const method = context.request.method.toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders() });
  }
  if (method !== "GET" && method !== "HEAD") {
    return textResponse(context.request, "Method not allowed", 405, {
      Allow: allowedMethods,
    });
  }

  const pluginId = singleParam(context.params?.plugin);
  const version = singleParam(context.params?.version);
  const target = targets.targets?.[`${pluginId}@${version}`];
  if (!target || target.status === "pending") {
    return textResponse(context.request, "Plugin release not found", 404);
  }
  if (target.status === "revoked") {
    return textResponse(context.request, "Plugin release revoked", 410);
  }
  if (target.status !== "active") {
    return textResponse(context.request, "Plugin release not found", 404);
  }

  if (method === "GET") {
    recordDownload(context, target);
  }
  try {
    // Fetch only the generated release target. Browser headers, cookies and
    // caller-supplied URLs never enter the upstream request.
    const upstream = await fetchImpl(target.originUrl, {
      method,
      redirect: "follow",
      signal: context.request.signal,
    });
    if (upstream.status !== 200) {
      await upstream.body?.cancel();
      return textResponse(context.request, "Plugin archive unavailable", 502);
    }
    return new Response(method === "HEAD" ? null : upstream.body, {
      status: 200,
      headers: responseHeaders({
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${target.pluginId}-${target.version}.lapis-plugin"`,
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "cross-origin",
      }),
    });
  } catch {
    return textResponse(context.request, "Plugin archive unavailable", 502);
  }
}

function recordDownload(context, target) {
  const requestUrl = new URL(context.request.url);
  const action = normalize(
    requestUrl.searchParams.get("action"),
    DOWNLOAD_ACTIONS,
  );
  const platform = normalize(
    requestUrl.searchParams.get("platform"),
    DOWNLOAD_PLATFORMS,
  );
  const os = normalize(requestUrl.searchParams.get("os"), DOWNLOAD_OSES);
  try {
    context.env?.PLUGIN_DOWNLOADS?.writeDataPoint({
      indexes: [`${target.pluginId}@${target.version}`],
      blobs: [target.pluginId, target.version, action, platform, os],
    });
  } catch {
    // Analytics is best-effort. It cannot prevent archive delivery.
  }
}

function normalize(value, allowed) {
  return value && allowed.has(value) ? value : "unknown";
}

function singleParam(value) {
  return Array.isArray(value) ? value[0] : String(value ?? "");
}

function textResponse(request, message, status, extraHeaders = {}) {
  return new Response(request.method === "HEAD" ? null : message, {
    status,
    headers: responseHeaders({
      "Content-Type": "text/plain; charset=utf-8",
      ...extraHeaders,
    }),
  });
}

function responseHeaders(extraHeaders = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": allowedMethods,
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    ...extraHeaders,
  };
}
