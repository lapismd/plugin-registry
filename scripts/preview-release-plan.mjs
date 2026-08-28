#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "jsonc-parser";

import { sha256, stableStringify } from "./lib/registry.mjs";
import {
  validateDispatchPayload,
  verifyChecksumFile,
  verifyReleaseBundle,
} from "./sync-github-release.mjs";

export async function previewReleasePlan(options) {
  const planPath = path.resolve(options.planPath);
  const planDirectory = path.dirname(planPath);
  const releaseRoot = path.resolve(
    options.releaseRoot ??
      (path.basename(planDirectory) === ".release"
        ? path.dirname(planDirectory)
        : planDirectory),
  );
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.releases)) {
    throw new Error("Release plan must use schemaVersion 1 with releases.");
  }
  const publicKeyPem = await readFile(
    path.resolve(options.publicKeyPath),
    "utf8",
  );
  const entriesDirectory = path.resolve(
    options.entriesDirectory ??
      new URL("../entries/official/", import.meta.url).pathname,
  );
  const releases = [];
  for (const candidate of plan.releases) {
    const payload = validateDispatchPayload({
      repository: candidate.repository,
      package_name: candidate.packageName,
      plugin_id: candidate.pluginId,
      version: candidate.version,
      release_tag: candidate.releaseTag,
      asset_name: candidate.assetName,
      source_commit: candidate.sourceCommit,
    });
    const archivePath = path.resolve(releaseRoot, candidate.archive.path);
    const checksumPath = path.resolve(
      releaseRoot,
      candidate.archive.checksumPath,
    );
    const [bundleBytes, checksumBytes] = await Promise.all([
      readFile(archivePath),
      readFile(checksumPath),
    ]);
    const archiveSha256 = sha256(bundleBytes);
    if (
      archiveSha256 !== candidate.archive.sha256 ||
      bundleBytes.byteLength !== candidate.archive.size
    ) {
      throw new Error(
        `${candidate.pluginId}: release plan archive metadata differs.`,
      );
    }
    verifyChecksumFile(checksumBytes, candidate.assetName, archiveSha256);
    const verified = verifyReleaseBundle({
      payload,
      bundleBytes,
      trust: {
        root: {},
        keys: new Map([
          [
            candidate.signingKeyId,
            {
              keyId: candidate.signingKeyId,
              publicKeyPem,
              source: "trust-root",
            },
          ],
        ]),
        releaseRoles: new Set([candidate.signingKeyId]),
      },
    });
    const existing = await readEntry(candidate.pluginId, entriesDirectory);
    releases.push({
      entryPath: `entries/official/${candidate.pluginId}.jsonc`,
      action: existing ? "add-version" : "create-entry",
      pluginId: candidate.pluginId,
      packageName: candidate.packageName,
      previousLatestVersion: existing?.latestVersion ?? null,
      nextLatestVersion: candidate.version,
      preservedVersions: Object.keys(existing?.versions ?? {}).sort(),
      signedFiles: verified.release.files.length,
      source: {
        repository: candidate.repository,
        releaseTag: candidate.releaseTag,
        sourceCommit: candidate.sourceCommit,
      },
      archive: {
        assetName: candidate.assetName,
        sha256: archiveSha256,
        size: bundleBytes.byteLength,
      },
    });
  }
  const preview = {
    schemaVersion: 1,
    production: Boolean(plan.production),
    generatedFrom: plan.generatedFrom,
    releaseCount: releases.length,
    changes: releases,
  };
  if (options.outputPath) {
    const outputPath = path.resolve(options.outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${stableStringify(preview, 2)}\n`);
  }
  return preview;
}

async function readEntry(pluginId, entriesDirectory) {
  const entryPath = path.join(entriesDirectory, `${pluginId}.jsonc`);
  if (!existsSync(entryPath)) return null;
  const errors = [];
  const entry = parse(await readFile(entryPath, "utf8"), errors, {
    allowTrailingComma: true,
  });
  if (errors.length) throw new Error(`${entryPath}: invalid JSONC.`);
  return entry;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--release-plan") options.planPath = args[++index];
    else if (arg === "--release-root") options.releaseRoot = args[++index];
    else if (arg === "--public-key") options.publicKeyPath = args[++index];
    else if (arg === "--entries") options.entriesDirectory = args[++index];
    else if (arg === "--output") options.outputPath = args[++index];
    else throw new Error(`Unknown option: ${arg}.`);
  }
  if (!options.planPath || !options.publicKeyPath) {
    throw new Error("--release-plan and --public-key are required.");
  }
  return options;
}

async function main() {
  const preview = await previewReleasePlan(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(preview, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
