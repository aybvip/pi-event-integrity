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
export function buildAudit({ records, header, requestedSpan }) {
  const coverage = auditCoverage(records, requestedSpan);
  const digest = digestRecords(records);
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
    records,
    // A short human line: the digest and its scope together, always.
    label: `${DIGEST_SPEC.algorithm}:${digest.sha256.slice(0, 16)}…`,
  };
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
