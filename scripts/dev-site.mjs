#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLocalSourcePreview } from "./lib/local-source-preview.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArgs(process.argv.slice(2));
const sourceDir = path.resolve(root, options.sourceDir);
const previewRoot = path.join(root, "tmp", "source-preview");
const publicDir = path.join(previewRoot, "public");
const registryDir = path.join(publicDir, "v1");

await rm(previewRoot, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
await cp(path.join(root, "public"), publicDir, { recursive: true });
const preview = await buildLocalSourcePreview({
  sourceDir,
  outputDir: registryDir,
  registryBaseUrl: `http://${options.previewHost}:${options.port}/v1/`,
});

console.log(
  `Prepared unsigned local source preview for ${preview.updatedPluginIds.length} plugin(s) from ${sourceDir}.`,
);

const child = spawn("pnpm", ["exec", "astro", "dev", ...options.astroArgs], {
  cwd: root,
  env: {
    ...process.env,
    LAPIS_REGISTRY_DATA_V1_DIR: registryDir,
    LAPIS_REGISTRY_SITE_V1_DIR: registryDir,
    LAPIS_REGISTRY_PUBLIC_DIR: publicDir,
    LAPIS_REGISTRY_SOURCE_PREVIEW: sourceDir,
  },
  stdio: "inherit",
  shell: process.platform === "win32",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
await rm(previewRoot, { recursive: true, force: true });
process.exitCode = exitCode;

function parseArgs(args) {
  const options = {
    sourceDir: "../lapis-plugins",
    port: 4321,
    previewHost: "localhost",
    astroArgs: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--source") {
      options.sourceDir = requireValue(args, ++index, arg);
      continue;
    }
    if (arg === "--port") {
      const value = requireValue(args, ++index, arg);
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`Invalid Astro port: ${value}.`);
      }
      options.port = port;
      options.astroArgs.push(arg, value);
      continue;
    }
    if (arg === "--host") {
      const candidate = args[index + 1];
      if (candidate && !candidate.startsWith("--")) {
        index += 1;
        options.astroArgs.push(arg, candidate);
        if (candidate !== "0.0.0.0" && candidate !== "::") {
          options.previewHost = candidate;
        }
      } else {
        options.astroArgs.push(arg);
      }
      continue;
    }
    options.astroArgs.push(arg);
  }
  return options;
}

function requireValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}
