# Unverifiable regions

The most important section of this repository. It states plainly what **cannot**
be proven, why, and what to report instead.

## 1. What a truncated window is

A window is `truncated` when `getEvents` returned **exactly** the observed cap
(100 events). The RPC also returns a `cursor`, which would normally be used to
fetch the next page. On this RPC the cursor is **not honoured** — measured in
`pi-soroban-events` on 2026-10-19:

- `{ cursor }` alone → `startLedger must be positive`;
- `{ cursor, startLedger, endLedger }` → the cursor is ignored and the **first
  page is returned again**.

Therefore a window that fills its page **cannot be continued**. Its event count
is a **lower bound**, and the window is an **unverifiable region**: the tool can
say how many events it saw, and can say that at least that many exist, but it
**cannot** say how many more exist inside that range.

## 2. Why this is not a bug to be worked around

The naive fix — "walk smaller windows until each returns fewer than 100" — is
unsound. A smaller window can still fill its page if events cluster, and the
tool would then have **more** unverifiable regions, not fewer. There is no
window size that guarantees a complete count, because the RPC offers no
continuation token and no per-ledger query that would let a client reconstruct
the full set.

This repository refuses to invent a workaround that would look complete and
would not be. It records the region and labels it.

## 3. What is reported instead

For every unverifiable window the audit records and prints:

| Field | Meaning |
|---|---|
| `start`, `end` | the exact ledger range that could not be completed |
| `span` | how many ledgers it covers |
| `state` | `truncated`, `errored`, or `skipped` |

And the audit as a whole reports:

```
events_found:      >= 1400  (LOWER BOUND)
provable events:   0
truncated events:  >= 1400

# Unverifiable regions (14)
  [27134643 .. 27143642]  span=9000  state=truncated
  ...
```

The `>=` and the word `LOWER BOUND` are not decoration; they are the entire
point. A consumer that wants a number can take the lower bound **knowing** it is
a lower bound. A consumer that wants certainty can read the regions and see that
certainty is not available for those ranges.

## 4. The three kinds of unverifiable region

| State | What is unknown | Why |
|---|---|---|
| `truncated` | how many events beyond the page exist in the range | the cursor cannot continue the page |
| `errored` | everything about the range | the RPC returned an error |
| `skipped` | everything about the range | it was never queried (outside retention, or a `--dry-run`) |

All three are reported with the same prominence. A skipped window is **not**
reported as covered; an errored window is **not** reported as empty.

## 5. The measured prevalence

On 2026-10-19 a retention-wide walk of 120 960 ledgers in 14 windows of 9 000
classified **all 14 windows as `truncated`**. High-activity ranges fill their
pages; the unverifiable path is the **common** path on this RPC, not a rare edge
case. Any tool that reports "the number of events" for such a range without the
lower-bound label is reporting a bound as if it were a total.

## 6. What this does not say

- It does not claim the events are unreachable **forever** — if the RPC begins
  honouring its cursor, the same walk would classify differently, and the tool
  re-measures rather than assuming.
- It does not claim the observed cap of 100 is a protocol constant. It is an
  observed behaviour; the live path re-reads it each run.
- It does not claim the unverifiable regions are unimportant. It claims they are
  **unproven**, which is a different thing.
