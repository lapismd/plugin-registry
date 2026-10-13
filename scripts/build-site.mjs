#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { publishDownloadStats } from "./lib/download-stats.mjs";
import { generatedDir, archiveDir } from "./lib/registry.mjs";

const root = new URL("../", import.meta.url);
const dist = new URL(
  process.env.LAPIS_REGISTRY_DIST_DIR ?? "../dist/",
  import.meta.url,
);
const siteBuild = new URL("../tmp/site-build/", dist);
const registrySource = generatedDir;
const siteRegistry = new URL("v2/", siteBuild);
const registryTarget = new URL("v2/", dist);
const statsSource = new URL("../stats/", import.meta.url);
const statsTarget = new URL("stats/", dist);

await fs.rm(siteBuild, { recursive: true, force: true });
await fs.mkdir(siteRegistry, { recursive: true });
await fs.cp(registrySource, siteRegistry, { recursive: true });

await run(
  process.execPath,
  [new URL("node_modules/astro/bin/astro.mjs", root).pathname, "build"],
  root.pathname,
  {
    LAPIS_REGISTRY_SITE_DIR: siteRegistry.pathname,
    LAPIS_REGISTRY_DATA_DIR: registrySource.pathname,
    LAPIS_REGISTRY_DIST_DIR: dist.pathname,
  },
);
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
  "v2/index.json",
  "v2/index.sig",
  "v2/revoked.json",
  "v2/revoked.sig",
  "v2/trust/root.json",
  "_routes.json",
  "_headers",
];

for (const relativePath of required) {
  await fs.access(new URL(relativePath, dist));
}
if (publishedStats) {
  await fs.access(new URL("stats/summary.json", dist));
}

await fs.cp(archiveDir, new URL("v1/", dist), { recursive: true });
console.log("Built Astro and V2 registry; retained signed V1 archive.");

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
