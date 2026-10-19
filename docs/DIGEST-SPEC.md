# Digest specification

The integrity digest is a **sha256** over a **fully specified canonical byte
string**. Anyone can recompute it from a manifest without running this code, which
is what makes the audit *replayable* rather than *trusted*.

## 1. The canonical string

For each window record, in order, produce **one line**:

```
{start}-{end}|{state}|{eventCountOrNull}|{method}|{startLedger}|{endLedgerExclusive}|{limit}
```

Fields, exactly:

| Position | Field | Value |
|---|---|---|
| 1 | range | `start` and `end` joined by a single `-`, both inclusive |
| 2 | state | literal `verified` \| `truncated` \| `errored` \| `skipped` |
| 3 | event count | the integer, or the literal `null` |
| 4 | method | literal `getEvents` |
| 5 | start ledger | the integer sent |
| 6 | end-ledger (exclusive) | the integer sent, i.e. the inclusive `end + 1` |
| 7 | limit | the integer sent, or the literal `null` |

Then:

- lines are joined by a single `\n` (LF),
- there is **no trailing newline**,
- the bytes are UTF-8,
- the digest is `sha256` of those bytes, hex-encoded, lowercase.

## 2. Worked example

Two records:

```json
[
  { "start": 1, "end": 100, "state": "verified", "eventCount": 3,
    "request": { "method": "getEvents", "startLedger": 1, "endLedgerExclusive": 101, "limit": null } },
  { "start": 101, "end": 200, "state": "verified", "eventCount": 5,
    "request": { "method": "getEvents", "startLedger": 101, "endLedgerExclusive": 201, "limit": null } }
]
```

Canonical bytes (shown with `\n` written out):

```
1-100|verified|3|getEvents|1|101|null\n101-200|verified|5|getEvents|101|201|null
```

The test suite asserts this exact string, so the spec and the implementation
cannot drift apart silently.

## 3. What the digest proves — and what it does not

| | |
|---|---|
| **Proves** | the record has not been edited since the digest was taken |
| **Proves** | two runs of the same windows yield the same digest |
| **Does not prove** | that the RPC answers the same way today |
| **Does not prove** | who produced the record |
| **Does not prove** | that the record is complete or correct |

A digest is content-addressed, **not** identity-attested. This repository does
not sign anything with a key; see [`DECISIONS.md`](DECISIONS.md) D3.

## 4. The header

A digest is **never** meaningful alone. It is always read with its header:

| Field | Role |
|---|---|
| `endpoint` | which RPC the digest was taken against |
| `nodeVersion` | the node version reported by that endpoint |
| `protocolVersion` | the protocol version reported by that endpoint |
| `oldestLedger`, `latestLedger` | the retention window observed at the time |
| `measuredAt` | the timestamp |

`verifyDigest` compares the two headers and, when the endpoint or the node or
protocol version differ, returns **`not-comparable`** rather than `mismatch`.
Comparing a digest across versions would be a false signal in both directions:
two different underlying ledgers, or two different serialisations.

## 5. Verdicts

| Verdict | Meaning | Exit |
|---|---|---|
| `match` | recomputed digest equals the claimed digest | `0` |
| `mismatch` | the record no longer matches the digest it carries | `1` |
| `not-comparable` | the headers differ in endpoint/node/protocol version | `1` |

A `mismatch` states **only** that the record changed. It does not state that any
particular value is wrong.

## 6. Determinism notes

- Records are hashed **in order**; reordering windows changes the digest.
- Every hashed field is present in the record; there is no implicit default that
  could differ between implementations. `null` is written as the literal string
  `null`, not as an empty field, so an absent count can never be confused with a
  zero count.
- No locale, timezone or floating-point value enters the canonical string, so
  the digest is reproducible across machines.
