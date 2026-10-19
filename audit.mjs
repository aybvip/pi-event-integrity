// audit.mjs — the integrity engine. Pure, offline, read-only.
//
// It takes window records and produces:
//   - a coverage audit (provable vs unprovable, kept apart)
//   - a content digest over the canonical record (tamper-evident, replayable)
//
// It never contacts the network. Hashing is local (node:crypto).

import { createHash } from "node:crypto";
import {
  auditCoverage,
  canonicalRecord,
  makeAuditHeader,
  DIGEST_SPEC,
  detectDuplicates,
  detectGaps,
  idsAreOrdered,
  parseEventId,
  resumePoint,
  resumeFeasibility,
  compareSources,
} from "./lib.mjs";

/** The sha256 content digest of the canonical window record. */
export function digestRecords(records) {
  const canonical = canonicalRecord(records);
  const sha256 = createHash("sha256").update(canonical, "utf8").digest("hex");
  return { sha256, canonical, bytes: Buffer.byteLength(canonical, "utf8") };
}

/**
 * Build a full independent audit from window records.
 * The result is self-contained: it carries the header, the coverage audit, the
 * digest, and the spec needed to recompute the digest by hand.
 */
export function buildAudit({ records, header, requestedSpan, retention = null }) {
  const coverage = auditCoverage(records, requestedSpan);
  const digest = digestRecords(records);

  // --- identity layer: only meaningful where the records carry event ids -----
  const identity = buildIdentityAnalysis(records);

  // --- resume layer: where would a stopped walk continue from? ---------------
  const resume = resumePoint(records);
  const feasibility = retention
    ? resumeFeasibility(resume, retention.oldest, retention.latest)
    : null;

  return {
    header: makeAuditHeader(header ?? {}),
    coverage,
    digest: {
      algorithm: DIGEST_SPEC.algorithm,
      encoding: DIGEST_SPEC.encoding,
      sha256: digest.sha256,
      canonicalBytes: digest.bytes,
      spec: DIGEST_SPEC.canonical,
    },
    identity,
    resume: feasibility ? { ...resume, ...feasibility } : resume,
    records,
    // A short human line: the digest and its scope together, always.
    label: `${DIGEST_SPEC.algorithm}:${digest.sha256.slice(0, 16)}…`,
  };
}

/**
 * The identity layer: duplicates, ledger gaps, and id ordering. Each part states
 * whether it could even be evaluated, and what its result is a bound on.
 */
export function buildIdentityAnalysis(records) {
  const withIds = records.filter((r) => Array.isArray(r.sampleIds) && r.sampleIds.length > 0);
  const allIds = withIds.flatMap((r) => r.sampleIds);
  const malformed = allIds.filter((id) => parseEventId(id) === null);

  // duplicates must be evaluated over the SAME window list, in order
  const duplicates = detectDuplicates(records);
  const gaps = detectGaps(records);

  return {
    // how much identity evidence exists at all
    windowsWithIds: withIds.length,
    idsExamined: allIds.length,
    idsAnalysed: withIds.length > 0,
    malformedIds: malformed,
    ordering: withIds.length > 0 ? idsAreOrdered(allIds) : null,
    duplicates,
    gaps,
    // the honest label for the whole layer
    scope:
      withIds.length === 0
        ? "no event ids were recorded, so no statement about duplicates or gaps is possible"
        : `${withIds.length} window(s) carried event ids; the identity findings below cover only those windows`,
  };
}

/**
 * Compare this audit against another source over the same ledger range. Both
 * arguments are audits (or their {header, records} shape).
 */
export function buildSourceComparison(a, b) {
  return compareSources(a, b);
}

/**
 * Verify a record against a claimed digest. Returns whether it matches, and —
 * crucially — whether the comparison is even MEANINGFUL. A digest from a
 * different endpoint or node version is not comparable and is reported as such,
 * never as a mismatch.
 */
export function verifyDigest(claimed, records, { claimedHeader, liveHeader } = {}) {
  const actual = digestRecords(records).sha256;
  const recomputed = actual === claimed;

  let comparable = true;
  const reasons = [];
  if (claimedHeader && liveHeader) {
    if (claimedHeader.endpoint !== liveHeader.endpoint) {
      comparable = false;
      reasons.push(`endpoint differs: claimed ${claimedHeader.endpoint}, live ${liveHeader.endpoint}`);
    }
    if (String(claimedHeader.nodeVersion) !== String(liveHeader.nodeVersion)) {
      comparable = false;
      reasons.push(`node version differs: claimed ${claimedHeader.nodeVersion}, live ${liveHeader.nodeVersion}`);
    }
    if (String(claimedHeader.protocolVersion) !== String(liveHeader.protocolVersion)) {
      comparable = false;
      reasons.push(`protocol version differs: claimed ${claimedHeader.protocolVersion}, live ${liveHeader.protocolVersion}`);
    }
  }

  return { recomputed, comparable, reasons, actual, claimed };
}

/** A verify verdict a CI job can branch on. */
export function verifyVerdict(result) {
  if (!result.comparable) return "not-comparable";
  return result.recomputed ? "match" : "mismatch";
}
