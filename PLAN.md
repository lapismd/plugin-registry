# Lapis Plugin Registry Setup and Publishing Guide

**Status:** Proposed implementation guide  
**Last updated:** 2026-05-31  
**Audience:** Lapis maintainers, release engineers, and agents preparing the registry/release pipeline

## 1. Purpose

This document describes how to set up a Lapis plugin registry that mirrors the useful parts of Obsidian's plugin distribution model while supporting Lapis-specific requirements:

- A separate manifest/registry repository.
- Install files hosted as immutable release assets.
- First-party “official” plugins published from the Lapis monorepo.
- Community plugins registered by metadata PRs.
- Signed registry metadata and signed official releases.
- A clear distinction between **built-in core**, **official installable**, and **community** plugins.
- Compatibility with both web and Electron.

The goal is to make optional first-party plugins downloadable through the app without statically bundling all of them into the main workspace bundle.

## 2. Current Lapis constraints and opportunities

The current app already has most of the runtime substrate needed for an Obsidian-like install model:

- Community plugins are discovered from `/.obsidian/plugins`.
- Plugin folders are expected to contain `manifest.json` and usually `main.js`.
- Optional `styles.css` is loaded from the plugin folder when the plugin is enabled.
- Enabled community plugin IDs are tracked through `/.obsidian/community-plugins.json`.
- Plugin manifests already include fields such as `id`, `name`, `author`, `version`, `minAppVersion`, `isDesktopOnly`, `supportedRuntimes`, `requiredCapabilities`, and Lapis-specific metadata.
- Electron can route privileged plugins through the native desktop sidecar when a manifest requests capabilities, desktop runtimes, or trusted desktop execution.

The registry should therefore **not replace the existing plugin manager**. It should add a distribution layer that downloads, verifies, and writes plugin folders into the existing plugin directory layout.

## 3. Terminology and policy

Use these terms consistently in code, registry metadata, and UI.

| Term                     | Meaning                                                                 |                      Who decides it? | Can plugin `manifest.json` claim it? | Loaded from                           |
| ------------------------ | ----------------------------------------------------------------------- | -----------------------------------: | -----------------------------------: | ------------------------------------- |
| **Built-in core**        | Plugin code shipped in the app bundle and registered by bootstrap code. |                           App bundle |                                   No | Static import / app code              |
| **System**               | App-owned locked behavior required for startup or safety.               |                           App bundle |                                   No | Static import / app code              |
| **Official installable** | Downloaded plugin signed and published by Lapis.                        | Verified registry + app trust policy |                                   No | `/.obsidian/plugins/<id>`             |
| **Community**            | Plugin from community registry or manual install.                       |           Registry/manual provenance |                                   No | `/.obsidian/plugins/<id>`             |
| **Development/local**    | Plugin loaded from a local path during development.                     |                       User/developer |                                   No | `/.obsidian/plugins/<id>` or dev path |

### Core vs official

**Core is a runtime/bundling concept. Official is a provenance/signature concept.**

A downloaded plugin should generally not become runtime `core`, even if authored by Lapis. Instead, it should be a community-style installed plugin with official provenance in `installed-plugins.json`.

Recommended policy:

```text
runtime source: community-style installed plugin
provenance: official
signature: Lapis official release key
UI label: Official / Verified
core status: no
```

Only features required for safe app boot should remain true built-in core/system plugins.

## 4. Recommended plugin buckets

### Keep built in initially

These are candidates to remain bundled until the registry system is stable:

- App shell / app plugin.
- Settings/configuration shell.
- Notifications.
- Markdown baseline.
- File explorer.
- Tabs/workspace basics.
- Search, optionally, if users expect it immediately.
- Tags, optionally.

### Move to official installable plugins first

Move heavier optional features first:

1. Docs.
2. PDF.
3. Slides.
4. Canvas.
5. Notebook.
6. Bases.
7. Graph.
8. Telemetry.
9. Other optional first-party plugins after the pilot proves safe.

