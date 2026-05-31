# Publishing Official Plugins

This registry accepts official plugin metadata through `entries/official/*.jsonc`.
The first supported plugin is `lapis-docs`.

## Release Asset Requirements

Official plugin releases are immutable. Do not overwrite assets for an existing
plugin version.

Expected asset layout:

```text
assets/<plugin-id>/<version>/
  manifest.json
  main.js
  styles.css
  README.md
  release.json
  release.signed.json
  <plugin-id>-<version>.zip
```

`manifest.json` and `main.js` are required. `styles.css` and `README.md` are
optional.

## Registry Update Flow

1. Build and package the plugin from `lapis-notes`.
2. Sign `release.json` as `release.signed.json` with the official plugin release
   key.
3. Upload immutable assets to Cloudflare Pages under
   `/assets/<plugin-id>/<version>/`.
4. Update `entries/official/<plugin-id>.jsonc`.
5. Set `status` to `active` and remove `pending: true` from files whose assets
   are live.
6. Run:

```sh
pnpm registry:validate:remote
pnpm registry:generate
pnpm registry:sign
pnpm registry:verify-signatures
```

The default `registry:validate` command allows pending entries for local
bootstrap work. The publish workflow uses `registry:validate:remote`, which
fails if pending release manifests remain.
