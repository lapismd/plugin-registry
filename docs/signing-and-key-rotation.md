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
      "keyId": "lapis-registry-2026-01",
      "alg": "ed25519",
      "sig": "base64-signature"
    }
  ]
}
```

Each also has a matching `.sig` sidecar with the same signature record:

```json
{
  "keyId": "lapis-registry-2026-01",
  "alg": "ed25519",
  "sig": "base64-signature"
}
```

Public keys are recorded in `generated/v1/trust/root.json` as both PEM for
Node-side tooling and raw base64 Ed25519 key bytes for browser verification.
Private keys are provided through protected CI secrets and must never be
committed.

## CI Secrets

- `LAPIS_REGISTRY_KEY_ID`
- `LAPIS_REGISTRY_PRIVATE_KEY_PEM`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Rotation

To rotate a registry key:

1. Add the new public key by running `pnpm registry:sign` with the new key ID.
2. Keep the old key in `root.json` while clients update.
3. Re-sign all registry metadata with the new key.
4. Remove the old key after the app version that trusts the new key has shipped.

For production, root keys should eventually be managed offline or by KMS. The V1
bootstrap keeps the format browser-verifiable and operationally simple.
