// render.mjs — render an audit as text or JSON. Pure, no I/O.

import { COMPLETENESS_NOT_CLAIMED, DUPLICATE_ABSENCE_NOT_CLAIMED, BOUNDARIES, HEADER_MEANING } from "./lib.mjs";

export const AUDIT_DISCLAIMER = [
  COMPLETENESS_NOT_CLAIMED,
  DUPLICATE_ABSENCE_NOT_CLAIMED,
  "A digest proves the RECORD is unchanged. It does not prove the RPC answers the same way today.",
  HEADER_MEANING,
];

export function renderAudit(audit) {
  const { header, coverage, digest } = audit;
  const L = [];
  L.push("=== PI EVENT INTEGRITY — coverage audit ===");
  L.push(`  endpoint:   ${header.endpoint}`);
  L.push(`  node:       ${header.nodeVersion ?? "(unknown)"}  protocol: ${header.protocolVersion ?? "(unknown)"}`);
  L.push(`  measured:   ${header.measuredAt ?? "(unknown)"}`);
  L.push(`  ledger:     oldest=${header.oldestLedger ?? "?"} latest=${header.latestLedger ?? "?"}`);
  L.push("");

  L.push("# Coverage");
  L.push(`  ledgers_requested: ${coverage.requestedSpan}`);
  L.push(`  ledgers_covered:   ${coverage.ledgersCovered}  (${coverage.ledgerCoveragePct}%)`);
  L.push(`  windows:           ${coverage.windows}  verified=${coverage.byState.verified} truncated=${coverage.byState.truncated} errored=${coverage.byState.errored} skipped=${coverage.byState.skipped}`);
  L.push(`  provable windows:  ${coverage.provableWindows}`);
  L.push(`  unprovable:        ${coverage.unprovableWindows}`);
  L.push("");

  if (coverage.allProvable) {
    L.push(`  events_found:      ${coverage.provableEvents}  (EXACT — every window is provable)`);
  } else {
    L.push(`  events_found:      >= ${coverage.provableEvents + coverage.truncatedEventsLowerBound}  (LOWER BOUND)`);
    L.push(`  provable events:   ${coverage.provableEvents}`);
    L.push(`  truncated events:  >= ${coverage.truncatedEventsLowerBound}`);
    L.push("");
    L.push(`  # Unverifiable regions (${coverage.unverifiableRegions.length})`);
    for (const r of coverage.unverifiableRegions) {
      L.push(`    [${r.start} .. ${r.end}]  span=${r.span}  state=${r.state}`);
    }
  }
  L.push("");

  // --- identity layer --------------------------------------------------------
  const id = audit.identity;
  if (id) {
    L.push("# Event identity");
    if (!id.idsAnalysed) {
      L.push("  (no event ids were recorded; duplicates and gaps are NOT evaluated)");
    } else {
      L.push(`  windows with ids:  ${id.windowsWithIds}`);
      L.push(`  ids examined:      ${id.idsExamined}`);
      L.push(`  id ordering ok:    ${id.ordering === null ? "(unknown)" : id.ordering ? "yes" : "NO — ids were out of order"}`);
      if (id.malformedIds.length) L.push(`  malformed ids:     ${id.malformedIds.length}`);
      L.push("");
      L.push(`  duplicates:        ${id.duplicates.state}  (repeated ids observed: ${id.duplicates.duplicateCount})`);
      if (id.duplicates.state === "unobservable") {
        L.push(`    ! ${id.duplicates.truncatedWindows} truncated window(s) cannot be completed, so a duplicate inside them cannot be observed.`);
      }
      for (const d of id.duplicates.duplicates) {
        L.push(`    DUP ${d.id}  seen ${d.count}x`);
      }
      L.push("");
      L.push(`  empty ledgers:     ${id.gaps.emptyLedgerCount}  (inside ${id.gaps.provableWindows} verified window(s))`);
      L.push(`  unproven windows:  ${id.gaps.unprovenWindows}  (ledgers inside them are NOT reported as gaps)`);
      L.push(`  scope:             ${id.scope}`);
    }
    L.push("");
  }

  // --- resume layer ----------------------------------------------------------
  if (audit.resume) {
    L.push("# Resume");
    if (!audit.resume.resumable) {
      L.push(`  resumable: no  (${audit.resume.reason})`);
    } else {
      L.push(`  next start ledger: ${audit.resume.nextStartLedger}`);
      L.push(`  last covered:      ${audit.resume.lastCoveredLedger}`);
      if (audit.resume.possible === false) {
        L.push(`  POSSIBLE: no — retention has passed the resume point.`);
        L.push(`  permanently lost:  ${audit.resume.lostFrom} .. ${audit.resume.lostTo}  (${audit.resume.lostLedgers} ledgers)`);
      } else if (audit.resume.possible === true) {
        L.push(`  possible: yes — the resume point is still inside retention.`);
      }
    }
    L.push("");
  }

  L.push("# Integrity digest");
  L.push(`  algorithm: ${digest.algorithm}`);
  L.push(`  sha256:    ${digest.sha256}`);
  L.push(`  bytes:     ${digest.canonicalBytes}`);
  L.push(`  spec:      ${digest.spec}`);
  L.push("");
  L.push("  -- DISCLAIMER --");
  for (const d of AUDIT_DISCLAIMER) L.push(`  - ${d}`);
  return L.join("\n");
}

export function renderBoundaries() {
  const L = ["=== BOUNDARIES — what this audit cannot do ==="];
  for (const b of BOUNDARIES) L.push(`  - ${b}`);
  L.push("");
  L.push(`  ${COMPLETENESS_NOT_CLAIMED}`);
  return L.join("\n");
}

export function toJSON(audit) {
  return JSON.stringify(
    {
      tool: "pi-event-integrity",
      mode: "audit",
      disclaimer: AUDIT_DISCLAIMER,
      header: audit.header,
      coverage: audit.coverage,
      identity: audit.identity,
      resume: audit.resume,
      digest: audit.digest,
      records: audit.records,
    },
    null,
    2
  );
}
