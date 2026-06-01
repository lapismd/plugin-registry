# Signing And Key Rotation

Registry metadata is signed with Ed25519 inline `signatures` fields. Matching
sidecar files are kept as audit artifacts and to make generated-output checks
stable, but the Lapis app verifies the inline signatures.

Signed files:

- `generated/v1/index.json`
- `generated/v1/plugins/*.json`
- `generated/v1/revoked.json`

Each JSON file contains:

```json
{
  "schemaVersion": 1,
  "signatures": [
    {
      "keyId": "lapis-registry-2026-06",
      "alg": "ed25519",
      "sig": "base64-signature"
    }
  ]
}
```

Each also has a matching `.sig` sidecar with the same signature record:

```json
{
  "keyId": "lapis-registry-2026-06",
  "alg": "ed25519",
  "sig": "base64-signature"
}
```

Public keys are recorded in `generated/v1/trust/root.json` as both PEM for
Node-side tooling and raw base64 Ed25519 key bytes for browser verification.
Private keys are provided through protected CI secrets and must never be
committed.

The active V1 registry signing key is `lapis-registry-2026-06`. The earlier
`lapis-registry-bootstrap-2026-05` key is intentionally not trusted because its
private credentials are not part of the current publishing setup.

Local registry signing can use the same operator-friendly fallback pattern as
plugin release signing:

```sh
pnpm registry:keygen
pnpm registry:sign
```

`pnpm registry:keygen` writes `~/.lapis/lapis-registry-key.json` plus sibling
private/public key files. `pnpm registry:sign` still prefers
`LAPIS_REGISTRY_KEY_ID` with either `LAPIS_REGISTRY_PRIVATE_KEY_PEM_B64` or
`LAPIS_REGISTRY_PRIVATE_KEY_PEM`; if those are not set, it reads the default
local registry key.

Plugin release signing keys remain separate. During `pnpm registry:sync:forgejo`,
release manifests are trusted when signed by a release key already listed in
`generated/v1/trust/root.json`, or by a local operator key from
`~/.lapis/lapis-plugin-release-key.json` / release public-key env vars. When a
local release key verifies a synced release, the registry trust root records
that public key under `roles.release`.

## CI Secrets

- `LAPIS_REGISTRY_KEY_ID`
- `LAPIS_REGISTRY_PRIVATE_KEY_PEM_B64`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Create the base64 private key secret from the local registry key:

```sh
base64 -i ~/.lapis/lapis-registry-private.pem | tr -d '\n'
```

## Rotation

To rotate a registry key:

1. Add the new public key by running `pnpm registry:sign` with the new key ID.
2. Keep the old key in `root.json` while clients update.
3. Re-sign all registry metadata with the new key.
4. Remove the old key after the app version that trusts the new key has shipped.

For production, root keys should eventually be managed offline or by KMS. The V1
bootstrap keeps the format browser-verifiable and operationally simple.
