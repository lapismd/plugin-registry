# Signing And Key Rotation

Registry metadata is signed with Ed25519 sidecar files.

Signed files:

- `generated/v1/index.json`
- `generated/v1/plugins/*.json`
- `generated/v1/revoked.json`

Each has a matching `.sig` sidecar:

```json
{
  "keyId": "lapis-registry-2026-01",
  "alg": "ed25519",
  "sig": "base64-signature"
}
```

Public keys are recorded in `generated/v1/trust/root.json`. Private keys are
provided through protected CI secrets and must never be committed.

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
