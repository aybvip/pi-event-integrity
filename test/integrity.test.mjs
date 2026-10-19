// test/integrity.test.mjs — offline invariants for pi-event-integrity.
// No network. No personal data. No writes.

import {
  CLAIM_KINDS, FORBIDDEN_CLAIMS, COMPLETENESS_NOT_CLAIMED, DUPLICATE_ABSENCE_NOT_CLAIMED, WINDOW_STATES, UNPROVABLE_STATES,
  makeWindowRecord, windowStateOf, auditCoverage, DIGEST_SPEC, canonicalWindowLine,
  canonicalRecord, makeAuditHeader, HEADER_MEANING, BOUNDARIES, FIXTURES, FIXTURE_NOTE,
  RETENTION_LEDGERS, PAGE_CAP_RETAINED,
  EVENT_ID_FORMAT, EVENT_FIELDS_READ, EVENT_FIELDS_NOT_INTERPRETED, parseEventId, idsAreOrdered,
  DUPLICATE_STATES, detectDuplicates, GAP_KINDS, ledgerGapsInWindow, detectGaps,
  resumePoint, resumeFeasibility, SOURCE_COMPARISON_VERDICTS, compareSources,
} from "../lib.mjs";
import { digestRecords, buildAudit, verifyDigest, verifyVerdict, buildIdentityAnalysis, buildSourceComparison } from "../audit.mjs";
import { renderAudit, renderBoundaries, toJSON, AUDIT_DISCLAIMER } from "../render.mjs";
import { splitWindows, coveredLedgers, coveragePct, windowsAreSane, clampRange, isTruncated, PAGE_CAP } from "../windows.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) { if (cond) { pass++; return; } fail++; failures.push(label); }
function eq(a, b, label) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A === B) { pass++; return; }
  fail++; failures.push(`${label}\n    expected: ${B}\n    actual:   ${A}`);
}

// --- claim discipline --------------------------------------------------------
eq(CLAIM_KINDS.map((c) => c.id), ["measured", "documented", "derived", "not-claimed"], "four claim kinds");
ok(FORBIDDEN_CLAIMS.some((f) => /all events/i.test(f)), "forbids claiming all events were found");
ok(FORBIDDEN_CLAIMS.some((f) => /complete event set/i.test(f)), "forbids claiming a complete event set");
ok(FORBIDDEN_CLAIMS.some((f) => /nothing was missed/i.test(f)), "forbids claiming nothing was missed");
ok(FORBIDDEN_CLAIMS.some((f) => /Pi approved/i.test(f)), "forbids claiming Pi approval");
ok(/does not claim that an event set is complete/i.test(COMPLETENESS_NOT_CLAIMED),
  "the completeness non-claim is stated verbatim");

// --- window states -----------------------------------------------------------
eq(Object.keys(WINDOW_STATES).sort(), ["errored", "skipped", "truncated", "verified"].sort(), "four window states");
ok(WINDOW_STATES.verified.provable === true, "only 'verified' is provable");
for (const s of ["truncated", "errored", "skipped"]) ok(WINDOW_STATES[s].provable === false, `${s} is not provable`);
eq(UNPROVABLE_STATES.sort(), ["errored", "skipped", "truncated"].sort(), "three unprovable states");

// --- windowStateOf: the cap boundary -----------------------------------------
eq(windowStateOf(99, 100), "verified", "99 events is verified");
eq(windowStateOf(100, 100), "truncated", "exactly the cap is truncated");
eq(windowStateOf(0, 100), "verified", "zero events is verified (not truncated)");

