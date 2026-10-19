# Verification

Every figure quoted in this repository can be reproduced with the commands below.
The dates and outputs are what was actually observed, not expected values.

## 0. Tests (offline, no network)

```bash
node test/integrity.test.mjs
```

Expected: `pass: 191  fail: 0`.

## 1. The two verdicts, same tool

### A single recent ledger → `EXACT`

```bash
node audit-cli.mjs --from 27255600 --to 27255600
```

Observed on 2026-10-19:

```
=== PI EVENT INTEGRITY — coverage audit ===
  endpoint:   https://rpc.testnet.minepi.com
  node:       28.0.1  protocol: 28
  ledger:     oldest=27134643 latest=27255602

# Coverage
  ledgers_requested: 1
  ledgers_covered:   1  (100%)
  windows:           1  verified=1 truncated=0 errored=0 skipped=0
  provable windows:  1
  unprovable:        0

  events_found:      12  (EXACT — every window is provable)
```

Exit code `0`.

### A retention-wide walk → `LOWER BOUND`

```bash
node audit-cli.mjs --from 1 --to 999999999 --step 9000
```

Observed on 2026-10-19:

```
=== PI EVENT INTEGRITY — coverage audit ===
  endpoint:   https://rpc.testnet.minepi.com
  node:       28.0.1  protocol: 28
  ledger:     oldest=27134643 latest=27255602

# Coverage
  ledgers_requested: 120960
  ledgers_covered:   120960  (100%)
  windows:           14  verified=0 truncated=14 errored=0 skipped=0
  provable windows:  0
  unprovable:        14

  events_found:      >= 1400  (LOWER BOUND)
  provable events:   0
  truncated events:  >= 1400

  # Unverifiable regions (14)
    [27134643 .. 27143642]  span=9000  state=truncated
    ...
    [27251643 .. 27255602]  span=3960  state=truncated
```

Exit code `1`.

**Read together:** 100% of ledgers were covered, yet **every** window (14 of 14)
cannot be completed, so the event count is a bound, not a total. The requested
range is clipped to retention automatically; the exact ledger numbers move as
retention slides.

## 2. The dry run states its own emptiness

```bash
node audit-cli.mjs --from 1000 --to 1999 --dry-run
```

Observed:

```
  ledgers_covered:   0  (0%)
  windows:           1  verified=0 truncated=0 errored=0 skipped=1
  events_found:      >= 0  (LOWER BOUND)
```

Exit code `1`. A run that queried nothing reports nothing as covered — which is
the truth. (The single window covers 1000 ledgers but is `skipped`, so
`ledgers_covered` is `0`.)

## 3. Digest round-trip and tamper detection

```bash
node audit-cli.mjs --from 27255000 --to 27255999 --step 500 --json > manifest.json
node audit-cli.mjs --verify manifest.json
```

Observed:

```
=== PI EVENT INTEGRITY — digest verification (offline) ===
  claimed:    7ca6b48d3ca76399ad4fabbe9ed33b559cbfaa87144fd5bc8f5909e727d7b0b5
  recomputed: 7ca6b48d3ca76399ad4fabbe9ed33b559cbfaa87144fd5bc8f5909e727d7b0b5
  verdict:    match
```

Exit code `0`. Now edit **one** event count in `manifest.json` and re-verify:

```
  claimed:    7ca6b48d3ca76399ad4fabbe9ed33b559cbfaa87144fd5bc8f5909e727d7b0b5
  recomputed: b9e0e228fc45a76167bdd2bcd456dd663a1200ab46fb2402807f2dabac89b3d5
  verdict:    mismatch

  The record has been edited since the digest was taken.
  This does NOT mean any specific value is wrong — it means the
  record no longer matches the digest it carries.
```

Exit code `1`. A single edited field changes the digest — the digest is
tamper-**evident**.

## 4. Recompute the digest by hand

The canonical string for a manifest is fully specified in
[`DIGEST-SPEC.md`](DIGEST-SPEC.md). For the two-record worked example there, the
canonical bytes are:

```
1-100|verified|3|getEvents|1|101|null\n101-200|verified|5|getEvents|101|201|null
```

and the test suite asserts this exact string, so the specification and the
implementation cannot silently diverge.

## 5. Invalid input

```bash
node audit-cli.mjs --from 100 --to 50
```

