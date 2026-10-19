// windows.mjs — window arithmetic and retention math. Pure, no I/O.
//
// This is the same measured arithmetic as `pi-soroban-events`, kept in step with
// it on purpose. The measurements below were taken on 2026-10-19 against
// https://rpc.testnet.minepi.com (protocol 28):
//
//   getHealth  oldestLedger .. latestLedger spanned exactly 120 960 ledgers
//              (7 days at the measured 5 s ledger close time).
//   getEvents  accepts a very wide span; a 100 000-ledger span succeeded.
//              There is NO ~10 000-ledger span cap.
//   getEvents  returns at most 100 events per response; `limit` is ignored.
//   getEvents  returns a `cursor`, but the cursor is NOT honoured, so a window
//              that returns exactly 100 events CANNOT be continued.
//   getEvents  endLedger is EXCLUSIVE: [L, L] returns nothing, [L, L+1] returns
//              ledger L. The walker always sends end + 1.

/** Measured retention window: 120 960 ledgers = 7 days at 5 s per ledger. */
export const RETENTION_LEDGERS = 120960;

/** Observed hard cap on events per getEvents response. */
export const PAGE_CAP = 100;

export const DEFAULT_STEP = 9000;

/** Inclusive ledger windows covering [from, to]. */
export function splitWindows(from, to, step = DEFAULT_STEP) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error("from/to must be finite numbers");
  if (to < from) throw new Error("to must be >= from");
  if (!Number.isFinite(step) || step < 1) throw new Error("step must be >= 1");
  const out = [];
  for (let start = from; start <= to; start += step) {
    out.push([start, Math.min(start + step - 1, to)]);
  }
  return out;
}

/** Total ledgers represented by a list of inclusive windows. */
export function coveredLedgers(windows) {
  return windows.reduce((n, [a, b]) => n + (b - a + 1), 0);
}

/** Coverage as a percentage, rounded to one decimal. */
export function coveragePct(windows, from, to) {
  const requested = to - from + 1;
  if (requested <= 0) return 0;
  return Math.round((coveredLedgers(windows) / requested) * 1000) / 10;
}

/** Every window must be fully inside [from, to]; windows must tile with no gaps. */
export function windowsAreSane(windows, from, to) {
  let prevEnd = null;
  for (const [a, b] of windows) {
    if (a > b) return false;
    if (a < from || b > to) return false;
    if (prevEnd !== null && a !== prevEnd + 1) return false;
    prevEnd = b;
  }
  return true;
}

/** Clip a requested range to what the RPC currently serves. */
export function clampRange(from, to, oldest, latest) {
  if (![from, to, oldest, latest].every(Number.isFinite)) {
    throw new Error("clampRange needs four finite numbers");
  }
  const start = Math.max(from, oldest);
  const end = Math.min(to, latest);
  return {
    start,
    end,
    ok: end >= start,
    clippedStart: start !== from,
    clippedEnd: end !== to,
  };
}

/** A window is truncated when it filled the observed per-response cap. */
export function isTruncated(eventCount, cap = PAGE_CAP) {
  return eventCount >= cap;
}

export { DEFAULT_STEP as DEFAULT_STEP_SIZE };