## 5. Repository layout

Create a new registry repository, for example:

```text
lapis-plugin-registry/
  README.md
  package.json
  pnpm-lock.yaml

  entries/
    official/
      lapis-docs.jsonc
      lapis-pdf.jsonc
      lapis-canvas.jsonc
    community/
      example-community-plugin.jsonc

  generated/
    v1/
      index.json
      index.sig
      plugins/
        lapis-docs.json
        lapis-pdf.json
      trust/
        root.json
        root.sig
      revoked.json
      revoked.sig

  schemas/
    catalog-index.schema.json
    catalog-entry.schema.json
    plugin-detail.schema.json
    plugin-release.schema.json
    signed-envelope.schema.json
    revoked.schema.json

  scripts/
    validate-registry.mjs
    generate-registry.mjs
    sign-registry.mjs
    verify-release.mjs
    check-links.mjs

  docs/
    publishing-official-plugins.md
    publishing-community-plugins.md
    signing-and-key-rotation.md
```

### Source vs generated files

`entries/**` are human-maintained files reviewed in PRs.

`generated/v1/**` are generated by CI:

- JSON comments are stripped.
- Entries are normalized.
- Release URLs are checked.
- Hashes and file sizes are verified.
- The index and detail documents are signed.

Recommended rule:

```text
PRs modify entries/** and schemas/**.
CI regenerates generated/v1/** and checks that the committed generated files match.
```

This makes the registry auditable in normal code review.

## 6. Hosted registry layout

Publish `generated/v1` as static files through GitHub Pages, Cloudflare Pages, S3/R2, or another static host.

Public layout:

```text
/v1/index.json
/v1/index.sig
/v1/plugins/lapis-docs.json
/v1/plugins/lapis-pdf.json
/v1/trust/root.json
/v1/trust/root.sig
/v1/revoked.json
/v1/revoked.sig
```

The app should be configured with one or more registry sources:

```json
{
  "registries": [
    {
      "id": "lapis-official",
      "name": "Lapis Official Plugins",
      "url": "https://registry.example.com/v1/index.json",
      "trustTier": "official",
      "enabled": true
    },
    {
      "id": "lapis-community",
      "name": "Lapis Community Plugins",
      "url": "https://registry.example.com/v1/index.json",
      "trustTier": "community",
      "enabled": true
    }
  ]
}
```

For v1, official and community entries may live in the same registry repo but should still have distinct channels and trust policies.

## 7. Registry index format

The index should be small enough to fetch at startup or when the Plugins screen opens. It must include enough contribution metadata to support on-demand installation prompts.

