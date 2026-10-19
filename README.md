# Pi Event Integrity

A **read-only, zero-dependency** coverage audit for Soroban events on Pi Network,
with a **content digest** that makes a walk replayable and tamper-evident.

> **Plainly:** a walker that says *"300 events found"* is almost always reporting
> a **lower bound**, not a total — because the RPC caps a response at 100 events
> and does not honour the `cursor` it returns, so a full page **cannot be
> continued** (measured in `pi-soroban-events`). This repository exists to make
> that difference **provable**, not a footnote:
>
> - every window is classified `verified` or **not**;
> - a total is labelled `EXACT` **only** when every window is verified;
> - otherwise it is labelled `LOWER BOUND`, and the exact
>   **unverifiable regions** are listed;
> - the whole record carries a **sha256 digest** so any later edit is detectable.

Measured on **2026-10-19** against `https://rpc.testnet.minepi.com`
(node `28.0.1`, protocol `28`):

- a full retention walk `27134643 .. 27255602` (120 960 ledgers, 14 windows of
  9 000) reported **100% ledger coverage** — and **`truncated=14`**, so
  `events_found: >= 1400 (LOWER BOUND)`, exit `1`;
- a single recent ledger returned **8 events → `verified`**, so
  `events_found: 8 (EXACT)`, exit `0`.

Same tool, same RPC, two different and **honest** verdicts. That is the point.

## What an integrity audit is (and is not)

| | |
|---|---|
| **Is** | a record of which ledger ranges were queried, what each returned, and which of them can be **proven** |
| **Is** | a deterministic sha256 over a **fully specified canonical byte string**, so a third party can recompute it |
| **Is** | tamper-**evident**: editing any field of any window changes the digest |
| **Is not** | a claim that an event set is complete — it never makes that claim |
| **Is not** | a re-execution of the walk — the digest proves the **record** is unchanged, not that the RPC answers the same way today |
| **Is not** | a signature — the digest is content-addressed, **not** identity-attested |

## The four window states

A window is exactly one of these, and they are never conflated:

| State | Meaning | Provable |
|---|---|---|
| `verified` | queried; returned **fewer** than the observed cap, so the count is exact for this range | **yes** |
| `truncated` | queried; returned **exactly** the cap, and the cursor is not honoured → the count is a **lower bound** | no |
| `errored` | the RPC returned an error; **nothing** is known about this window | no |
| `skipped` | outside retention, or a `--dry-run`; never queried | no |

Only `verified` windows contribute a **provable** event count. Everything else is
reported, never silently folded into a total.

## Usage

```bash
# live audit over whatever the RPC currently retains (clipped automatically)
node audit-cli.mjs --from <ledger> --to <ledger> [--step 9000] [--json]

# offline: no network at all, every window recorded as `skipped`
node audit-cli.mjs --from <ledger> --to <ledger> --dry-run [--json]

# offline: recompute the digest of a saved manifest and compare
node audit-cli.mjs --verify <manifest.json>

node audit-cli.mjs --boundaries
node audit-cli.mjs --help
```

Exit codes: `0` when every window is provable, `1` when any window is not,
`2` when the range lies entirely outside retention or the arguments are invalid.

### Prove the two verdicts yourself

```bash
# EXACT — pick a single recent ledger
node audit-cli.mjs --from 27255600 --to 27255600

# LOWER BOUND — walk the whole retention window
node audit-cli.mjs --from 1 --to 999999999
```

### Round-trip and tamper detection

```bash
node audit-cli.mjs --from <l> --to <l> --json > manifest.json
node audit-cli.mjs --verify manifest.json     # verdict: match

# edit any event count in manifest.json, then:
node audit-cli.mjs --verify manifest.json     # verdict: mismatch
```

A `mismatch` means **the record no longer matches the digest it carries**. It
does **not** mean any specific value is wrong.

## The digest is version-scoped

A digest is always read with a **header** carrying the endpoint, node version and
protocol version. A digest from a different endpoint or node version is reported
as **`not-comparable`**, never as a `mismatch` — because comparing across
versions would be a false signal in both directions.

## Documents

| Document | Contents |
|---|---|
| [`docs/AUDIT-MODEL.md`](docs/AUDIT-MODEL.md) | the four states, the coverage arithmetic, worked examples |
| [`docs/DIGEST-SPEC.md`](docs/DIGEST-SPEC.md) | the canonical byte string, so the digest is reimplementable by hand |
| [`docs/UNVERIFIABLE.md`](docs/UNVERIFIABLE.md) | why a truncated window can never be completed, and what to report instead |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | what was declined and why (signed output, re-execution, storage, Mainnet) |
| [`docs/SOURCES.md`](docs/SOURCES.md) | official documentation and measured RPC facts, with dates |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | exact commands and their observed output |
| [`docs/INDEX.md`](docs/INDEX.md) | index of everything |

## Not claimed

| Not claimed | Why |
|---|---|
| That an event set is complete | Any window at the cap is a lower bound; the audit says so explicitly. |
| That `events_found` is a total | It is `EXACT` only when every window is verified; otherwise it is `LOWER BOUND`. |
| That the digest proves the RPC is unchanged | It proves the **record** is unchanged. |
| That the digest is a signature | It is content-addressed, not identity-attested. |
| That the 100-event cap is a protocol constant | It is an **observed** RPC behaviour and is re-measured on every live run. |
| Anything about Mainnet | No public Soroban RPC exists there (measured; HTTP 503). |
| That Pi Network has adopted, reviewed, or endorsed anything here | Adoption is `not-claimed`. |

## Relationship to `pi-soroban-events`

This repository **extends** [`pi-soroban-events`](https://github.com/aybvip/pi-soroban-events),
which measures what `getEvents` actually returns. The measured semantics — the
100-event cap, the ignored `limit`, the un-honoured `cursor`, `endLedger` being
exclusive, the 120 960-ledger retention — are recorded there and reused here
verbatim in `windows.mjs`, with attribution. This repository adds the audit
layer: coverage classification, the digest, and the verifiable/unverifiable
split.

## Tests

```bash
node test/integrity.test.mjs
```

101 offline checks, no network. They cover the cap boundary, the four states,
coverage arithmetic, digest determinism and tamper-evidence, header scoping,
`not-comparable` handling, rendering, window math, the reimplementable digest
spec, doc/link integrity, and a guard that fails the suite if the repository's
own prose **asserts** a forbidden claim.

## See also

- `pi-soroban-events` — measure the `getEvents` limits this audit builds on
- `pi-contract-simulator` — scope a claim to an endpoint and version, and verify it
- `pi-gap-index` — index of measured gaps with an RFC-ready reference spec
- `pi-app-security-scanner` — static rules anchored to official Pi documentation

## License

MIT. Read-only. No keys. No writes by default.