// --- makeWindowRecord --------------------------------------------------------
const vr = makeWindowRecord({ start: 100, end: 199, state: "verified", eventCount: 3, request: {} });
eq(vr.span, 100, "record computes the span");
eq(vr.request.endLedgerExclusive, 200, "record records the EXCLUSIVE end (end+1)");
eq(vr.provable, true, "verified record is provable");
const tr = makeWindowRecord({ start: 100, end: 199, state: "truncated", eventCount: 100, request: {} });
eq(tr.provable, false, "truncated record is not provable");
const er = makeWindowRecord({ start: 100, end: 199, state: "errored", eventCount: null, request: {}, error: "boom" });
eq(er.eventCount, null, "errored record has a null count");
eq(er.error, "boom", "errored record keeps the error");
let threw = false;
try { makeWindowRecord({ start: 1, end: 2, state: "nonsense", eventCount: 0, request: {} }); } catch { threw = true; }
ok(threw, "an unknown window state throws");

// --- auditCoverage: the central honesty operation ----------------------------
const allVerified = [
  makeWindowRecord({ start: 1, end: 100, state: "verified", eventCount: 3, request: {} }),
  makeWindowRecord({ start: 101, end: 200, state: "verified", eventCount: 5, request: {} }),
];
const covA = auditCoverage(allVerified, 200);
eq(covA.provableEvents, 8, "all-verified provable events sum exactly");
eq(covA.eventsIsLowerBound, false, "all-verified is not a lower bound");
eq(covA.allProvable, true, "all-verified is fully provable");
eq(covA.ledgersCovered, 200, "coverage counts verified windows");
eq(covA.ledgerCoveragePct, 100, "coverage is 100%");

const mixed = [
  makeWindowRecord({ start: 1, end: 100, state: "verified", eventCount: 3, request: {} }),
  makeWindowRecord({ start: 101, end: 200, state: "truncated", eventCount: 100, request: {} }),
];
const covB = auditCoverage(mixed, 200);
eq(covB.eventsIsLowerBound, true, "any truncated window makes the total a lower bound");
eq(covB.allProvable, false, "one truncated window makes the set unprovable");
eq(covB.provableEvents, 3, "only verified events are provable");
eq(covB.truncatedEventsLowerBound, 100, "truncated events are a separate lower bound");
eq(covB.unverifiableRegions.length, 1, "the truncated region is listed");
eq(covB.unverifiableRegions[0].state, "truncated", "the region names its state");

const withSkip = [
  makeWindowRecord({ start: 1, end: 100, state: "verified", eventCount: 3, request: {} }),
  makeWindowRecord({ start: 101, end: 200, state: "skipped", eventCount: null, request: {} }),
];
const covC = auditCoverage(withSkip, 200);
eq(covC.ledgersCovered, 100, "skipped windows do not count toward ledger coverage");
eq(covC.ledgerCoveragePct, 50, "coverage reflects the skipped window");
eq(covC.unprovableWindows, 1, "skipped windows are unprovable");

const empty = auditCoverage([], 0);
eq(empty.ledgerCoveragePct, 0, "empty audit has zero coverage");

// --- digest: deterministic, canonical, tamper-evident ------------------------
const d1 = digestRecords(allVerified);
const d2 = digestRecords(allVerified);
eq(d1.sha256, d2.sha256, "the same records produce the same digest");
ok(/^[0-9a-f]{64}$/.test(d1.sha256), "the digest is a 64-char hex sha256");
eq(DIGEST_SPEC.algorithm, "sha256", "the digest algorithm is sha256");
ok(d1.canonical.includes("1-100|verified|3|getEvents|1|101|"), "the canonical line has the documented shape");
eq(canonicalWindowLine(allVerified[0]), "1-100|verified|3|getEvents|1|101|null", "canonical line is exact");
eq(canonicalRecord(allVerified), "1-100|verified|3|getEvents|1|101|null\n101-200|verified|5|getEvents|101|201|null",
  "canonical record joins lines with \\n and no trailing newline");

