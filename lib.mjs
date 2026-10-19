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
  "no duplicates exist",
  "proves no duplicates",
  "no events are missing",
  "Pi approved",
  "we are first",
];

/** The single most important non-claim in this repository. */
export const COMPLETENESS_NOT_CLAIMED =
  "This repository does not claim that an event set is complete. It reports COVERAGE of ledger ranges and marks every window whose event count is a lower bound. \"All events\" is never a conclusion here.";

/** The second most important non-claim: absence of a duplicate is a lower bound. */
export const DUPLICATE_ABSENCE_NOT_CLAIMED =
  "This repository does not claim that a duplicate does not exist. It reports whether a repeated event id was OBSERVED in the windows examined, and states that a duplicate inside a truncated window cannot be observed at all.";

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
// 3b. Event identity — the measured shape getEvents actually returns
// ---------------------------------------------------------------------------
//
// Measured on 2026-10-19 against rpc.testnet.minepi.com (protocol 28). Every
// event carries a globally ordered `id` of the form `{TOID}-{index}`:
//
//   0117041702811729920-0000000000
//   └────── TOID ──────┘ └ index ┘
//
// The TOID (Total Order ID) is a monotonically increasing integer; the index is
// the event's position inside its transaction. Measured properties:
//
//   - TOID is monotonic non-decreasing across a page (100/100 distinct ids);
//   - an exact duplicate id never appears twice in one response;
//   - overlapping windows return DISJOINT pages (measured: two windows sharing
//     50 ledgers returned 0 shared ids), because endLedger is exclusive and the
//     page restarts from the window start;
//   - a full page embeds events from only a few ledgers (measured: 100 events
//     spanned 17 ledgers), and the ledgers inside that span are NOT contiguous
//     (measured: 3 ledgers with no events inside a 17-ledger page).
//
// This is what makes duplicate detection and gap detection possible: there is an
// ordering key, and its absence across a range is meaningful only when compared
// against the covered ledger span.

/** The measured id format of an event. */
export const EVENT_ID_FORMAT = "{TOID}-{index}";

/** Fields the audit reads from an event. Nothing else is interpreted. */
export const EVENT_FIELDS_READ = ["id", "ledger", "ledgerClosedAt", "txHash", "transactionIndex", "operationIndex"];

/** Fields deliberately NOT interpreted. */
export const EVENT_FIELDS_NOT_INTERPRETED = ["topic", "value", "contractId", "type", "inSuccessfulContractCall"];

/**
 * Split an event id into its TOID and index. Returns null for a shape that does
 * not match, so an unexpected format is reported rather than mis-parsed.
 */
export function parseEventId(id) {
  if (typeof id !== "string") return null;
  const m = /^(\d+)-(\d+)$/.exec(id);
  if (!m) return null;
  return { toid: BigInt(m[1]), index: Number(m[2]), raw: id };
}