Example:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-31T00:00:00.000Z",
  "registries": {
    "lapis-official": {
      "name": "Lapis Official Plugins",
      "trustTier": "official"
    }
  },
  "plugins": [
    {
      "id": "lapis-docs",
      "name": "Docs",
      "description": "Rich document and spreadsheet editing for Lapis.",
      "author": "Lapis Notes",
      "channel": "official",
      "latestVersion": "0.1.0",
      "minAppVersion": "0.20.0",
      "platforms": ["web", "electron"],
      "categories": ["editor", "documents"],
      "badges": ["official", "verified"],
      "detail": "plugins/lapis-docs.json",
      "contributes": {
        "editorViews": [
          {
            "id": "lapis-doc",
            "filenamePatterns": ["*.lapisdoc", "*.lapissheet"]
          }
        ]
      }
    }
  ],
  "signatures": [
    {
      "keyId": "lapis-registry-2026-01",
      "alg": "ed25519",
      "sig": "base64-signature"
    }
  ]
}
```

### Required index fields

Each `plugins[]` entry should include:

- `id`
- `name`
- `description`
- `author`
- `channel`
- `latestVersion`
- `minAppVersion`
- `platforms`
- `categories`
- `detail`
- contribution summary, when available

### Contribution summaries

The index should include a summary of plugin-provided file handlers and extension points. This allows Lapis to say:

```text
This file type is supported by the official Docs plugin.
Install Docs to open this file.
```

without downloading the full plugin first.

## 8. Plugin detail format

Each plugin gets a detail file with full release history.

```json
{
  "schemaVersion": 1,
  "id": "lapis-docs",
  "name": "Docs",
  "description": "Rich document and spreadsheet editing for Lapis.",
  "channel": "official",
  "owner": {
    "name": "Lapis Notes",
    "verified": true
  },
  "latestVersion": "0.1.0",
  "readme": {
    "url": "https://assets.example.com/lapis-docs/0.1.0/README.md",
    "sha256": "..."
  },
  "versions": {
    "0.1.0": {
      "version": "0.1.0",
      "minAppVersion": "0.20.0",
      "releasedAt": "2026-05-31T00:00:00.000Z",
      "platforms": ["web", "electron"],
      "releaseManifest": {
        "url": "https://assets.example.com/lapis-docs/0.1.0/release.signed.json",
        "sha256": "...",
        "size": 4096
      },
      "files": [
        {
          "path": "manifest.json",
          "url": "https://assets.example.com/lapis-docs/0.1.0/manifest.json",
          "sha256": "...",
          "size": 300
        },
        {
          "path": "main.js",
          "url": "https://assets.example.com/lapis-docs/0.1.0/main.js",
          "sha256": "...",
          "size": 482000
        },
        {
          "path": "styles.css",
          "url": "https://assets.example.com/lapis-docs/0.1.0/styles.css",
          "sha256": "...",
          "size": 24000,
          "optional": true
        }
      ]
    }
  },
  "signatures": [
    {
      "keyId": "lapis-registry-2026-01",
      "alg": "ed25519",
      "sig": "base64-signature"
    }
  ]
}
```

## 9. Release asset layout

Each plugin release should be immutable. Do not overwrite release assets for the same plugin version.

Recommended release layout:

```text
lapis-docs/0.1.0/
  manifest.json
  main.js
  styles.css
  README.md
  release.json
  release.signed.json
  lapis-docs-0.1.0.zip
```

For v1, keep the installed plugin contract Obsidian-shaped:

```text
/.obsidian/plugins/<plugin-id>/
  manifest.json
  main.js
  styles.css       optional
  README.md        optional
  data.json        runtime plugin data
```

### Future chunk support

Start with `main.js` as a single bundled file. Add chunk support only after the first official plugin pilot works.

Future chunk release:

```json
{
  "files": [
    { "path": "manifest.json", "sha256": "...", "size": 300 },
    { "path": "main.js", "sha256": "...", "size": 120000 },
    { "path": "assets/univer-runtime.js", "sha256": "...", "size": 900000 },
    { "path": "styles.css", "sha256": "...", "size": 24000 }
  ]
}
```

## 10. Release manifest and signing

The registry should sign metadata, not just files.

Each official release should include a canonical `release.json`:

```json
{
  "schemaVersion": 1,
  "type": "lapis.plugin.release",
  "pluginId": "lapis-docs",
  "version": "0.1.0",
  "channel": "official",
  "source": {
    "repo": "lapis-monorepo",
    "commit": "COMMIT_SHA",
    "package": "packages/plugins/plugin-docs"
  },
  "compatibility": {
    "minAppVersion": "0.20.0",
    "platforms": ["web", "electron"]
  },
  "files": [
    {
      "path": "manifest.json",
      "sha256": "...",
      "size": 300
    },
    {
      "path": "main.js",
      "sha256": "...",
      "size": 482000
    },
    {
      "path": "styles.css",
      "sha256": "...",
      "size": 24000,
      "optional": true
    }
  ]
}
```

Then sign a canonical JSON envelope:

```json
{
  "signed": {
    "schemaVersion": 1,
    "type": "lapis.plugin.release",
    "pluginId": "lapis-docs",
    "version": "0.1.0"
  },
  "signatures": [
    {
      "keyId": "lapis-official-release-2026-01",
      "alg": "ed25519",
      "sig": "base64-signature"
    }
  ]
}
```

Use a deterministic JSON canonicalization scheme. Recommended options:

- RFC 8785 JSON Canonicalization Scheme.
- A small internal canonicalizer with sorted object keys and stable primitive encoding, if the implementation is carefully tested.

## 11. Signing roles

Use separate signing roles even if v1 starts with one private key.

```text
Root key
  Offline. Public key embedded in Lapis app.

