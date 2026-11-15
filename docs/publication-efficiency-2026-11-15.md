# Registry publication efficiency qualification

This change completes the registry-owned S5 source boundary. Hosted candidate
upload/replay and the next real approved batch remain rollout acceptance; it
does not claim that deployment, new releases or all S5 consumers are qualified.
No signing secret was retrieved, no release was manufactured, and no deployment
switch, protection, approval or existing publication PR was changed locally.

## Existing boundary and measured baseline

Per-plugin one-file submissions and one aggregate publication PR already existed.
They remain the approval boundary; this change does not replace that queue.
[Publication PR #160](https://github.com/lapismd/plugin-registry/pull/160)
combined one approved submission into seven changed files. Its originating
[run 43759175967](https://github.com/lapismd/plugin-registry/actions/runs/43759175967)
had a 105-second job and an 83-second combined verification/build/sign/write step.
That old step cannot attribute build minutes separately. New reports measure
verification/build time, fetch reuse, attempts and exact input/output identities.
No hosted after-rollout time saving is asserted yet.

The initial exact command was:

```sh
node --test --test-name-pattern 'an identical qualified publication' scripts/__tests__/registry-publication.test.mjs
```

After a missing-dependency setup failure, it reproduced one functional failure:
an identical qualified publication still entered verification, building/signing
and writing. The exact target now passes. A workflow test tied to floating tags
also failed once while the workflow was pinned; it now verifies the exact known
action revisions. All functional and browser failures are now zero.

## Implemented source contract

- Existing source/signature/hash/curation/ownership and deploy gates remain.
- Read-only preparation qualifies once and uploads a bounded immutable public
  candidate before any publication write.
- A separate workflow validates the exact successful producer attempt/job,
  source/queue/toolchain identity and Actions artifact ID/SHA-256. It has a
  one-repository writer token and no registry signing secret.
- Fixed ZIP members, allowed public paths/modes, patch paths, tree and commit
  hashes are checked before publication; import uses an isolated index and
  never checks out candidate code. No credential/config/signer bytes are packed.
- Duplicate preparation and writer dispatches reuse qualified bytes; failed
  remote uploads and uncertain PR writes resume from durable qualification.
  Unknown writes are read back or held, never blindly replayed.
- Public-safe versioned reports remain ignored Actions artifacts, with phase,
  source/queue/candidate/artifact identities, timing and recovery guidance.

The exact failed-upload regression is
`failed remote upload resumes from durable candidate without repeating qualification or signing`
in `scripts/__tests__/publication-checkpoint.test.mjs`. Its first failed write
performs no automatic retry; resumed publication retains one total verification,
one build/sign operation and one aggregate PR. A repeated dispatch performs no
new publication write. Mutation, private/config path, traversal, symlink,
non-regular mode, source/queue/runtime, producer, missing/expired artifact and
actual tree/commit mismatch tests fail closed.

An integration fixture verifies and applies a genuinely signed plugin archive
with one network fetch of its bytes. Changing the trusted release role still
rejects application despite cached bytes, proving that byte reuse does not cache
or waive signature authority.

## Local acceptance

Use Node 24.15.0 and the repository's pnpm 10.32.1:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm registry:validate:remote
pnpm registry:submissions:verify
actionlint .github/workflows/*.yml
```

The complete check passes 140 unit tests, 25 cold browser scenarios, source and
signature/statistics validation, Astro checking with zero errors/warnings,
the 147-page site build and formatting. Actionlint 1.7.12 passes. Strict remote
validation verifies 19 registry entries. After rebasing onto main `a81fd3b2`,
both actual queued Bases 0.4.1 and Canvas 0.4.1 submissions verify successfully.
A subsequent data-only rebase onto `9b81ea8f` also preserves Markdown 0.3.2;
all three queued submissions verify. Authenticated GET-only discovery identified
the existing aggregate PR #164; its state was not changed. No source package/lockfile change,
local tarball, package patch, new specification system or signing-key setup is
needed. The repository has no tracked AGENTS.md; workspace guidance and existing
publishing docs govern this work.

Public production read-back returned HTTP 200 from
[the registry](https://registry.lapis.md). Its 19-plugin V2 index's inline/sidecar
signature verifies against the committed public trust root. This is an unchanged
production baseline, not evidence that the new writer has been deployed.

## Hosted handoff and recovery

After source PR review and complete hosted CI, qualify the successful producer
artifact and separate writer, then replay the exact producer after a controlled
writer failure. Confirm no repeated qualification/signing, one publication PR,
unchanged curator/manual holds and ordinary functional PR checks. Use the next
real approved queue; do not invent a release to exercise the pipeline.

The [publishing guide](publishing-official-plugins.md#qualified-batch-reuse-and-recovery)
provides the concrete writer recovery command and artifact expiry behavior.
Image digest promotion remains owned by shared CI/source publishers. Maintenance
can consume these report artifacts through its existing read boundary; no
operational report belongs in a public book, website bundle or tracked source.

Rollback reverts the source workflow/controller change, retaining queued records,
reviewed PRs, signed catalog and deployment approval. Existing immutable artifacts
expire naturally. Inspect branch/PR ownership before restoring any older writer;
never reset state, delete repairs or replay an uncertain publication blindly.
