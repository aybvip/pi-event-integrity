// lib.mjs — the coverage-audit model, as pure data.
//
// This repository EXTENDS pi-soroban-events. The walker there measures what the
// RPC returns; this repository asks a different question:
//
//   "Given a set of windows and their event counts, what CAN be proven about
//    coverage — and what must be reported as NOT verifiable?"
//
// Every rule below is either:
//   - MEASURED  (reproduced by a command here, against the RPC, right now), or
//   - DOCUMENTED (the RPC semantics recorded by pi-soroban-events), or
//   - not-claimed (out of scope).
//
// No writes, no keys, no signing. The integrity proof is a CONTENT DIGEST over
// the audit record itself, so a third party can detect any later edit.

// ---------------------------------------------------------------------------
// 1. Claim kinds and forbidden claims — the honesty contract
// ---------------------------------------------------------------------------
export const CLAIM_KINDS = [
  { id: "measured", meaning: "reproduced by a command in this repo against rpc.testnet.minepi.com right now" },
  { id: "documented", meaning: "the RPC semantics recorded in pi-soroban-events and re-checked here" },
  { id: "derived", meaning: "a mechanical consequence of a measured fact, stated as derived" },
  { id: "not-claimed", meaning: "out of scope: event contents, completeness of the event set, anything about Mainnet" },
];

/** Phrases that must never be asserted. */
export const FORBIDDEN_CLAIMS = [
  "all events were found",
  "complete event set",
  "no events were missed",
  "events_found is the total",
  "proves nothing was missed",
  "guarantees coverage",
  "Pi approved",
  "we are first",
];

/** The single most important non-claim in this repository. */
export const COMPLETENESS_NOT_CLAIMED =
  "This repository does not claim that an event set is complete. It reports COVERAGE of ledger ranges and marks every window whose event count is a lower bound. \"All events\" is never a conclusion here.";

// ---------------------------------------------------------------------------
// 2. Window integrity states — the heart of the audit
// ---------------------------------------------------------------------------
//
// A window is one of four things, and they must never be conflated:
//
//   verified   the window was queried and returned FEWER than the observed cap,
//              so its event count is exact for that ledger range.
//   truncated  the window returned EXACTLY the observed cap, and the RPC's
//              cursor is not honoured, so the count is a LOWER BOUND and the
//              window is NOT fully verifiable.
//   errored    the RPC returned an error for the window; nothing is known about it.
//   skipped    the window fell outside retention and was not queried.
//
// Only `verified` windows contribute a provable event count. Everything else is
// reported, never silently folded into a total.
export const WINDOW_STATES = {
  verified: {
    id: "verified",
    provable: true,
    meaning: "queried, returned FEWER than the observed cap, so the count is exact for this range",
  },
  truncated: {
    id: "truncated",
    provable: false,
    meaning: "queried, returned EXACTLY the observed cap; the cursor is not honoured, so the count is a LOWER BOUND",
  },
  errored: {
    id: "errored",
    provable: false,
    meaning: "the RPC returned an error; nothing is known about this window",
  },
  skipped: {
    id: "skipped",
    provable: false,
    meaning: "the window fell outside retention and was never queried",
  },
};

/** States that cannot contribute a provable event count. */
export const UNPROVABLE_STATES = Object.values(WINDOW_STATES).filter((s) => !s.provable).map((s) => s.id);

/** Measured retention window (re-checked live by --from/--to runs). */
export const RETENTION_LEDGERS = 120960;

/** Observed hard cap on events per getEvents response (re-measured periodically). */
export const PAGE_CAP_RETAINED = 100;

// ---------------------------------------------------------------------------
// 3. The audit record — what a window contributes
// ---------------------------------------------------------------------------
//
// Each record names the exact ledger range and the exact RPC request that was
// sent, so a reader can replay it. `endLedger` is recorded as the INCLUSIVE end
// plus the EXCLUSIVE value actually sent, because that distinction is a measured
// footgun (see pi-soroban-events).

export function makeWindowRecord({ start, end, state, eventCount, request, error = null }) {
  const st = WINDOW_STATES[state];
  if (!st) throw new Error(`unknown window state: ${state}`);
  return {
    start,
    end,
    span: end - start + 1,
    state,
    provable: st.provable,
    eventCount: state === "errored" || state === "skipped" ? null : eventCount,
    // the exact request sent, so a reader can replay it byte-for-byte
    request: {
      method: "getEvents",
      startLedger: request?.startLedger ?? start,
      // recorded because endLedger is EXCLUSIVE on this RPC: the walker sends end+1
      endLedgerExclusive: request?.endLedgerExclusive ?? end + 1,
      limit: request?.limit ?? null,
      filters: request?.filters ?? [],
    },
    error: error ?? null,
  };
}

// ---------------------------------------------------------------------------
// 4. Coverage arithmetic — provable vs unprovable, kept apart
// ---------------------------------------------------------------------------
//
// The central honesty operation: a total is only "provable" if EVERY window is
// provable. If any window is truncated/errored/skipped, the total is a lower
// bound and is labelled so.