Registry key
  Signs index.json, plugin detail files, and revoked.json.

Official plugin release key
  Signs official plugin release manifests.

Core plugin release key
  Optional stricter key for downloadable plugins that are allowed to be treated as built-in-equivalent.
```

### v1 minimum signing policy

The app should verify:

1. Registry root/index signature against an embedded public key.
2. Plugin detail signature.
3. Release manifest signature.
4. Downloaded file SHA-256 and size.
5. Installed `manifest.json` ID and version match `release.json`.
6. Reserved ID policy.
7. Platform and `minAppVersion` compatibility.

### Later hardening

After v1, add TUF-like metadata roles:

```text
root.json       trusted root keys and key rotation
snapshot.json   hashes and versions of registry metadata
index.json      plugin target metadata
revoked.json    revoked plugin IDs and releases
timestamp.json  short-lived freshness metadata
```

This protects better against stale metadata and mix-and-match release attacks.

## 12. Key handling

Private keys must not be committed to any repo.

Recommended options:

- CI protected secrets for v1.
- Hardware-backed signing or KMS for production.
- Manual offline root signing for key rotation.
- Cosign/Sigstore as an additional CI audit trail, not the only browser-verifiable mechanism.

The web app must be able to verify signatures without native code. Use a browser-compatible Ed25519 verifier, for example a well-maintained JavaScript crypto library or WebCrypto where supported.

## 13. Registry bootstrap steps

### Step 1: Create the registry repo

```bash
mkdir lapis-plugin-registry
cd lapis-plugin-registry
pnpm init
mkdir -p entries/official entries/community generated/v1/plugins generated/v1/trust schemas scripts docs
```

### Step 2: Add schema files

Create JSON schemas for:

```text
schemas/catalog-index.schema.json
schemas/catalog-entry.schema.json
schemas/plugin-detail.schema.json
schemas/plugin-release.schema.json
schemas/signed-envelope.schema.json
schemas/revoked.schema.json
```

Schema validation should be strict:

- No unknown top-level fields unless explicitly allowed.
- Semver versions only.
- Plugin IDs must match a safe pattern such as `^[a-z0-9][a-z0-9-]{1,62}$`.
- Paths must be relative and must not contain `..`.
- URLs must be HTTPS, except local development registry sources.
- `channel` must be `official` or `community`.
- Official plugin IDs must be reserved to Lapis.

### Step 3: Add registry validation script

`scripts/validate-registry.mjs` should:

1. Read all `entries/**/*.jsonc`.
2. Strip comments.
3. Validate schemas.
4. Enforce unique plugin IDs.
5. Enforce reserved namespace rules.
6. Resolve release assets.
7. Fetch release manifests.
8. Verify hashes and sizes.
9. Verify release signatures for official entries.
10. Check `manifest.json` ID/version compatibility.

### Step 4: Add registry generation script

`scripts/generate-registry.mjs` should:

1. Read validated entries.
2. Normalize fields.
3. Sort plugins by ID.
4. Generate `generated/v1/index.json`.
5. Generate `generated/v1/plugins/<plugin-id>.json`.
6. Generate `generated/v1/revoked.json`.
7. Preserve stable ordering for deterministic signatures.

### Step 5: Add signing script

`scripts/sign-registry.mjs` should:

1. Canonicalize generated JSON.
2. Sign `index.json`, each plugin detail file, and `revoked.json`.
3. Write `.sig` sidecars or embedded `signatures[]` arrays.
4. Verify immediately after signing.

### Step 6: Add CI

Example CI job:

```yaml
name: registry

