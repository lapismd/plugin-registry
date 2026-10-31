import { sameRequest } from "./registry-request.mjs";
import { stableStringify } from "./registry.mjs";

export class LeaseConflict extends Error {}

export function isIndexedRelease(entry, version) {
  const release = entry?.versions?.[version],
    bundle = release?.bundle;
  return Boolean(
    release?.status !== "pending" &&
      bundle?.status !== "pending" &&
      /^https:\/\//.test(bundle?.url ?? "") &&
      /^[a-f0-9]{64}$/.test(bundle?.sha256 ?? "") &&
      bundle.sha256 !== "0".repeat(64) &&
      Number.isSafeInteger(bundle.size) &&
      bundle.size > 0,
  );
}

export function compareVersions(a, b) {
  const parse = (value) => {
    const match = value.match(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/,
    );
    if (!match) throw new Error(`Invalid version: ${value}`);
    return {
      numbers: match.slice(1, 4).map(BigInt),
      prerelease: match[4]?.split("."),
    };
  };
  const av = parse(a),
    bv = parse(b);
  for (let i = 0; i < 3; i++)
    if (av.numbers[i] !== bv.numbers[i])
      return av.numbers[i] > bv.numbers[i] ? 1 : -1;
  if (!av.prerelease || !bv.prerelease)
    return av.prerelease ? -1 : bv.prerelease ? 1 : 0;
  for (
    let i = 0;
    i < Math.max(av.prerelease.length, bv.prerelease.length);
    i++
  ) {
    const left = av.prerelease[i],
      right = bv.prerelease[i];
    if (left === right) continue;
    if (left === undefined || right === undefined)
      return left === undefined ? -1 : 1;
    const ln = /^\d+$/.test(left),
      rn = /^\d+$/.test(right);
    if (ln && rn) return BigInt(left) > BigInt(right) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return left > right ? 1 : -1;
  }
  return 0;
}

export async function refreshCandidate(target, adapter) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await adapter.snapshot();
    if (snapshot.state === "closed") return { status: "closed" };
    if (target.prNumber && !sameRequest(target.request, snapshot.request))
      return { status: "superseded" };
    const p = target.request.client_payload;
    await adapter.verify(snapshot);
    if (p.version && isIndexedRelease(snapshot.entry, p.version))
      return { status: "indexed" };
    if (
      !p.version &&
      snapshot.entry?.source?.repository === p.repository &&
      snapshot.entry?.source?.packageName === p.package_name &&
      snapshot.entry?.source?.sourceCommit === p.source_commit
    )
      return { status: "indexed" };
    if (
      p.version &&
      snapshot.entry?.latestVersion &&
      compareVersions(p.version, snapshot.entry.latestVersion) < 0
    )
      throw new Error(
        "A newer plugin version is indexed; refusing to downgrade latestVersion.",
      );
    if (
      target.prNumber &&
      stableStringify(snapshot.entry, 0) !==
        stableStringify(snapshot.baseEntry, 0)
    )
      throw new Error(
        "The plugin curated entry changed on main; manual reconciliation required.",
      );
    if (target.dryRun) return { status: "verified" };
    const candidate = await adapter.build(snapshot);
    const latest = await adapter.snapshot();
    if (latest.state === "closed") return { status: "closed" };
    if (target.prNumber && !sameRequest(target.request, latest.request))
      return { status: "superseded" };
    if (
      latest.mainSha !== snapshot.mainSha ||
      latest.headSha !== snapshot.headSha
    )
      continue;
    try {
      await adapter.publish(candidate, latest);
      return { status: "updated" };
    } catch (error) {
      if (!(error instanceof LeaseConflict)) throw error;
    }
  }
  throw new Error("Registry branch kept changing; retry the refresh manually.");
}