Observed: `ERROR: --from and --to must be numbers with --to >= --from`, exit `1`.

```bash
node audit-cli.mjs --from 27000000 --to 27008999   # entirely before retention
```

Observed: an error naming the requested and available ranges and the retention
size, exit `2`. Nothing was queried.

## 6. Repository self-check

```bash
node audit-cli.mjs --boundaries
```

Lists every boundary and re-states the completeness non-claim. The test suite
additionally scans every Markdown file for forbidden-claim phrases and fails the
suite if one is asserted rather than quoted or negated.

## Reproducing against a moved retention window

Retention slides, so the exact ledger numbers above will not match on a later
date. The **verdicts** are what to reproduce: a single recent ledger that returns
fewer than the cap is `verified`/`EXACT`; a wide walk on an active range is
`truncated`/`LOWER BOUND`. If a later run shows a wide walk as fully `verified`,
that means the RPC has changed and this repository's recorded semantics are
stale — which is itself a reportable measurement.

## 7. Commit attribution (D13)

GitHub attributes a commit to the account that **owns the author email**, not to
whoever authenticated the push. An early commit here was pushed from the project
account but carried an author email owned by a different GitHub account, so the
contributors list credited that other account. The history was rewritten so every
commit is authored by the project account address, then force-pushed.

Check it against the published repository — the author of every commit should be
the project account, and the contributors list should name only that account:

```bash
# every commit author email
git log --format="%ae" | sort -u

# GitHub's own attribution (no cache)
curl -s "https://api.github.com/repos/aybvip/pi-event-integrity/stats/contributors" \
  | grep -o '"login":"[^"]*"' | sort -u
```

Expected: one email (`86422631+aybvip@users.noreply.github.com`) and one login
(`aybvip`). The file contents are unchanged by the rewrite; the test suite result
is identical before and after (191 pass / 0 fail).

> Note on caching: GitHub's `contributors` list is cached and can lag a
> force-push by minutes to hours. `stats/contributors` reflects the new history
> sooner. Read the **commits** endpoint (or the commit author email) for the
> authoritative answer. A `contributors` entry that no longer matches any
> commit's author email is a stale cache, not a live attribution.

## 8. The identity layer, live

### A verified window: duplicates and gaps are provable

```bash
node audit-cli.mjs --from 27255803 --to 27255822 --step 20
```

Observed on 2026-10-19:

```
  ledgers_covered:   20  (100%)
  windows:           1  verified=1 truncated=0 errored=0 skipped=0
  events_found:      83  (EXACT — every window is provable)

# Event identity
  ids examined:      83
  id ordering ok:    yes
  duplicates:        none  (repeated ids observed: 0)
  empty ledgers:     3  (inside 1 verified window(s))
  unproven windows:  0  (ledgers inside them are NOT reported as gaps)

# Resume
  next start ledger: 27255823
  possible: yes — the resume point is still inside retention.
```

Exit code `0`. The three empty ledgers (27255807, 27255808, 27255810) are reported
as information — not as missing events.

### An all-truncated walk: duplicates become `unobservable`

```bash
node audit-cli.mjs --from 1 --to 999999999 --step 9000
```

Observed: 14 windows, all `truncated` → `duplicates: unobservable`, `unproven
windows: 14`, and `empty ledgers: 0` (because no window is provable). Exit code
`1`. The tool refuses to report `none`, because a duplicate inside a truncated
window cannot be seen.

### The identity layer does not change the coverage digest

The test suite asserts that adding `sampleIds` to a window record leaves the
coverage digest byte-identical. Identity and coverage are verified independently.

## 9. Independent-source comparison

```bash
node audit-cli.mjs --from 27255600 --to 27255601 --step 5 --json > a.json
node audit-cli.mjs --from 27255600 --to 27255601 --step 5 --json > b.json
node audit-cli.mjs --compare a.json b.json
```

Observed:

```
  source A:   https://rpc.testnet.minepi.com v28.0.1
  source B:   https://rpc.testnet.minepi.com v28.0.1
  verdict:    agree
  compared:   1 overlapping verified range(s)
```

Exit code `0`. Comparing an all-truncated record against anything yields
`not-comparable` (exit `2`) — a truncated window has a lower bound, not a count.
Comparing across different node or protocol versions also yields `not-comparable`,
never a disagreement.