// a change to ANY field changes the digest
const edited = [
  makeWindowRecord({ start: 1, end: 100, state: "verified", eventCount: 4, request: {} }),
  allVerified[1],
];
ok(digestRecords(edited).sha256 !== d1.sha256, "changing an event count changes the digest");
const reordered = [allVerified[1], allVerified[0]];
ok(digestRecords(reordered).sha256 !== d1.sha256, "reordering windows changes the digest");
const truncatedEdited = [
  allVerified[0],
  makeWindowRecord({ start: 101, end: 200, state: "truncated", eventCount: 5, request: {} }),
];
ok(digestRecords(truncatedEdited).sha256 !== d1.sha256, "changing a window state changes the digest");

// --- header: a digest is always scoped ---------------------------------------
const h = makeAuditHeader({ endpoint: "https://rpc.testnet.minepi.com", nodeVersion: "28.0.1", protocolVersion: 28, latestLedger: 10, oldestLedger: 1, measuredAt: "2026-10-19" });
eq(h.endpoint, "https://rpc.testnet.minepi.com", "header carries the endpoint");
eq(h.nodeVersion, "28.0.1", "header carries the node version");
eq(h.protocolVersion, 28, "header carries the protocol version");
ok(/without the endpoint/i.test(HEADER_MEANING), "the header meaning states a digest needs its scope");

// --- buildAudit --------------------------------------------------------------
const audit = buildAudit({ records: allVerified, requestedSpan: 200, header: { endpoint: "https://rpc.testnet.minepi.com", nodeVersion: "28.0.1", protocolVersion: 28, measuredAt: "2026-10-19" } });
eq(audit.coverage.provableEvents, 8, "buildAudit carries the coverage audit");
eq(audit.digest.sha256, d1.sha256, "buildAudit carries the correct digest");
eq(audit.header.nodeVersion, "28.0.1", "buildAudit carries the header");
ok(audit.label.startsWith("sha256:"), "the label names the algorithm");

// --- verifyDigest: match, mismatch, and NOT-COMPARABLE -----------------------
const vMatch = verifyDigest(d1.sha256, allVerified, { claimedHeader: audit.header, liveHeader: audit.header });
eq(verifyVerdict(vMatch), "match", "identical records and header verify as match");
const vMismatch = verifyDigest("0".repeat(64), allVerified, { claimedHeader: audit.header, liveHeader: audit.header });
eq(verifyVerdict(vMismatch), "mismatch", "a wrong digest verifies as mismatch");
const vIncomparable = verifyDigest(d1.sha256, allVerified, {
  claimedHeader: audit.header,
  liveHeader: { ...audit.header, nodeVersion: "29.0.0" },
});
eq(verifyVerdict(vIncomparable), "not-comparable", "a version change is NOT comparable, not a mismatch");
ok(vIncomparable.reasons.some((r) => /node version differs/.test(r)), "the incomparability reason is stated");
const vEndpoint = verifyDigest(d1.sha256, allVerified, {
  claimedHeader: audit.header,
  liveHeader: { ...audit.header, endpoint: "https://other" },
});
eq(verifyVerdict(vEndpoint), "not-comparable", "a different endpoint is NOT comparable");

// --- rendering keeps the non-claims attached ---------------------------------
const text = renderAudit(audit);
ok(/LOWER BOUND|EXACT/.test(text), "the rendered audit labels the event total");
ok(/Integrity digest/.test(text), "the rendered audit shows the digest");
ok(/sha256/.test(text), "the rendered audit names the algorithm");
ok(/does not claim that an event set is complete/i.test(text), "the rendered audit carries the completeness non-claim");
ok(/does not prove the RPC answers the same way/i.test(text), "the rendered audit states the digest's limit");
const lowerText = renderAudit(buildAudit({ records: mixed, requestedSpan: 200, header: { endpoint: "x" } }));
ok(/LOWER BOUND/.test(lowerText), "a truncated audit renders as LOWER BOUND");
ok(/Unverifiable regions/.test(lowerText), "a truncated audit lists the unverifiable regions");
eq(AUDIT_DISCLAIMER.length, 4, "four disclaimers are attached to every audit");

