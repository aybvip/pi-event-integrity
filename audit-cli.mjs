#!/usr/bin/env node
// audit-cli.mjs — CLI for the Pi event coverage audit.
//
// READ-ONLY. The live modes POST `getEvents` / `getHealth` reads only. The
// offline modes touch no network. Nothing is written to disk by default; a
// manifest is printed, and can be redirected by the caller if they wish.
//
// Measured semantics reused from pi-soroban-events (2026-10-19, protocol 28):
//   - endLedger is EXCLUSIVE: the walker always sends end + 1
//   - at most 100 events per response; `limit` is ignored
//   - the returned `cursor` is not honoured, so a full page cannot be continued
//   - startLedger below retention is a -32600 error
//   - retention is 120 960 ledgers
//
// Usage:
//   node audit-cli.mjs --from <l> --to <l> [--step 9000] [--json]
//   node audit-cli.mjs --from <l> --to <l> --dry-run [--json]
//   node audit-cli.mjs --verify <manifest.json>          (offline)
//   node audit-cli.mjs --boundaries | --help

import { readFileSync } from "node:fs";
import {
  makeWindowRecord,
  windowStateOf,
  PAGE_CAP_RETAINED,
  RETENTION_LEDGERS,
  BOUNDARIES,
} from "./lib.mjs";
import { buildAudit, digestRecords, verifyDigest, verifyVerdict, buildSourceComparison } from "./audit.mjs";
import { renderAudit, renderBoundaries, toJSON } from "./render.mjs";
import { splitWindows, clampRange } from "./windows.mjs";

const RPC_URL = "https://rpc.testnet.minepi.com";
const PAGE_CAP = PAGE_CAP_RETAINED ?? 100;
const DEFAULT_STEP = 9000;

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const after = (f) => { const i = args.indexOf(f); return args[i + 1]; };

async function rpc(method, params = {}) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

async function liveAudit({ from, to, step, asJson }) {
  const health = await rpc("getHealth");
  const oldest = Number(health.oldestLedger);
  const latest = Number(health.latestLedger);

  const clipped = clampRange(from, to, oldest, latest);
  if (!clipped.ok) {
    console.error(
      `ERROR: the requested range lies outside retention.\n` +
        `  requested: ${from} .. ${to}\n  available: ${oldest} .. ${latest}\n` +
        `  retention is ${RETENTION_LEDGERS} ledgers. Nothing was queried.`
    );
    process.exit(2);
  }

  const windows = splitWindows(clipped.start, clipped.end, step);
  const records = [];
  for (const [start, end] of windows) {
    const request = { startLedger: start, endLedgerExclusive: end + 1, limit: PAGE_CAP, filters: [] };
    try {
      const ev = await rpc("getEvents", {
        startLedger: start,
        endLedger: end + 1, // EXCLUSIVE on this RPC
        filters: [],
        limit: PAGE_CAP,
      });
      const events = ev.events ?? [];
      const count = events.length;
      records.push(makeWindowRecord({
        start, end, state: windowStateOf(count, PAGE_CAP), eventCount: count, request,
        // identity evidence, read from the measured event shape:
        sampleIds: events.map((e) => e.id).filter((x) => typeof x === "string"),
        sampleLedgers: events.map((e) => Number(e.ledger)).filter((x) => Number.isFinite(x)),
      }));
    } catch (e) {
      records.push(makeWindowRecord({ start, end, state: "errored", eventCount: null, request, error: e.message }));
    }
    process.stderr.write(`  walked [${start} .. ${end}]\n`);
  }

  const audit = buildAudit({
    records,
    requestedSpan: clipped.end - clipped.start + 1,
    retention: { oldest, latest },
    header: {
      endpoint: RPC_URL,
      // identity read live, so the digest is version-scoped
      nodeVersion: (await rpc("getVersionInfo").catch(() => ({})))?.version ?? null,
      protocolVersion: (await rpc("getNetwork").catch(() => ({})))?.protocolVersion ?? null,
      latestLedger: latest,
      oldestLedger: oldest,
      measuredAt: new Date().toISOString(),
    },
  });

  console.log(asJson ? toJSON(audit) : renderAudit(audit));
  process.exitCode = audit.coverage.allProvable ? 0 : 1;
}

function dryRunAudit({ from, to, step, asJson }) {
  const windows = splitWindows(from, to, step);
  // A dry run records every window as `skipped` (never queried), so the audit
  // shows a full ledger coverage with ZERO provable events — which is the truth.
  const records = windows.map(([start, end]) =>
    makeWindowRecord({ start, end, state: "skipped", eventCount: null, request: { startLedger: start, endLedgerExclusive: end + 1, limit: PAGE_CAP, filters: [] } })
  );
  const audit = buildAudit({
    records,
    requestedSpan: to - from + 1,
    header: { endpoint: RPC_URL, measuredAt: null },
  });
  console.log(asJson ? toJSON(audit) : renderAudit(audit));
  process.exitCode = 1; // nothing is provable in a dry run
}