on:
  pull_request:
  push:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm registry:validate
      - run: pnpm registry:generate
      - run: git diff --exit-code generated/v1
      - run: pnpm registry:verify-signatures
```

### Step 7: Publish static registry

Publish `generated/v1` to the static host.

Requirements:

- HTTPS.
- CORS enabled for the Lapis web app origin.
- Long cache for immutable plugin assets.
- Shorter cache for `index.json`, `revoked.json`, and timestamp metadata.
- ETag or content hash support preferred.

## 14. Monorepo packaging for official plugins

Add scripts to the Lapis monorepo:

```text
scripts/package-plugin.mjs
scripts/sign-plugin-release.mjs
scripts/publish-plugin-release.mjs
scripts/open-registry-pr.mjs
```

Add root package scripts:

```json
{
  "plugin:package": "node scripts/package-plugin.mjs",
  "plugin:sign": "node scripts/sign-plugin-release.mjs",
  "plugin:publish": "node scripts/publish-plugin-release.mjs",
  "plugin:registry-pr": "node scripts/open-registry-pr.mjs"
}
```

### Package script responsibilities

`package-plugin.mjs` should:

1. Accept a package path or package name.
2. Run the package build.
3. Read `dist/manifest.json` or `manifest.json`.
4. Verify `main.js` exists.
5. Verify `styles.css` exists if expected.
6. Read `README.md` if present.
7. Validate manifest fields.
8. Check `manifest.id` matches the release/plugin ID.
9. Check `manifest.version` matches the release version.
10. Hash all release files.
11. Generate `release.json`.
12. Generate a zip artifact.
13. Write all outputs into `dist-plugin/<plugin-id>/<version>/`.

Example command:

```bash
pnpm --filter @lapis-notes/docs build
node scripts/package-plugin.mjs packages/plugins/plugin-docs --id lapis-docs --version 0.1.0
```

### Recommended packaged output

```text
dist-plugin/lapis-docs/0.1.0/
  manifest.json
  main.js
  styles.css
  README.md
  release.json
  release.signed.json
  lapis-docs-0.1.0.zip
```

### Build requirement for plugin packages

Each first-party plugin package should emit:

```text
dist/
  manifest.json
  main.js
  styles.css       optional but recommended
```

If a plugin currently emits inline CSS through workspace bootstrap, add a package-local styles build that emits `styles.css`.

## 15. Publishing official plugins

Use this flow for Docs first, then repeat for other optional plugins.

### Step 1: Classify the plugin

Decide:

```text
Built-in core?       no, unless required for safe boot
Official installable? yes
Community?           no
Desktop only?        depends on manifest
Web compatible?      depends on dependencies and runtime APIs
```

For Docs, recommended classification:

```text
runtime source: installed plugin
provenance: official
channel: official
platforms: web, electron
```

### Step 2: Reserve the plugin ID

Use a Lapis-owned namespace for official installable plugins.

Recommended IDs:

```text
lapis-docs
lapis-pdf
lapis-canvas
lapis-slides
lapis-notebook
lapis-bases
lapis-graph
lapis-telemetry
```

If the current bundled plugin ID is shorter, such as `docs`, add a migration plan before changing it publicly.

### Step 3: Update plugin manifest

Ensure `manifest.json` has:

```json
{
  "id": "lapis-docs",
  "name": "Docs",
  "version": "0.1.0",
  "minAppVersion": "0.20.0",
  "description": "Rich document and spreadsheet editing for Lapis.",
  "author": "Lapis Notes",
  "isDesktopOnly": false,
  "supportedRuntimes": ["browser", "electron"]
}
```

If ID migration is deferred, keep the existing ID and add registry aliases:

```json
{
  "id": "docs",
  "displayId": "lapis-docs",
  "reservedBy": "lapis"
}
```

Do not allow third-party registry entries to use reserved official IDs or confusing aliases.

### Step 4: Build the plugin

```bash
pnpm --filter @lapis-notes/docs build
```

Then package:

```bash
node scripts/package-plugin.mjs packages/plugins/plugin-docs --id lapis-docs
```

### Step 5: Sign the release manifest

```bash
node scripts/sign-plugin-release.mjs dist-plugin/lapis-docs/0.1.0/release.json \
  --key-id lapis-official-release-2026-01 \
  --out dist-plugin/lapis-docs/0.1.0/release.signed.json