const j = JSON.parse(toJSON(audit));
eq(j.mode, "audit", "JSON marks the mode");
eq(j.digest.sha256, d1.sha256, "JSON carries the digest");
eq(j.records.length, 2, "JSON carries the records");

// --- boundaries --------------------------------------------------------------
ok(BOUNDARIES.some((b) => /does not claim an event set is complete/i.test(b)), "boundary: no completeness claim");
ok(BOUNDARIES.some((b) => /does not re-execute the walk/i.test(b)), "boundary: digest vs re-measurement");
ok(BOUNDARIES.some((b) => /Mainnet/i.test(b)), "boundary: no Mainnet");
ok(BOUNDARIES.some((b) => /does not sign/i.test(b)), "boundary: content-addressed, not identity-attested");

// --- windows math (shared with pi-soroban-events) ----------------------------
const w = splitWindows(1, 100, 30);
eq(w.length, 4, "windows tile the range");
ok(windowsAreSane(w, 1, 100), "windows are sane (no gaps, no overlaps)");
eq(coveredLedgers(w), 100, "windows cover the whole range");
eq(coveragePct(w, 1, 100), 100, "coverage is 100%");
eq(splitWindows(1, 10, 5), [[1, 5], [6, 10]], "exact-fit windows");
eq(splitWindows(1, 3, 10), [[1, 3]], "a short range is one clipped window");
eq(isTruncated(100), true, "100 is truncated");
eq(isTruncated(99), false, "99 is not truncated");
eq(PAGE_CAP, PAGE_CAP_RETAINED, "the window cap matches the retained constant");
eq(RETENTION_LEDGERS, 120960, "retention is 120960 ledgers");
eq(RETENTION_LEDGERS * 5, 604800, "120960 x 5s = 7 days");
const clip = clampRange(0, 999, 100, 500);
eq([clip.start, clip.end, clip.ok], [100, 500, true], "clampRange clips both ends");
eq(clampRange(0, 50, 100, 500).ok, false, "an entirely-outside range is not ok");
let threw2 = false;
try { splitWindows(10, 1, 5); } catch { threw2 = true; }
ok(threw2, "to < from throws");

// --- fixtures ----------------------------------------------------------------
ok(Object.keys(FIXTURES).length >= 4, "at least four fixtures");
ok(/no real ledger data and no personal data/i.test(FIXTURE_NOTE), "fixtures are declared synthetic");

// --- the digest spec is reimplementable by hand ------------------------------
ok(/sha256/.test(DIGEST_SPEC.algorithm), "spec names sha256");
ok(/hex/.test(DIGEST_SPEC.encoding), "spec names hex");
ok(/\{start\}-\{end\}/.test(DIGEST_SPEC.canonical), "spec gives the canonical line shape");
ok(/joined by/.test(DIGEST_SPEC.canonical), "spec states the line joining");

// --- event identity: parsing and ordering ------------------------------------
eq(parseEventId("0117041702811729920-0000000000").index, 0, "parseEventId reads the index");
eq(parseEventId("0117041702811729920-0000000000").toid.toString(), "117041702811729920", "parseEventId reads the TOID as a number (leading zeros are not significant)");
eq(parseEventId("not-an-id"), null, "parseEventId rejects a non-matching shape");
eq(parseEventId("0117-abcdef"), null, "parseEventId rejects a non-numeric index");
eq(parseEventId(null), null, "parseEventId rejects a non-string");
eq(EVENT_ID_FORMAT, "{TOID}-{index}", "the measured id format is recorded");
ok(idsAreOrdered(["0117000000000000001-0000000000", "0117000000000000002-0000000000"]), "ascending TOIDs are ordered");
ok(idsAreOrdered(["0117000000000000002-0000000000", "0117000000000000002-0000000000"]), "equal TOIDs are still ordered (non-decreasing)");
ok(!idsAreOrdered(["0117000000000000002-0000000000", "0117000000000000001-0000000000"]), "descending TOIDs are NOT ordered");
ok(!idsAreOrdered(["garbage"]), "an unparseable id makes ordering fail");
ok(EVENT_FIELDS_NOT_INTERPRETED.includes("value") && EVENT_FIELDS_NOT_INTERPRETED.includes("topic"),
  "event value/topic are explicitly not interpreted");
