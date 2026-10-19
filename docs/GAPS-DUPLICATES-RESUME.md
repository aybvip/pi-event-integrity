# Gaps, duplicates, resume, and sources

Four capabilities that go beyond coverage. Each one states what it can prove and
— more importantly — what it cannot.

## 1. Duplicate detection

A **duplicate** is the same event `id` seen more than once, in one window or
across windows. Because overlapping windows were measured to return **disjoint**
pages (see [`EVENT-IDENTITY.md`](EVENT-IDENTITY.md) §2), a repeated id is an
anomaly worth reporting, not an expected artefact.

### Three states, and they must never be conflated

| State | Meaning |
|---|---|
| `none` | no repeated id was observed across the windows examined |
| `exact` | the same id appeared more than once; each is listed with its places |
| `unobservable` | at least one window was truncated, so a duplicate inside it **cannot** be observed |

### The honesty rule

> **A duplicate inside a truncated window cannot be seen.**

A truncated window's page was cut at the cap, and the cursor does not continue
it. A repeated event inside that window is simply not reachable. So the audit
returns `unobservable` — **not** `none` — whenever any window is truncated. The
caveat text says so verbatim:

```
duplicates:  unobservable  (repeated ids observed: 0)
  ! 2 truncated window(s) cannot be completed, so a duplicate inside them cannot be observed.
```

The repository never claims that no duplicates exist. That phrase is a forbidden
claim, and the test suite fails if the documentation asserts it.

### Measured

On 2026-10-19, a verified window of 83 events carried **83 distinct ids** — zero
duplicates observed, with no truncated window, so the finding is `none` and is
provable **for that window**.

## 2. Gap detection

Two kinds of gap, and the difference is the whole point:

| Kind | Meaning | Provable |
|---|---|---|
| `empty` | a ledger inside a **verified** window produced no events — legitimate | **yes** |
| `unproven` | a ledger inside a **truncated/errored/skipped** window — nothing is known | no |

> **An empty ledger is a legitimate observation, not an error.** Measured: a 20-
> ledger window with 83 events had **3 ledgers with no events** at all
> (27255807, 27255808, 27255810). Reporting those as "missing events" would be
> wrong; they are reported as information.

> **A ledger inside an unproven window is NOT reported as a gap.** Nothing is
> known about that ledger, so calling it empty would be an unbacked claim. The
> audit counts it under `unprovenWindows` and says nothing about its contents.

### Measured

```
empty ledgers:     3  (inside 1 verified window(s))
unproven windows:  0  (ledgers inside them are NOT reported as gaps)
```

And, for an all-truncated walk:

```
empty ledgers:     0  (inside 0 verified window(s))
unproven windows:  14  (ledgers inside them are NOT reported as gaps)
```

The second result is the honest one: nothing was provable, so no gap statement is
made.

## 3. Resume

A walk that stops can continue from the ledger after its last **covered** window.

| Field | Meaning |
|---|---|
| `resumable` | whether any ledger was covered |
| `nextStartLedger` | the ledger after the last covered window |
| `lastCoveredLedger` | the last ledger known to be covered |

### The retention trap

Retention slides. If the resume point has fallen **outside** retention before the
walk restarts, the ledgers in between are **permanently unqueryable**. The audit
does not pretend otherwise:

```
next start ledger: 300
POSSIBLE: no — retention has passed the resume point.
permanently lost:  300 .. 399  (100 ledgers)
```

`resumeFeasibility` answers this in advance: given a resume point and the current
retention window, it reports whether resuming is possible and exactly how many
ledgers were lost. A gap you caused by pausing is a fact to record, not to hide.

## 4. Independent-source comparison

`--compare a.json b.json` compares two manifests of the same ledger range taken
against different endpoints, or the same endpoint at different times.

### Three verdicts

| Verdict | Meaning |
|---|---|
| `agree` | every overlapping **verified** ledger had the same event count in both |
| `disagree` | at least one overlapping verified ledger had a different count |
| `not-comparable` | the two records do not share a comparable range or version |

### Two rules that keep the comparison honest

1. **Only verified windows are compared.** A truncated window has a lower bound,
   not a count, so it cannot be compared at all. If neither source has a verified
   overlapping ledger, the verdict is `not-comparable`, **not** `agree`.
2. **A version change is not-comparable, not a disagreement.** If the node or
   protocol version differs between the two records, they describe different
   scopes. Reporting `agreement` or `disagreement` across versions would be a
   false signal in both directions.

### Measured

Two runs of the same verified range against the same endpoint produced `agree`
over 1 overlapping verified range, exit `0`. Two runs of an all-truncated range
produce `not-comparable`, because no verified ledger exists to compare.

## 5. Not claimed

- That a duplicate does not exist — only whether one was observed.
- That an unproven ledger is empty.
- That a resume always works — retention can pass the resume point.
- That a truncated window agrees or disagrees with anything.
- That two sources agree in general — only over the verified ledgers compared.