```

### Step 6: Upload immutable assets

Upload these files to the release host:

```text
manifest.json
main.js
styles.css
README.md
release.json
release.signed.json
lapis-docs-0.1.0.zip
```

Do not overwrite these files after publication. If a fix is required, publish `0.1.1`.

### Step 7: Add or update registry entry

Create `entries/official/lapis-docs.jsonc`:

```jsonc
{
  "id": "lapis-docs",
  "name": "Docs",
  "description": "Rich document and spreadsheet editing for Lapis.",
  "author": "Lapis Notes",
  "channel": "official",
  "categories": ["editor", "documents"],
  "platforms": ["web", "electron"],
  "latestVersion": "0.1.0",
  "detail": {
    "versions": {
      "0.1.0": {
        "releaseManifestUrl": "https://assets.example.com/lapis-docs/0.1.0/release.signed.json",
      },
    },
  },
  "contributes": {
    "editorViews": [
      {
        "id": "lapis-doc",
        "filenamePatterns": ["*.lapisdoc", "*.lapissheet"],
      },
    ],
  },
}
```

### Step 8: Validate and generate registry

```bash
pnpm registry:validate
pnpm registry:generate
pnpm registry:sign
pnpm registry:verify
```

### Step 9: Open registry PR

The PR should include:

- Human-readable summary.
- Plugin ID and version.
- Source monorepo commit.
- Release asset URLs.
- Hashes.
- Signed release manifest.
- Compatibility statement.
- Manual test notes.

### Step 10: Publish and smoke-test through the app

In a clean vault:

1. Open Settings → Plugins → Browse.
2. Refresh registry.
3. Search for Docs.
4. Install Docs.
5. Enable Docs.
6. Verify files are written to `/.obsidian/plugins/lapis-docs`.
7. Verify `installed-plugins.json` records official provenance and hashes.
8. Open a `.lapisdoc` file.
9. Restart the app and verify the plugin loads from installed files.
10. Test web and Electron.

## 16. Publishing community plugins

Community plugin publishing should be similar but with different trust rules.

### Community entry requirements

A community registry entry must include:

- Plugin ID.
- Name.
- Description.
- Author.
- Source repository.
- Latest version.
- Release asset URLs.
- Hashes.
- Compatibility.
- Platform support.
- Capability requests, if any.
- License.

### Community review policy

Registry review should check:

- No reserved Lapis IDs or confusing names.
- No malware or obvious supply-chain risks.
- No hidden remote code loading unless explicitly declared and allowed.
- No privileged desktop execution unless the app can gate it behind workspace trust and user permission.
- Manifest `minAppVersion` is reasonable.
- Release assets are immutable.

Community entries should show as **Community**, not **Official**, even if hosted in the same registry repo.

## 17. Installed state in Lapis

Keep enabled state separate from installed metadata.

Existing enabled list:

```text
/.obsidian/community-plugins.json
```

New installed metadata:

```text
/.obsidian/installed-plugins.json
```

Example:

```json
{
  "schemaVersion": 1,
  "plugins": {
    "lapis-docs": {
      "id": "lapis-docs",
      "version": "0.1.0",
      "provenance": "official",
      "registryId": "lapis-official",
      "installedAt": "2026-05-31T00:00:00.000Z",
      "autoUpdate": true,
      "files": {
        "manifest.json": "sha256-...",
        "main.js": "sha256-...",
        "styles.css": "sha256-..."
      },
      "releaseSignatureKeyIds": ["lapis-official-release-2026-01"]
    }
  }
}
```

Do not store provenance in the plugin's own `manifest.json` as a trusted signal. The manifest is plugin-controlled content.

## 18. Reserved ID policy

Maintain an app-embedded and registry-enforced reserved namespace list:

```json
{
  "reservedPrefixes": ["lapis-"],
  "reservedIds": [
    "app",
    "markdown",
    "notifications",
    "lapis-docs",
    "lapis-pdf",
    "lapis-canvas"
  ]
}
```

Rules:

- Community plugins cannot use `lapis-*` IDs.
- Community plugins cannot use names that visually spoof official plugins.
- A plugin is official only if installed from an official registry entry verified by a Lapis release key.
- A plugin is true built-in core only if it is registered by the app bundle or appears in an app-embedded core allowlist and verifies under the stricter core signing role.

## 19. Revocation

Add `generated/v1/revoked.json`:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-31T00:00:00.000Z",
  "revoked": [
    {
      "pluginId": "lapis-docs",
      "versions": ["0.1.0"],
      "reason": "security",
      "message": "This release has been revoked. Update to 0.1.1.",
      "revokedAt": "2026-05-31T00:00:00.000Z"
    }
  ],
  "signatures": [
    {
      "keyId": "lapis-registry-2026-01",
      "alg": "ed25519",
      "sig": "base64-signature"
    }
  ]
}
```