function verifyManifest(path) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`ERROR: cannot read manifest "${path}": ${e.message}`);
    process.exit(2);
  }
  if (!Array.isArray(manifest.records)) {
    console.error("ERROR: manifest has no `records` array.");
    process.exit(2);
  }
  const claimed = manifest?.digest?.sha256;
  if (!claimed) {
    console.error("ERROR: manifest has no `digest.sha256`.");
    process.exit(2);
  }
  const result = verifyDigest(claimed, manifest.records, {
    claimedHeader: manifest.header,
    liveHeader: manifest.header, // offline: compares the manifest to itself
  });
  const verdict = verifyVerdict(result);
  console.log("=== PI EVENT INTEGRITY — digest verification (offline) ===");
  console.log(`  claimed:    ${claimed}`);
  console.log(`  recomputed: ${result.actual}`);
  console.log(`  verdict:    ${verdict}`);
  if (verdict === "mismatch") {
    console.log("");
    console.log("  The record has been edited since the digest was taken.");
    console.log("  This does NOT mean any specific value is wrong — it means the");
    console.log("  record no longer matches the digest it carries.");
  }
  process.exitCode = verdict === "match" ? 0 : 1;
}

function compareManifests(pathA, pathB) {
  if (!pathA || !pathB || pathA === pathB) {
    console.error("ERROR: --compare needs two distinct manifest paths.");
    process.exit(2);
  }
  const load = (p) => {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {
      console.error(`ERROR: cannot read manifest "${p}": ${e.message}`);
      process.exit(2);
    }
  };
  const a = load(pathA);
  const b = load(pathB);
  const result = buildSourceComparison(a, b);
  console.log("=== PI EVENT INTEGRITY — independent-source comparison (offline) ===");
  console.log(`  source A:   ${a?.header?.endpoint ?? "(unknown)"} v${a?.header?.nodeVersion ?? "?"}`);
  console.log(`  source B:   ${b?.header?.endpoint ?? "(unknown)"} v${b?.header?.nodeVersion ?? "?"}`);
  console.log(`  verdict:    ${result.verdict}`);
  console.log(`  reason:     ${result.reason ?? result.note ?? ""}`);
  if (result.comparedRanges) {
    console.log(`  compared:   ${result.comparedRanges} overlapping verified range(s)`);
    for (const d of result.disagreements ?? []) {
      console.log(`    DIFF [${d.from} .. ${d.to}]  A=${d.aCount}  B=${d.bCount}`);
    }
  }
  console.log("");
  console.log("  Only VERIFIED windows are compared. A truncated window has a lower");
  console.log("  bound, not a count, so it cannot be compared at all.");
  process.exitCode = result.verdict === "agree" ? 0 : result.verdict === "not-comparable" ? 2 : 1;
}

function usage() {
  console.log(
    [
      "pi-event-integrity — coverage audit with a replayable integrity digest",
      "",
      "  node audit-cli.mjs --from <l> --to <l> [--step 9000] [--json]",
      "  node audit-cli.mjs --from <l> --to <l> --dry-run [--json]",
      "  node audit-cli.mjs --verify <manifest.json>          (offline)",
      "  node audit-cli.mjs --compare <a.json> <b.json>       (offline)",
      "  node audit-cli.mjs --boundaries",
      "  node audit-cli.mjs --help",
      "",
      "Read-only. Reports ledger coverage and marks every window whose event",
      "count is a lower bound. Never claims an event set is complete.",
    ].join("\n")
  );
}

if (args.length === 0 || has("--help") || has("-h")) usage();
else if (has("--boundaries")) console.log(renderBoundaries());
else if (has("--verify")) verifyManifest(after("--verify"));
else if (has("--compare")) compareManifests(after("--compare"), args[args.indexOf("--compare") + 2] ?? args[args.indexOf("--compare") + 1]);
else if (has("--dry-run")) {
  const from = Number(after("--from")), to = Number(after("--to"));
  const step = Math.max(1, Number(after("--step")) || DEFAULT_STEP);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    console.error("ERROR: --from and --to must be numbers with --to >= --from");
    process.exit(1);
  }
  dryRunAudit({ from, to, step, asJson: has("--json") });
} else if (has("--from") && has("--to")) {
  const from = Number(after("--from")), to = Number(after("--to"));
  const step = Math.max(1, Number(after("--step")) || DEFAULT_STEP);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    console.error("ERROR: --from and --to must be numbers with --to >= --from");
    process.exit(1);
  }
  liveAudit({ from, to, step, asJson: has("--json") }).catch((e) => {
    console.error("ERROR:", e.message);
    process.exit(1);
  });
} else {
  console.error(`unknown option: ${args.join(" ")}`);
  console.error("try: node audit-cli.mjs --help");
  process.exit(2);
}
