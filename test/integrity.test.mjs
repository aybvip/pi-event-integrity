// test/integrity.test.mjs — offline invariants for pi-event-integrity.
// No network. No personal data. No writes.

import {
  CLAIM_KINDS, FORBIDDEN_CLAIMS, COMPLETENESS_NOT_CLAIMED, WINDOW_STATES, UNPROVABLE_STATES,
  makeWindowRecord, windowStateOf, auditCoverage, DIGEST_SPEC, canonicalWindowLine,
  canonicalRecord, makeAuditHeader, HEADER_MEANING, BOUNDARIES, FIXTURES, FIXTURE_NOTE,
  RETENTION_LEDGERS, PAGE_CAP_RETAINED,
} from "../lib.mjs";
import { digestRecords, buildAudit, verifyDigest, verifyVerdict } from "../audit.mjs";
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
eq(AUDIT_DISCLAIMER.length, 3, "three disclaimers are attached to every audit");

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

// --- docs and links ----------------------------------------------------------
const docs = [
  "README.md", "llms.txt", "docs/INDEX.md", "docs/AUDIT-MODEL.md", "docs/DIGEST-SPEC.md",
  "docs/UNVERIFIABLE.md", "docs/DECISIONS.md", "docs/SOURCES.md", "docs/VERIFICATION.md",
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
