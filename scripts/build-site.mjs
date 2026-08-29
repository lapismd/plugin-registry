#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { publishDownloadStats } from "./lib/download-stats.mjs";
import { publishRegistryReadmes } from "./lib/readmes.mjs";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);
const siteBuild = new URL("../tmp/site-build/", import.meta.url);
const registrySource = new URL("../generated/v1/", import.meta.url);
const siteRegistry = new URL("v1/", siteBuild);
const registryTarget = new URL("v1/", dist);
const statsSource = new URL("../stats/", import.meta.url);
const statsTarget = new URL("stats/", dist);

await fs.rm(siteBuild, { recursive: true, force: true });
await fs.mkdir(siteRegistry, { recursive: true });
await fs.cp(registrySource, siteRegistry, { recursive: true });
const readmes = await publishRegistryReadmes({
  registryDir: registrySource,
  outputDir: siteRegistry,
});

await run("pnpm", ["exec", "astro", "build"], root.pathname, {
  LAPIS_REGISTRY_SITE_V1_DIR: siteRegistry.pathname,
});
await fs.rm(registryTarget, { recursive: true, force: true });
await fs.mkdir(path.dirname(registryTarget.pathname), { recursive: true });
await fs.cp(siteRegistry, registryTarget, { recursive: true });
const publishedStats = await publishDownloadStats({
  sourceDirectory: statsSource,
  targetDirectory: statsTarget,
});

const required = [
  "index.html",
  "plugins/index.html",
  "v1/index.json",
  "v1/index.sig",
  "v1/revoked.json",
  "v1/trust/root.json",
  "_routes.json",
  "_headers",
];

for (const relativePath of required) {
  await fs.access(new URL(relativePath, dist));
}
if (publishedStats) {
  await fs.access(new URL("stats/summary.json", dist));
}

console.log(
  `Built site, copied registry metadata, and published ${readmes.published.length} README artifact set${readmes.published.length === 1 ? "" : "s"} to dist/v1.`,
);
for (const skipped of readmes.skipped) {
  console.warn(
    `Skipped README for ${skipped.pluginId}: ${skipped.reason}${skipped.message ? ` (${skipped.message})` : ""}`,
  );
}

function run(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}