ok(EVENT_FIELDS_READ.includes("id") && EVENT_FIELDS_READ.includes("ledger"), "the read fields are declared");

// --- duplicate detection -----------------------------------------------------
const dupClean = [makeWindowRecord({ start: 1, end: 10, state: "verified", eventCount: 2, request: {},
  sampleIds: ["0117000000000000001-0000000000", "0117000000000000002-0000000000"] })];
const dupResult = detectDuplicates(dupClean);
eq(dupResult.state, "none", "distinct ids -> no duplicate observed");
eq(dupResult.duplicateCount, 0, "no duplicate count");
eq(dupResult.idsExamined, 2, "both ids examined");

const dupExact = [makeWindowRecord({ start: 1, end: 10, state: "verified", eventCount: 3, request: {},
  sampleIds: ["0117000000000000001-0000000000", "0117000000000000001-0000000000", "0117000000000000002-0000000000"] })];
const dupExactResult = detectDuplicates(dupExact);
eq(dupExactResult.state, "exact", "a repeated id is detected as exact");
eq(dupExactResult.duplicateCount, 1, "one duplicate group");
eq(dupExactResult.duplicates[0].count, 2, "the duplicate was seen twice");
eq(dupExactResult.duplicates[0].id, "0117000000000000001-0000000000", "the duplicate id is named");

const dupAcross = [
  makeWindowRecord({ start: 1, end: 10, state: "verified", eventCount: 1, request: {}, sampleIds: ["0117000000000000005-0000000000"] }),
  makeWindowRecord({ start: 11, end: 20, state: "verified", eventCount: 1, request: {}, sampleIds: ["0117000000000000005-0000000000"] }),
];
const dupAcrossResult = detectDuplicates(dupAcross);
eq(dupAcrossResult.state, "exact", "a duplicate across two windows is detected");
eq(dupAcrossResult.duplicates[0].count, 2, "the cross-window duplicate was seen twice");
eq(dupAcrossResult.duplicates[0].places.length, 2, "both places are recorded");

// truncated windows make duplicate ABSENCE unprovable
const dupTruncated = [makeWindowRecord({ start: 1, end: 10, state: "truncated", eventCount: 100, request: {}, sampleIds: ["0117000000000000001-0000000000"] })];
const dupTruncResult = detectDuplicates(dupTruncated);
eq(dupTruncResult.state, "unobservable", "a truncated window makes duplicate absence unobservable");
ok(/cannot be completed/.test(dupTruncResult.caveat), "the duplicate caveat names the truncation limit");
ok(DUPLICATE_STATES.unobservable && DUPLICATE_STATES.exact && DUPLICATE_STATES.none, "all three duplicate states exist");
ok(/does not claim that a duplicate does not exist/i.test(DUPLICATE_ABSENCE_NOT_CLAIMED), "the duplicate non-claim is stated verbatim");

// --- gap detection -----------------------------------------------------------
const gapRecord = makeWindowRecord({ start: 100, end: 104, state: "verified", eventCount: 2, request: {},
  sampleIds: ["0117000000000000001-0000000000", "0117000000000000001-0000000001"], sampleLedgers: [100, 100] });