/** True when a page's ids are in non-decreasing TOID order. */
export function idsAreOrdered(ids) {
  let prev = null;
  for (const id of ids) {
    const p = parseEventId(id);
    if (!p) return false;
    if (prev !== null && p.toid < prev) return false;
    prev = p.toid;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 3c. Duplicate detection
// ---------------------------------------------------------------------------
//
// A duplicate is the SAME event id seen in more than one window, or twice inside
// one window. Because overlapping windows were measured to return disjoint
// pages, a duplicate is an anomaly worth reporting — not an expected artefact.
//
// Crucially, "no duplicate found" is NOT the same as "no duplicate exists": a
// duplicate inside a truncated window cannot be seen, because that window's page
// restarts and never reaches the repeated event. The audit says so.

export const DUPLICATE_STATES = {
  none: { id: "none", meaning: "no repeated event id was observed in the records examined" },
  exact: { id: "exact", meaning: "the same event id appeared more than once, in one window or across windows" },
  unobservable: { id: "unobservable", meaning: "at least one window was truncated, so a duplicate inside it could not be observed" },
};

/**
 * Detect repeated event ids across a set of window records that carry sample ids.
 * `records` items may have `sampleIds: string[]`.
 */
export function detectDuplicates(records) {
  const seenAt = new Map(); // id -> [{windowIndex, start, end}]
  const truncatedWindows = [];

  records.forEach((r, i) => {
    if (r.state === "truncated") truncatedWindows.push(i);
    for (const id of r.sampleIds ?? []) {
      if (!seenAt.has(id)) seenAt.set(id, []);
      seenAt.get(id).push({ windowIndex: i, start: r.start, end: r.end });
    }
  });

  const duplicates = [];
  for (const [id, places] of seenAt) {
    if (places.length > 1) duplicates.push({ id, count: places.length, places });
  }

  const state = duplicates.length > 0 ? "exact" : truncatedWindows.length > 0 ? "unobservable" : "none";
  return {
    state,
    duplicateCount: duplicates.length,
    duplicates,
    truncatedWindows: truncatedWindows.length,
    idsExamined: [...seenAt.keys()].length,
    caveat:
      state === "unobservable"
        ? "A truncated window cannot be completed, so a duplicate inside it cannot be observed. This is a lower bound, not a proof of absence."
        : state === "none"
          ? "No repeated id was observed across the windows examined."
          : "Repeated ids were observed; each is listed with the windows it appeared in.",
  };
}

// ---------------------------------------------------------------------------
// 3d. Gap detection
// ---------------------------------------------------------------------------
//
// Two kinds of gap, and they must never be conflated:
//
//   gap        a ledger inside a COVERED span produced no events. This is
//              legitimate — measured: several ledgers inside a 17-ledger page
//              carried no events. It is information, not an error.
//   unproven   a ledger inside a TRUNCATED window. Nothing is known about it;
//              it is not a gap and must not be reported as one.
//
// Only `verified` windows can support a statement about gaps. A truncated window
// cannot, because its page was cut.

export const GAP_KINDS = {
  empty: { id: "empty", meaning: "a ledger inside a verified window returned no events (legitimate; measured)" },
  unproven: { id: "unproven", meaning: "a ledger inside a truncated/errored/skipped window; nothing is known" },
};

/** Compare the ledgers actually seen in a window against the window's span. */
export function ledgerGapsInWindow(record) {
  if (record.state !== "verified") {
    return {
      kind: GAP_KINDS.unproven.id,
      provable: false,
      reason: "the window is not verified, so no statement about its ledgers is possible",
    };
  }
  const seen = [...new Set(record.sampleLedgers ?? [])].sort((a, b) => a - b);
  const span = [];
  for (let L = record.start; L <= record.end; L++) span.push(L);
  const seenSet = new Set(seen);
  const empty = span.filter((L) => !seenSet.has(L));
  return { kind: GAP_KINDS.empty.id, provable: true, emptyLedgers: empty, emptyCount: empty.length, spanCount: span.length };
}

/** Gap summary across all records. */
export function detectGaps(records) {
  const emptyLedgers = [];
  let unprovenWindows = 0;
  let provenSpans = 0;
  for (const r of records) {
    const g = ledgerGapsInWindow(r);
    if (!g.provable) { unprovenWindows++; continue; }
    provenSpans++;
    for (const L of g.emptyLedgers) emptyLedgers.push(L);
  }
  return {
    provableWindows: provenSpans,
    unprovenWindows,
    emptyLedgerCount: emptyLedgers.length,
    emptyLedgers,
    note: "An empty ledger is a legitimate observation, not an error. A ledger inside an unproven window is NOT reported as empty.",
  };
}

// ---------------------------------------------------------------------------
// 3e. Resume — continue indexing from a recorded point
// ---------------------------------------------------------------------------
//
// A record can be resumed from the highest ledger it actually covered. The
// resume point is the exclusive end of the last provable window. Anything that
// fell outside retention while the walk was stopped cannot be resumed and is
// reported as a permanent hole.

export function resumePoint(records) {
  const provable = records
    .filter((r) => r.state === "verified" || r.state === "truncated")
    .sort((a, b) => a.end - b.end);
  if (provable.length === 0) return { resumable: false, nextStartLedger: null, reason: "no window covered any ledger" };
  const last = provable[provable.length - 1];
  return {
    resumable: true,
    nextStartLedger: last.end + 1,
    lastCoveredLedger: last.end,
    reason: "resume at the ledger after the last covered window",
  };
}

/**
 * Given a resume point and the current retention window, report whether the
 * resume is possible at all, and which ledgers were permanently lost.
 */
export function resumeFeasibility(resume, oldest, latest) {
  if (!resume.resumable) return { possible: false, lostFrom: null, lostTo: null, reason: resume.reason };
  if (resume.nextStartLedger < oldest) {
    return {
      possible: false,
      lostFrom: resume.nextStartLedger,
      lostTo: oldest - 1,
      lostLedgers: oldest - resume.nextStartLedger,
      reason: "retention has passed the resume point; the ledgers in between are permanently unqueryable",
    };
  }
  return {
    possible: true,
    lostFrom: null,
    lostTo: null,
    lostLedgers: 0,
    nextStartLedger: resume.nextStartLedger,
    reason: "the resume point is still inside retention",
  };
}

// ---------------------------------------------------------------------------
// 3f. Independent-source comparison
// ---------------------------------------------------------------------------
//
// The audit can compare two records of the SAME ledger range taken against
// different endpoints (or the same endpoint at different times). Comparison is
// only meaningful when the ranges and the compared ledgers overlap; anything
// else is reported as not-comparable, never as agreement or disagreement.

export const SOURCE_COMPARISON_VERDICTS = {
  agree: { id: "agree", meaning: "every overlapping ledger had the same event count in both sources" },
  disagree: { id: "disagree", meaning: "at least one overlapping ledger had a different event count" },
  "not-comparable": { id: "not-comparable", meaning: "the two records do not share a comparable ledger range or version" },
};

export function compareSources(a, b) {
  if (!a?.records || !b?.records) {
    return { verdict: "not-comparable", reason: "both sources must carry records", overlaps: [] };
  }
  if (a.header && b.header) {
    // A comparison is version-scoped. Any difference in node or protocol version
    // makes the two records not comparable, regardless of endpoint.
    if (a.header.nodeVersion && b.header.nodeVersion && String(a.header.nodeVersion) !== String(b.header.nodeVersion)) {
      return { verdict: "not-comparable", reason: `node versions differ (${a.header.nodeVersion} vs ${b.header.nodeVersion})`, overlaps: [] };
    }
    if (a.header.protocolVersion && b.header.protocolVersion && String(a.header.protocolVersion) !== String(b.header.protocolVersion)) {
      return { verdict: "not-comparable", reason: `protocol versions differ (${a.header.protocolVersion} vs ${b.header.protocolVersion})`, overlaps: [] };
    }
  }
  // Compare verified windows only, and only where ledger ranges intersect.
  const overlaps = [];
  for (const ra of a.records.filter((r) => r.state === "verified")) {
    for (const rb of b.records.filter((r) => r.state === "verified")) {
      const lo = Math.max(ra.start, rb.start);
      const hi = Math.min(ra.end, rb.end);
      if (hi < lo) continue;
      overlaps.push({ from: lo, to: hi, aCount: ra.eventCount, bCount: rb.eventCount, same: ra.eventCount === rb.eventCount });
    }
  }
  if (overlaps.length === 0) {
    return { verdict: "not-comparable", reason: "no verified ledger range is shared by both sources", overlaps: [] };
  }
  const disagree = overlaps.filter((o) => !o.same);
  return {
    verdict: disagree.length ? "disagree" : "agree",
    comparedRanges: overlaps.length,
    disagreements: disagree,
    overlaps,
    note: "Only verified windows are compared. A truncated window cannot be compared, because its count is a lower bound.",
  };
}


// ---------------------------------------------------------------------------
// 3. The audit record — what a window contributes
// ---------------------------------------------------------------------------
//
// Each record names the exact ledger range and the exact RPC request that was
// sent, so a reader can replay it. `endLedger` is recorded as the INCLUSIVE end
// plus the EXCLUSIVE value actually sent, because that distinction is a measured
// footgun (see pi-soroban-events).

export function makeWindowRecord({ start, end, state, eventCount, request, error = null, sampleIds = null, sampleLedgers = null }) {
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
    // optional identity evidence: the event ids and ledgers actually seen. Kept
    // OUT of the digest's canonical line on purpose (see DIGEST-SPEC): the digest
    // covers the coverage record, and identity evidence is reported separately so
    // the two can be verified independently.
    sampleIds: sampleIds ?? null,
    sampleLedgers: sampleLedgers ?? null,
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
  "It does not claim a duplicate does not exist; it reports whether one was OBSERVED, and a duplicate inside a truncated window cannot be observed.",
  "It does not report an empty ledger as a gap when the window is unproven; an empty verified ledger is a legitimate observation, not an error.",
  "It does not re-execute the walk to verify a digest; the digest proves the RECORD is unchanged, not that the RPC still answers the same way.",
  "It does not interpret event contents; it counts, identity-groups and hashes.",
  "It does not compare event BYTES between sources, only the counts of overlapping verified ledgers.",
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
  // Extension fixtures — identity, gaps and duplicates.
  "page-with-distinct-ids": {
    start: 100, end: 109, state: "verified", eventCount: 4, request: {},
    sampleIds: ["0117000000000000001-0000000000", "0117000000000000001-0000000001", "0117000000000000002-0000000000", "0117000000000000002-0000000001"],
    sampleLedgers: [100, 100, 102, 102],
  },
  "page-with-duplicate-id": {
    start: 100, end: 109, state: "verified", eventCount: 4, request: {},
    sampleIds: ["0117000000000000001-0000000000", "0117000000000000001-0000000000", "0117000000000000002-0000000000", "0117000000000000002-0000000001"],
    sampleLedgers: [100, 100, 102, 102],
  },
  "page-with-ledgers-empty": {
    start: 100, end: 104, state: "verified", eventCount: 2, request: {},
    sampleIds: ["0117000000000000001-0000000000", "0117000000000000001-0000000001"],
    sampleLedgers: [100, 100],
  },
};

export const FIXTURE_NOTE =
  "Fixtures are synthetic window records written for this test suite. They contain no real ledger data and no personal data. The TOID prefixes are placeholders and are not real ledger identifiers.";
