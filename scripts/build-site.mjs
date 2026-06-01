#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { publishRegistryReadmes } from "./lib/readmes.mjs";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);
const registrySource = new URL("../generated/v1/", import.meta.url);
const registryTarget = new URL("../dist/v1/", import.meta.url);

await run("pnpm", ["exec", "astro", "build"], root.pathname);
await fs.rm(registryTarget, { recursive: true, force: true });
await fs.mkdir(path.dirname(registryTarget.pathname), { recursive: true });
await fs.cp(registrySource, registryTarget, { recursive: true });
const readmes = await publishRegistryReadmes({
  registryDir: registrySource,
  outputDir: registryTarget,
});

const required = [
  "index.html",
  "plugins/index.html",
  "v1/index.json",
  "v1/index.sig",
  "v1/revoked.json",
  "v1/trust/root.json",
];

for (const relativePath of required) {
  await fs.access(new URL(relativePath, dist));
}

console.log(
  `Built site, copied registry metadata, and published ${readmes.published.length} README artifact set${readmes.published.length === 1 ? "" : "s"} to dist/v1.`,
);
for (const skipped of readmes.skipped) {
  console.warn(
    `Skipped README for ${skipped.pluginId}: ${skipped.reason}${skipped.message ? ` (${skipped.message})` : ""}`,
  );
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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