const gapIn = ledgerGapsInWindow(gapRecord);
eq(gapIn.kind, "empty", "an empty ledger inside a verified window is kind=empty");
eq(gapIn.provable, true, "gap in a verified window is provable");
eq(gapIn.emptyLedgers, [101, 102, 103, 104], "the empty ledgers are listed");
eq(gapIn.emptyCount, 4, "the empty count is exact");
const gapUnproven = ledgerGapsInWindow(makeWindowRecord({ start: 100, end: 104, state: "truncated", eventCount: 100, request: {}, sampleLedgers: [100] }));
eq(gapUnproven.kind, "unproven", "a ledger in a truncated window is unproven, NOT a gap");
eq(gapUnproven.provable, false, "unproven gaps are not provable");
const gaps = detectGaps([gapRecord, makeWindowRecord({ start: 200, end: 209, state: "truncated", eventCount: 100, request: {} })]);
eq(gaps.provableWindows, 1, "only verified windows support gap statements");
eq(gaps.unprovenWindows, 1, "the truncated window is counted as unproven");
eq(gaps.emptyLedgerCount, 4, "the empty ledgers come only from verified windows");
ok(/not an error/.test(gaps.note), "the gap note says an empty ledger is not an error");

// --- resume ------------------------------------------------------------------
const resumeMid = resumePoint([
  makeWindowRecord({ start: 100, end: 199, state: "verified", eventCount: 3, request: {} }),
  makeWindowRecord({ start: 200, end: 299, state: "truncated", eventCount: 100, request: {} }),
]);
eq(resumeMid.resumable, true, "a covered range is resumable");
eq(resumeMid.nextStartLedger, 300, "resume starts after the last covered ledger");
eq(resumeMid.lastCoveredLedger, 299, "the last covered ledger is recorded");
eq(resumePoint([]).resumable, false, "an empty record is not resumable");
const feasOk = resumeFeasibility(resumeMid, 250, 500);
eq(feasOk.possible, true, "a resume inside retention is possible");
const feasLost = resumeFeasibility(resumeMid, 400, 500);
eq(feasLost.possible, false, "a resume past retention is impossible");
eq(feasLost.lostLedgers, 100, "the permanently lost ledger count is exact");
eq(feasLost.lostFrom, 300, "the lost range starts at the resume point");
eq(feasLost.lostTo, 399, "the lost range ends before the new oldest");

// --- source comparison -------------------------------------------------------
const sourceA = { header: { endpoint: "A", nodeVersion: "28.0.1" }, records: [
  makeWindowRecord({ start: 1, end: 100, state: "verified", eventCount: 3, request: {} }) ] };
const sourceB = { header: { endpoint: "B", nodeVersion: "28.0.1" }, records: [
  makeWindowRecord({ start: 1, end: 100, state: "verified", eventCount: 3, request: {} }) ] };
eq(compareSources(sourceA, sourceB).verdict, "agree", "identical verified counts agree");
const sourceC = { header: { endpoint: "B", nodeVersion: "28.0.1" }, records: [
  makeWindowRecord({ start: 1, end: 100, state: "verified", eventCount: 4, request: {} }) ] };
eq(compareSources(sourceA, sourceC).verdict, "disagree", "different verified counts disagree");
eq(compareSources(sourceA, sourceC).disagreements.length, 1, "the disagreeing range is listed");
const sourceTrunc = { header: { endpoint: "B", nodeVersion: "28.0.1" }, records: [
  makeWindowRecord({ start: 1, end: 100, state: "truncated", eventCount: 100, request: {} }) ] };
eq(compareSources(sourceA, sourceTrunc).verdict, "not-comparable", "a truncated source cannot be compared");
const sourceOther = { header: { endpoint: "B", nodeVersion: "28.0.1" }, records: [
  makeWindowRecord({ start: 500, end: 600, state: "verified", eventCount: 3, request: {} }) ] };
eq(compareSources(sourceA, sourceOther).verdict, "not-comparable", "non-overlapping ranges are not comparable");
const sourceDiffVer = { header: { endpoint: "B", nodeVersion: "29.0.0" }, records: [
  makeWindowRecord({ start: 1, end: 100, state: "verified", eventCount: 3, request: {} }) ] };