App behavior:

- Official revoked release: disable on next boot unless a safe replacement is installed.
- Community revoked release: warn prominently and require user action to keep enabled.
- Manual local plugin: show warning if it matches a known revoked ID/version, but avoid destructive action without user confirmation.

## 20. Migration from bundled core to official installable

When moving a bundled plugin to registry distribution:

1. Publish the official plugin first.
2. Ship an app update that knows the plugin is movable.
3. On boot, detect old bundled-core plugin data.
4. If the plugin is disabled, do not auto-install unless required by a file open action.
5. If the plugin was enabled, prompt or auto-install according to release policy.
6. Copy old data to the new community-style plugin data path if the new path does not exist.
7. Mark migration complete in `installed-plugins.json`.
8. Remove static imports from workspace bootstrap in a later release.

Data path migration:

```text
old: /.obsidian/<id>.json
new: /.obsidian/plugins/<id>/data.json
```

If an ID changes, record aliases:

```json
{
  "migrations": {
    "docs": {
      "newId": "lapis-docs",
      "dataMigratedAt": "2026-05-31T00:00:00.000Z"
    }
  }
}
```

## 21. Web and Electron hosting requirements

### Web/PWA

Requirements:

- Registry and asset host must support CORS.
- Assets must be downloadable from browser JavaScript.
- Installed files should be written through the existing vault adapter.
- Desktop-only plugins must be rejected.
- Plugins requesting native capabilities must be rejected or hidden.
- Signature verification must run in browser-compatible JavaScript.

### Electron

Requirements:

- Use the same installed plugin layout as web.
- Allow desktop-only plugins when host supports them.
- Route trusted desktop or capability-based plugins through the native sidecar.
- Gate privileged plugins behind workspace trust and explicit permissions.
- Prefer the same registry verification path as web so behavior is consistent.

## 22. Registry source configuration

Add default registry source config to the app bundle:

```json
{
  "schemaVersion": 1,
  "sources": [
    {
      "id": "lapis-official",
      "name": "Lapis Official Plugins",
      "url": "https://registry.example.com/v1/index.json",
      "trustTier": "official",
      "enabled": true,
      "builtin": true
    }
  ]
}
```

User-added sources can be supported later, but for v1 keep the default official source locked and signed.

## 23. Release checklist for an official plugin

Use this checklist for each first-party plugin release.

