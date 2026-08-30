#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = parsePort(process.argv.slice(2));
const sourceRoot = path.join(root, "tmp", "browser-source");
const packageRoot = path.join(sourceRoot, "packages", "ai");
const galleryRoot = path.join(packageRoot, "registry-assets", "gallery");

await rm(sourceRoot, { recursive: true, force: true });
await mkdir(path.join(packageRoot, "registry-content"), { recursive: true });
await mkdir(galleryRoot, { recursive: true });

await Promise.all([
  writeJson(path.join(packageRoot, "package.json"), {
    name: "@lapis-notes/ai",
    version: "0.1.3",
    license: "AGPL-3.0-or-later",
    homepage:
      "https://github.com/lapismd/lapis-plugins/tree/main/packages/ai#readme",
    repository: "https://github.com/lapismd/lapis-plugins.git",
    bugs: { url: "https://github.com/lapismd/lapis-plugins/issues" },
  }),
  writeJson(path.join(packageRoot, "manifest.json"), {
    id: "ai",
    name: "AI",
    version: "0.1.3",
    minAppVersion: "0.1.0",
    description: "Provider-neutral agent chat inside the Lapis workspace.",
    author: "Lapis Notes",
    isDesktopOnly: false,
  }),
  writeJson(path.join(packageRoot, "registry.json"), registrySource()),
  writeFile(
    path.join(packageRoot, "registry-content", "overview.md"),
    "# AI\n\nWork with agents inside the Lapis workspace.\n",
  ),
  writeFile(path.join(packageRoot, "CHANGELOG.md"), "# Changelog\n"),
  ...galleryCards().flatMap((card, index) => [
    writeFixtureImage(
      path.join(galleryRoot, `${card.id}.preview.webp`),
      1200,
      800,
      index,
    ),
    writeFixtureImage(
      path.join(galleryRoot, `${card.id}.full.webp`),
      2400,
      1600,
      index,
    ),
  ]),
]);

const child = spawn(
  process.execPath,
  [
    path.join(root, "scripts", "dev-site.mjs"),
    "--source",
    sourceRoot,
    "--port",
    String(port),
    "--host",
    "127.0.0.1",
  ],
  { cwd: root, env: process.env, stdio: "inherit" },
);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopping = true;
    child.kill(signal);
  });
}

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? (stopping ? 0 : 1)));
});
await rm(sourceRoot, { recursive: true, force: true });
process.exitCode = exitCode;

function registrySource() {
  return {
    schemaVersion: 1,
    categories: ["ai", "productivity"],
    highlights: ["Keep agent work in the active workspace."],
    appearance: { icon: "sparkles", accent: "#A855F7" },
    gallery: galleryCards().map((card, index) => ({
      id: card.id,
      alt: card.alt,
      images: {
        preview: {
          path: `registry-assets/gallery/${card.id}.preview.webp`,
        },
        full: { path: `registry-assets/gallery/${card.id}.full.webp` },
      },
      capture: {
        storyId: `plugins-ai-registry-screenshots--fixture-${index + 1}`,
        focus: "full-shell",
      },
      card: {
        headline: [{ text: card.headline, tone: card.tone }],
        description: [
          { text: "Deterministic browser", tone: "cyan" },
          { text: "acceptance media.", tone: "neutral" },
        ],
      },
    })),
    content: {
      overview: "registry-content/overview.md",
      changelog: "CHANGELOG.md",
    },
  };
}

function galleryCards() {
  return [
    {
      id: "conversation",
      alt: "AI conversation in the Lapis workspace.",
      headline: "Conversation",
      tone: "violet",
    },
    {
      id: "history",
      alt: "AI conversation history in the right sidebar.",
      headline: "History",
      tone: "cyan",
    },
    {
      id: "catalog",
      alt: "AI capability catalog in the right sidebar.",
      headline: "Catalog",
      tone: "green",
    },
  ];
}

function fixtureImage(width, height, index) {
  const backgrounds = ["#241B35", "#172C32", "#183022"];
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: backgrounds[index],
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.12)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.76)}" rx="${Math.round(width * 0.03)}" fill="#171717" stroke="#ffffff" stroke-opacity="0.18" stroke-width="${Math.max(2, Math.round(width / 600))}"/></svg>`,
        ),
      },
    ])
    .webp({ lossless: true, effort: 4 })
    .toBuffer();
}

async function writeFixtureImage(filePath, width, height, index) {
  await writeFile(filePath, await fixtureImage(width, height, index));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parsePort(args) {
  const index = args.indexOf("--port");
  const value = index >= 0 ? Number(args[index + 1]) : 4372;
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`Invalid browser test port: ${String(args[index + 1])}.`);
  }
  return value;
}