eq(compareSources(sourceA, sourceDiffVer).verdict, "not-comparable", "a node-version change is not comparable");
eq(compareSources(null, sourceB).verdict, "not-comparable", "a missing source is not comparable");
eq(compareSources(sourceA, sourceC).comparedRanges, 1, "one overlapping verified range is compared");
ok(SOURCE_COMPARISON_VERDICTS.agree && SOURCE_COMPARISON_VERDICTS.disagree && SOURCE_COMPARISON_VERDICTS["not-comparable"],
  "all three comparison verdicts exist");

// --- buildIdentityAnalysis + buildAudit wiring ------------------------------
const idWith = buildIdentityAnalysis(dupClean);
eq(idWith.idsAnalysed, true, "identity analysis runs when ids exist");
eq(idWith.windowsWithIds, 1, "the window with ids is counted");
eq(idWith.idsExamined, 2, "both ids are examined");
eq(idWith.ordering, true, "ordering is reported true for ascending ids");
const idWithout = buildIdentityAnalysis([makeWindowRecord({ start: 1, end: 10, state: "verified", eventCount: 2, request: {} })]);
eq(idWithout.idsAnalysed, false, "identity analysis reports when no ids exist");
ok(/no statement about duplicates or gaps is possible/.test(idWithout.scope), "the no-ids scope is stated");
const idMalformed = buildIdentityAnalysis([makeWindowRecord({ start: 1, end: 10, state: "verified", eventCount: 1, request: {}, sampleIds: ["bad-id"] })]);
eq(idMalformed.malformedIds.length, 1, "a malformed id is reported, not silently parsed");

const auditExt = buildAudit({
  records: dupClean, requestedSpan: 10,
  header: { endpoint: "https://rpc.testnet.minepi.com", nodeVersion: "28.0.1", protocolVersion: 28, measuredAt: "2026-10-19" },
  retention: { oldest: 1, latest: 1000 },
});
ok(auditExt.identity, "buildAudit carries the identity layer");
eq(auditExt.identity.duplicates.state, "none", "buildAudit reports no duplicate for clean ids");
eq(auditExt.resume.nextStartLedger, 11, "buildAudit carries the resume point");
eq(auditExt.resume.possible, true, "buildAudit evaluates resume feasibility with retention");
ok(auditExt.digest.sha256 === digestRecords(dupClean).sha256, "adding identity fields does not change the coverage digest");

// --- the digest must NOT depend on identity evidence ------------------------
const recNoIds = makeWindowRecord({ start: 1, end: 10, state: "verified", eventCount: 2, request: {} });
const recWithIds = makeWindowRecord({ start: 1, end: 10, state: "verified", eventCount: 2, request: {}, sampleIds: ["0117000000000000001-0000000000"] });
eq(digestRecords([recNoIds]).sha256, digestRecords([recWithIds]).sha256,
  "the coverage digest is independent of identity evidence (digest scope is stated)");

// --- rendering the extension ------------------------------------------------
const extText = renderAudit(auditExt);
ok(/Event identity/.test(extText), "the rendered audit shows the identity layer");
ok(/Resume/.test(extText), "the rendered audit shows the resume layer");
ok(/duplicates:/.test(extText), "the rendered audit shows the duplicate state");
ok(/empty ledgers/.test(extText), "the rendered audit shows the gap count");
const extNoIdText = renderAudit(buildAudit({ records: [recNoIds], requestedSpan: 10, header: { endpoint: "x" } }));
ok(/no event ids were recorded/.test(extNoIdText), "an audit without ids says so instead of implying no duplicates");
ok(/does not claim that a duplicate does not exist/i.test(extNoIdText), "the rendered audit carries the duplicate non-claim");
const extJSON = JSON.parse(toJSON(auditExt));
eq(extJSON.identity.duplicates.state, "none", "JSON carries the identity layer");
eq(extJSON.resume.nextStartLedger, 11, "JSON carries the resume layer");