```text
[ ] Plugin classification approved.
[ ] Plugin ID reserved.
[ ] Manifest ID/version/minAppVersion checked.
[ ] Plugin builds locally.
[ ] main.js emitted.
[ ] styles.css emitted or intentionally absent.
[ ] README included.
[ ] release.json generated.
[ ] release.signed.json generated.
[ ] File hashes verified.
[ ] Immutable assets uploaded.
[ ] Registry entry updated.
[ ] Registry CI passes.
[ ] App install tested on web.
[ ] App install tested on Electron.
[ ] Plugin enable/disable tested.
[ ] Restart load tested.
[ ] Update path tested from previous version.
[ ] Revocation behavior considered.
[ ] Migration notes written if moving from bundled core.
```

## 24. Pilot plan: Docs plugin

Use Docs as the first pilot because it is optional and comparatively heavy.

### Tasks

1. Decide final plugin ID: `lapis-docs` is preferred.
2. Add ID/data migration from `docs` if needed.
3. Ensure package build emits `manifest.json`, `main.js`, and `styles.css`.
4. Package and sign `0.1.0`.
5. Publish immutable assets.
6. Add `entries/official/lapis-docs.jsonc`.
7. Generate and sign registry.
8. Add app installer support.
9. Remove Docs from `workspaceCorePlugins` only after installer is working.
10. Add file-open on-demand install prompt for `.lapisdoc` and `.lapissheet`.

### Success criteria

- Clean app bundle does not statically import Docs or Univer runtime.
- Opening `.lapisdoc` before install shows an official plugin install prompt.
- Installing Docs writes files to `/.obsidian/plugins/lapis-docs`.
- Enabling Docs registers the editor views.
- Restarting the app loads Docs from installed plugin files.
- Uninstalling Docs removes plugin files after confirmation but preserves or offers to preserve user data.

## 25. Community registry PR template

```markdown
## Plugin

- ID:
- Name:
- Author:
- Source repo:
- Release version:
- Release URL:

## Compatibility

- Minimum Lapis version:
- Platforms: web / electron / both
- Desktop-only: yes / no
- Capabilities requested:

## Review checklist

- [ ] ID is not reserved.
- [ ] Release assets are immutable.
- [ ] manifest.json, main.js, and styles.css hashes verified.
- [ ] No undeclared remote code loading.
- [ ] No obvious malware behavior.
- [ ] License present.
- [ ] README present.
```

## 26. Maintainer commands summary

Registry repo:

```bash
pnpm install
pnpm registry:validate
pnpm registry:generate
pnpm registry:sign
pnpm registry:verify
```

Lapis monorepo official plugin release:

```bash
pnpm --filter @lapis-notes/docs build
node scripts/package-plugin.mjs packages/plugins/plugin-docs --id lapis-docs
node scripts/sign-plugin-release.mjs dist-plugin/lapis-docs/0.1.0/release.json
node scripts/publish-plugin-release.mjs dist-plugin/lapis-docs/0.1.0
node scripts/open-registry-pr.mjs lapis-docs 0.1.0
```

## 27. References for implementers

Useful current Lapis files:

```text
packages/api/src/lib/plugin.ts
packages/api/src/lib/plugin-manager.ts
packages/workspace/src/lib/components/app/bootstrap.ts
packages/workspace/src/lib/components/configuration/community-plugins.ts
packages/workspace/src/lib/components/configuration/core-plugins.ts
packages/plugins/plugin-docs/package.json
packages/plugins/plugin-docs/vite.config.ts
packages/plugins/plugin-docs/vite.styles.config.ts
```

Useful external reference models:

```text
Obsidian plugin folder layout:
  manifest.json
  main.js
  styles.css

Obsidian registry model:
  community-plugins.json
  per-plugin releases
  versions.json for compatibility fallback

TUF concepts for later hardening:
  root metadata
  targets metadata
  snapshot metadata
  timestamp metadata
```