export function windowStateOf(count, cap) {
  // A window that returned exactly the cap is truncated: the RPC ignores `limit`
  // and does not honour its cursor (measured in pi-soroban-events).
  return count >= cap ? "truncated" : "verified";
}

export function auditCoverage(records, requestedSpan) {
  const ledgersCovered = records
    .filter((r) => r.state === "verified" || r.state === "truncated")
    .reduce((n, r) => n + r.span, 0);

  const byState = { verified: 0, truncated: 0, errored: 0, skipped: 0 };
  for (const r of records) byState[r.state]++;

  const provableEvents = records
    .filter((r) => r.state === "verified")
    .reduce((n, r) => n + (r.eventCount ?? 0), 0);

  const lowerBoundEvents = records
    .filter((r) => r.state === "truncated")
    .reduce((n, r) => n + (r.eventCount ?? 0), 0);

  const unprovableWindows = records.filter((r) => !r.provable).length;
  const allProvable = unprovableWindows === 0;

  const pct = requestedSpan > 0 ? Math.round((ledgersCovered / requestedSpan) * 1000) / 10 : 0;

  return {
    requestedSpan,
    ledgersCovered,
    ledgerCoveragePct: pct,
    windows: records.length,
    byState,
    provableWindows: records.filter((r) => r.provable).length,
    unprovableWindows,
    // events: exact only when allProvable; otherwise the truncated part is a floor
    provableEvents,
    truncatedEventsLowerBound: lowerBoundEvents,
    eventsIsLowerBound: !allProvable,
    // the region that cannot be verified, stated as data
    unverifiableRegions: records
      .filter((r) => !r.provable)
      .map((r) => ({ start: r.start, end: r.end, span: r.span, state: r.state })),
    allProvable,
  };
}

// ---------------------------------------------------------------------------
// 5. The integrity digest — replayable, and tamper-evident
// ---------------------------------------------------------------------------
//
// The digest is over a CANONICAL byte string, so two runs of the same set of
// windows produce the same digest, and any later edit to the record changes it.
// The canonical string is fully specified here so it can be reimplemented.

export const DIGEST_SPEC = {
  algorithm: "sha256",
  encoding: "hex",
  canonical: "one line per window: '{start}-{end}|{state}|{eventCountOrNull}|{method}|{startLedger}|{endLedgerExclusive}|{limit}', lines joined by '\\n', no trailing newline",
  scope: "the window records only; the header carries the endpoint, node version and protocol version so a digest is always read in context",
};

export function canonicalWindowLine(r) {
  const count = r.eventCount === null ? "null" : String(r.eventCount);
  return [
    `${r.start}-${r.end}`,
    r.state,
    count,
    r.request.method,
    r.request.startLedger,
    r.request.endLedgerExclusive,
    r.request.limit === null ? "null" : String(r.request.limit),
  ].join("|");
}

export function canonicalRecord(records) {
  return records.map(canonicalWindowLine).join("\n");
}

/**
 * The header a digest is always read with. Endpoint + node version + protocol
 * version, so a digest is version-scoped and never "true in general".
 */
export function makeAuditHeader({ endpoint, nodeVersion, protocolVersion, latestLedger, oldestLedger, measuredAt }) {
  return {
    endpoint,
    nodeVersion: nodeVersion ?? null,
    protocolVersion: protocolVersion ?? null,
    latestLedger: latestLedger ?? null,
    oldestLedger: oldestLedger ?? null,
    measuredAt: measuredAt ?? null,
  };
}

export const HEADER_MEANING =
  "A digest is meaningful only with its header. A digest without the endpoint and the node/protocol version cannot be compared to another run.";

// ---------------------------------------------------------------------------
// 6. Boundaries
// ---------------------------------------------------------------------------
export const BOUNDARIES = [
  "It does not claim an event set is complete; it reports coverage and marks every lower bound.",
  "It does not re-execute the walk to verify a digest; the digest proves the RECORD is unchanged, not that the RPC still answers the same way.",
  "It does not interpret event contents; it counts and hashes.",
  "It does not work against Mainnet: no public Soroban RPC exists there (measured; HTTP 503).",
  "It does not store events; it stores window records and their counts.",
  "It does not sign anything with a key; the digest is content-addressed, not identity-attested.",
];

// ---------------------------------------------------------------------------
// 7. Synthetic fixtures
// ---------------------------------------------------------------------------
export const FIXTURES = {
  "one-verified-window": { start: 100, end: 199, state: "verified", eventCount: 3, request: {} },
  "one-truncated-window": { start: 100, end: 199, state: "truncated", eventCount: 100, request: {} },
  "one-errored-window": { start: 100, end: 199, state: "errored", eventCount: 0, request: {} },
  "one-skipped-window": { start: 100, end: 199, state: "skipped", eventCount: 0, request: {} },
};

export const FIXTURE_NOTE =
  "Fixtures are synthetic window records written for this test suite. They contain no real ledger data and no personal data.";