// --- boundaries for the extension -------------------------------------------
ok(BOUNDARIES.some((b) => /does not claim a duplicate does not exist/i.test(b)), "boundary: duplicate absence is not claimed");
ok(BOUNDARIES.some((b) => /unproven/i.test(b)), "boundary: unproven ledgers are not called gaps");
ok(FORBIDDEN_CLAIMS.some((f) => /no duplicates exist/i.test(f)), "forbids claiming no duplicates exist");
ok(FORBIDDEN_CLAIMS.some((f) => /no events are missing/i.test(f)), "forbids claiming no events are missing");

// --- docs and links ----------------------------------------------------------
const docs = [
  "README.md", "llms.txt", "docs/INDEX.md", "docs/AUDIT-MODEL.md", "docs/DIGEST-SPEC.md",
  "docs/UNVERIFIABLE.md", "docs/EVENT-IDENTITY.md", "docs/GAPS-DUPLICATES-RESUME.md",
  "docs/DECISIONS.md", "docs/SOURCES.md", "docs/VERIFICATION.md",
];
for (const d of docs) {
  try { readFileSync(join(root, d), "utf8"); pass++; } catch { fail++; failures.push(`missing doc: ${d}`); }
}

const mdFiles = [];
(function walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === ".git" || ent.name === "node_modules") continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (/\.(md|txt)$/.test(ent.name)) mdFiles.push(full);
  }
})(root);

let broken = 0;
for (const f of mdFiles) {
  const t = readFileSync(f, "utf8");
  for (const m of t.matchAll(/\]\((?!https?:|#)([^)]+)\)/g)) {
    const rel = m[1].split("#")[0];
    if (!rel) continue;
    try { readFileSync(join(dirname(f), rel), "utf8"); } catch { broken++; failures.push(`broken link in ${f}: ${rel}`); }
  }
}
ok(broken === 0, `no broken relative links (found ${broken})`);

// --- the repository's own prose contains no forbidden claim ------------------
for (const f of mdFiles) {
  const text = readFileSync(f, "utf8");
  for (const claim of FORBIDDEN_CLAIMS) {
    const re = new RegExp(claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    for (const line of text.split(/\r?\n/)) {
      if (!re.test(line)) continue;
      const negated = /\b(not|never|does not|doesn't|isn't|is not|no|nor|forbidden|cannot|can't|must not)\b/i.test(line);
      const quoted = /forbidden|FORBIDDEN|must not|quoted|quote|avoid/i.test(line);
      if (negated || quoted) continue;
      fail++;
      failures.push(`forbidden claim asserted in ${f}: "${claim}"\n    line: ${line.trim().slice(0, 120)}`);
    }
  }
}

// --- the engine contains no network or execution primitive -------------------
for (const f of ["audit.mjs", "render.mjs"]) {
  const src = readFileSync(join(root, f), "utf8");
  ok(!/\bfetch\s*\(/.test(src), `${f} performs no network call`);
  ok(!/child_process|execSync|new Function\s*\(/.test(src), `${f} executes nothing`);
}
{
  const src = readFileSync(join(root, "lib.mjs"), "utf8");
  const imports = [...src.matchAll(/^\s*import\s+.+$/gm)].map((m) => m[0].trim());
  eq(imports, [], "lib.mjs imports nothing");
}
// the CLI may fetch, but must never sign or submit
{
  const src = readFileSync(join(root, "audit-cli.mjs"), "utf8");
  ok(!/signTransaction|submitTransaction|sendTransaction/.test(src), "the CLI never signs or submits");
}

if (fail) {
  console.error(`\n${fail} FAILURE(S):`);
  for (const f of failures) console.error("  - " + f);
  process.exitCode = 1;
}
console.log(`\npi-event-integrity — invariant tests\n  pass: ${pass}\n  fail: ${fail}`);
