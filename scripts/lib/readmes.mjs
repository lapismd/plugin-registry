import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const maxReadmeBytes = 256 * 1024;
const maxReadmeImageBytes = 5 * 1024 * 1024;
const defaultPublicRegistryBaseUrl = "https://registry.lapis.md/v1/";

export async function publishRegistryReadmes({
  registryDir,
  outputDir,
  fetchImpl = fetch,
  publicRegistryBaseUrl = defaultPublicRegistryBaseUrl,
}) {
  const index = await readJson(new URL("index.json", registryDir));
  const published = [];
  const skipped = [];
  const publicBase = new URL(publicRegistryBaseUrl);

  for (const plugin of index.plugins ?? []) {
    const detail = plugin.detail
      ? await readJson(new URL(plugin.detail, registryDir))
      : {};
    const readmeUrl = detail.readmeUrl ?? plugin.readmeUrl;
    if (!readmeUrl) {
      skipped.push({ pluginId: plugin.id, reason: "missing-readme-url" });
      continue;
    }
    const source = parseReadmeSource(readmeUrl);
    if (!source) {
      skipped.push({ pluginId: plugin.id, reason: "invalid-readme-url" });
      continue;
    }

    try {
      const sourceMarkdown = await fetchReadmeMarkdown(source.href, fetchImpl);
      const targetDir = new URL(`readmes/${plugin.id}/`, outputDir);
      await fs.mkdir(targetDir, { recursive: true });
      const { markdown, images } = await localizeReadmeImages({
        markdown: sourceMarkdown,
        sourceUrl: source,
        targetDir,
        publicReadmeBaseUrl: new URL(`readmes/${plugin.id}/`, publicBase),
        fetchImpl,
      });
      const manifest = {
        schemaVersion: 1,
        pluginId: plugin.id,
        sourceUrl: source.href,
        markdown: {
          path: "README.md",
          sha256: sha256Text(markdown),
          size: new TextEncoder().encode(markdown).byteLength,
        },
        html: {
          path: "README.html",
          sha256: sha256Text(`${renderMarkdownToSafeHtml(markdown)}\n`),
          size: new TextEncoder().encode(
            `${renderMarkdownToSafeHtml(markdown)}\n`,
          ).byteLength,
        },
        images,
      };
      await fs.writeFile(new URL("README.md", targetDir), markdown);
      await fs.writeFile(
        new URL("README.html", targetDir),
        `${renderMarkdownToSafeHtml(markdown)}\n`,
      );
      await fs.writeFile(
        new URL("manifest.json", targetDir),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      published.push({
        pluginId: plugin.id,
        sourceUrl: source.href,
        markdownPath: `readmes/${plugin.id}/README.md`,
        htmlPath: `readmes/${plugin.id}/README.html`,
        manifestPath: `readmes/${plugin.id}/manifest.json`,
      });
    } catch (error) {
      skipped.push({
        pluginId: plugin.id,
        reason: "fetch-failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { published, skipped };
}

export async function localizeReadmeImages({
  markdown,
  sourceUrl,
  targetDir,
  publicReadmeBaseUrl,
  fetchImpl = fetch,
}) {
  const images = [];
  const replacements = new Map();
  const matches = [...markdown.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)];
  for (const match of matches) {
    const original = match[2];
    if (replacements.has(original)) continue;
    const imageUrl = parseReadmeImageSource(original, sourceUrl);
    if (!imageUrl) continue;
    try {
      const image = await fetchReadmeImage(imageUrl.href, fetchImpl);
      const extension = imageExtension(image.contentType, imageUrl.pathname);
      const relativePath = `assets/${image.sha256.slice(0, 16)}${extension}`;
      await fs.mkdir(new URL("assets/", targetDir), { recursive: true });
      await fs.writeFile(new URL(relativePath, targetDir), image.bytes);
      replacements.set(
        original,
        publicReadmeBaseUrl
          ? new URL(relativePath, publicReadmeBaseUrl).href
          : relativePath,
      );
      images.push({
        sourceUrl: imageUrl.href,
        path: relativePath,
        sha256: image.sha256,
        size: image.bytes.byteLength,
        contentType: image.contentType,
      });
    } catch {
      // Keep the original image reference if mirroring fails. README rendering
      // should degrade as documentation, not block publishing registry metadata.
    }
  }
  return {
    markdown: markdown.replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (full, alt, src) => {
        const replacement = replacements.get(src);
        return replacement ? `![${alt}](${replacement})` : full;
      },
    ),
    images,
  };
}

export async function fetchReadmeImage(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { Accept: "image/*" },
  });
  if (!response.ok) {
    throw new Error(`README image request failed with HTTP ${response.status}`);
  }
  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error(`README image response is not an image: ${contentType}`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > maxReadmeImageBytes) {
    throw new Error("README image response is too large");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxReadmeImageBytes) {
    throw new Error("README image response is too large");
  }
  return {
    bytes,
    contentType,
    sha256: sha256Bytes(bytes),
  };
}

export async function fetchReadmeMarkdown(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { Accept: "text/markdown,text/plain,text/*;q=0.9" },
  });
  if (!response.ok) {
    throw new Error(`README request failed with HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!isTextContentType(contentType)) {
    throw new Error(`README response is not text: ${contentType || "unknown"}`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > maxReadmeBytes) {
    throw new Error("README response is too large");
  }
  const markdown = await response.text();
  if (new TextEncoder().encode(markdown).byteLength > maxReadmeBytes) {
    throw new Error("README response is too large");
  }
  return markdown;
}

export function parseReadmeSource(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (isPrivateOrLocalHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function parseReadmeImageSource(value, sourceUrl) {
  try {
    const url = new URL(value, sourceUrl);
    if (url.protocol !== "https:") return null;
    if (isPrivateOrLocalHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function readmeArtifactPaths(pluginId) {
  return {
    markdown: `readmes/${pluginId}/README.md`,
    html: `readmes/${pluginId}/README.html`,
  };
}

export function renderMarkdownToSafeHtml(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim().split(/\s+/)[0] ?? "";
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        `<pre><code${language ? ` class="language-${escapeAttribute(language)}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ""));
        index += 1;
      }
      blocks.push(
        `<ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`,
      );
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        `<ol>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ol>`,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const quote = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        `<blockquote>${renderMarkdownToSafeHtml(quote.join("\n"))}</blockquote>`,
      );
      continue;
    }
    if (isMarkdownTableStart(lines, index)) {
      const header = splitTableRow(lines[index]);
      index += 2;
      const rows = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(renderTable(header, rows));
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !startsBlock(lines, index)
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
  }
  return sanitizeHtml(blocks.join("\n"));
}

export function isPrivateOrLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const parts = host.split(".").map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  );
}

async function readJson(url) {
  return JSON.parse(await fs.readFile(url, "utf8"));
}

function isTextContentType(contentType) {
  const type = contentType.split(";")[0].trim().toLowerCase();
  return type.startsWith("text/") || type === "application/markdown";
}

function startsBlock(lines, index) {
  const line = lines[index];
  return (
    line.startsWith("```") ||
    /^(#{1,6})\s+/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    line.startsWith(">") ||
    isMarkdownTableStart(lines, index)
  );
}

function isMarkdownTableStart(lines, index) {
  return (
    index + 1 < lines.length &&
    /^\s*\|.*\|\s*$/.test(lines[index]) &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
  );
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(header, rows) {
  const head = header
    .map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`)
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderInlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt, src) => {
    const parsed = parseRenderedImageSource(src);
    return parsed
      ? `<img src="${escapeAttribute(parsed)}" alt="${escapeAttribute(alt)}">`
      : "";
  });
  html = html.replace(
    /\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g,
    (_match, label, href) => {
      const parsed = parseReadmeSource(href);
      return parsed
        ? `<a href="${escapeAttribute(parsed.href)}" rel="nofollow noopener noreferrer">${label}</a>`
        : label;
    },
  );
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

function sanitizeHtml(html) {
  return html
    .replace(
      /<\s*(script|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
      "",
    )
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s+(href|src|xlink:href|formaction|poster)\s*=\s*(["']?)\s*(?:javascript:|vbscript:|data:text\/html)[\s\S]*?\2/gi,
      "",
    );
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(String(value)).replace(/'/g, "&#39;");
}

function parseRenderedImageSource(value) {
  if (/^assets\/[A-Za-z0-9._/-]+$/.test(value)) return value;
  const parsed = parseReadmeSource(value);
  return parsed?.href ?? null;
}

function imageExtension(contentType, pathname) {
  const byContentType = {
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
  }[contentType];
  if (byContentType) return byContentType;
  const ext = path.extname(pathname).toLowerCase();
  return /^[.][a-z0-9]{1,8}$/.test(ext) ? ext : ".img";
}

function sha256Text(value) {
  return sha256Bytes(new TextEncoder().encode(value));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}
