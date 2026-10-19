# The audit model

This document defines how a set of queried ledger windows becomes a coverage
audit. It is the normative description of what `audit.mjs` and `lib.mjs` compute.

## 1. A window record

A **window** is an inclusive ledger range `[start, end]` that was (or was not)
queried with one `getEvents` call. A **window record** captures everything needed
to replay that call and to read its result honestly:

| Field | Meaning |
|---|---|
| `start`, `end` | inclusive ledger range this window represents |
| `span` | `end - start + 1`, the number of ledgers |
| `state` | one of `verified`, `truncated`, `errored`, `skipped` |
| `provable` | `true` **only** for `verified` |
| `eventCount` | the number of events returned, or `null` when nothing is known |
| `request` | the exact `getEvents` request sent |
| `error` | the error message when `state === "errored"` |

### Why `request.endLedgerExclusive` is recorded separately

`endLedger` is **exclusive** on this RPC (measured in `pi-soroban-events`):
`[L, L]` returns nothing, `[L, L+1]` returns the events of ledger `L`. A record
that stored only the inclusive `end` would be ambiguous. Every record therefore
carries both: the inclusive `end` it represents, and the exclusive value actually
sent (`end + 1`).

## 2. The four states

```
                    ┌─────────────┐
   queried ─────────┤ count < cap │──► verified   (provable)
                    └─────────────┘
                    ┌─────────────┐
   queried ─────────┤ count = cap │──► truncated  (lower bound)
                    └─────────────┘
                    ┌─────────────┐
   queried ─────────┤ RPC error   │──► errored    (nothing known)
                    └─────────────┘
                    ┌─────────────┐
  not queried ──────┤ out of ret. │──► skipped    (nothing known)
                    └─────────────┘
```

`windowStateOf(count, cap)` returns `truncated` when `count >= cap` and
`verified` otherwise. Note the boundary: a window returning **exactly** the cap
is truncated, because a full page cannot be continued (the cursor is not
honoured). A window returning **zero** events is `verified`, not truncated —
zero is a real, provable answer.

## 3. Coverage arithmetic

Given the records and the requested ledger span:

| Quantity | Definition |
|---|---|
| `ledgersCovered` | sum of `span` over windows in state `verified` or `truncated` |
| `ledgerCoveragePct` | `ledgersCovered / requestedSpan`, one decimal |
| `byState` | count of windows per state |
| `provableWindows` | windows with `provable === true` |
| `unprovableWindows` | the rest |
| `provableEvents` | sum of `eventCount` over `verified` windows |
| `truncatedEventsLowerBound` | sum of `eventCount` over `truncated` windows |
| `eventsIsLowerBound` | `true` iff `unprovableWindows > 0` |
| `unverifiableRegions` | each unprovable window's range, span, and state |
| `allProvable` | `true` iff every window is provable |

### The central rule

> **A total is `EXACT` only when every window is provable. Otherwise it is a
> `LOWER BOUND`.**

`skipped` and `errored` windows do not appear in `ledgersCovered`, because
nothing is known about them — counting them would be an unbacked claim of
coverage.

## 4. Worked examples

### All verified → EXACT

```
windows: [1..100] verified  3 events
         [101..200] verified  5 events
```
`provableEvents = 8`, `eventsIsLowerBound = false`, `allProvable = true`.
Rendered as `events_found: 8 (EXACT — every window is provable)`, exit `0`.

### One truncated → LOWER BOUND

```
windows: [1..100] verified  3 events
         [101..200] truncated 100 events
```
`provableEvents = 3`, `truncatedEventsLowerBound = 100`,
`eventsIsLowerBound = true`, `unverifiableRegions = [[101..200] truncated]`.
Rendered as `events_found: >= 103 (LOWER BOUND)`, exit `1`.

### One skipped → reduced coverage

```
windows: [1..100] verified  3 events
         [101..200] skipped  —
```
`ledgersCovered = 100`, `ledgerCoveragePct = 50`, `unprovableWindows = 1`.
The audit states both the reduced coverage **and** the unprovable window.

## 5. The measured reality

Measured on **2026-10-19** against `https://rpc.testnet.minepi.com`
(node `28.0.1`, protocol `28`):

- A retention-wide walk of 120 960 ledgers in 14 windows of 9 000 reached
  **100% ledger coverage** with **`truncated=14`** and
  `events_found: >= 1400 (LOWER BOUND)`. *Every* window filled its 100-event
  page. High-activity ranges are the normal case, so the lower-bound path is the
  common path, not the exception.
- A single recent ledger returned a small number of events and classified as
  `verified` — `EXACT`, exit `0`.

Both runs are in [`VERIFICATION.md`](VERIFICATION.md).
