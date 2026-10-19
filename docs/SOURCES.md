# Sources

Every technical statement in this repository traces to one of the following.
Measured facts carry the date and the endpoint they were taken against.

## Official documentation

| ID | Source | URL | Used for |
|---|---|---|---|
| S1 | Pi Network — Soroban / RPC documentation | `https://docs.minepi.com/` | the existence and role of the Soroban RPC surface on Pi |
| S2 | Stellar `getEvents` RPC method reference | `https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents` | the *intended* semantics of `startLedger`, `endLedger`, `cursor`, `limit` and filters, against which the measured behaviour is compared |

Where the official Soroban method reference describes a `cursor`-driven
pagination contract that the Pi testnet RPC does not honour today, the
measurement is stated as measured and the documentation as documented; the
discrepancy is reported, not resolved by assumption.

## Measured RPC facts

All measured on **2026-10-19** against `https://rpc.testnet.minepi.com`
(node `28.0.1`, protocol `28`), by the read-only commands in
[`VERIFICATION.md`](VERIFICATION.md) and in `pi-soroban-events`:

| Fact | Value |
|---|---|
| Events per response (hard cap) | at most **100** |
| `limit` parameter | **ignored** (1, 5, 50, 99, 100, 101 all returned 100) |
| `cursor` | returned, **not honoured**; cannot continue a page |
| `endLedger` | **exclusive** (`[L, L]` → 0 events; `[L, L+1]` → ledger `L`) |
| Wide span | a **100 000**-ledger span succeeded; no ~10 000 cap |
| Retention | **120 960** ledgers (= 7 days at 5 s per ledger) |
| `startLedger` below retention | hard `-32600` error, not an empty array |
| `endLedger` above latest | clamped silently |
| Mainnet Soroban RPC | **not reachable** (HTTP 503) |

## Repositories this one builds on

| Repository | Role |
|---|---|
| [`pi-soroban-events`](https://github.com/aybvip/pi-soroban-events) | measures the `getEvents` limits reused here |
| [`pi-contract-simulator`](https://github.com/aybvip/pi-contract-simulator) | scope a claim to an endpoint and version, and verify it |

## Nothing third-party

No unofficial mirror, fork, blog post or scraped page is used as a source. If a
claim of "Pi did X" cannot be traced to an official URL or a command in this
repository, it is not made.

## Not claimed

This repository does **not** claim that Pi Network has reviewed, adopted or
endorsed it. Adoption is `not-claimed`.
