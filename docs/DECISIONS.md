# Decisions

Each decision records what was **declined** as much as what was chosen, so the
boundaries of this repository are explicit rather than implied.

## D1 — Extend `pi-soroban-events` rather than duplicate it

**Decision.** This repository reuses the measured `getEvents` semantics from
[`pi-soroban-events`](https://github.com/aybvip/pi-soroban-events) verbatim in
`windows.mjs`, with attribution, and adds only the audit layer.

**Why.** The semantics (cap, ignored `limit`, un-honoured cursor, exclusive
`endLedger`, 120 960-ledger retention) are measured facts that belong in one
place. Duplicating them would create two sources that could drift.

## D2 — `endLedger` is recorded twice per window

**Decision.** Every window record carries the inclusive `end` **and** the
exclusive value actually sent (`endLedgerExclusive`).

**Why.** The exclusive boundary is a measured footgun: `[L, L]` returns nothing.
A record with only one number would be ambiguous to a replayer. Both numbers are
hashed into the digest.

## D3 — No signed output

**Decision declined.** The digest is **not** signed, and there is no key.

**Why.** Signing would require this project to present itself as an authority it
is not. A signature attests *who produced a record*; this tool can only attest
*that a record is unchanged*. The digest is content-addressed, not
identity-attested, and [`DIGEST-SPEC.md`](DIGEST-SPEC.md) says so.

## D4 — The digest is not a re-execution

**Decision.** `--verify` recomputes the digest over the **record** and compares.
It does **not** re-run the walk.

**Why.** Re-running would conflate two different claims: "this record is
unchanged" (which a digest proves) and "the RPC still answers this way" (which
only a live run can show, and which changes as retention slides). Keeping them
apart prevents a stale record from being presented as a live measurement.

## D5 — `not-comparable` is a distinct verdict

**Decision.** When the header's endpoint, node version or protocol version
differs, `verifyDigest` returns `not-comparable`, not `mismatch`.

**Why.** Comparing digests across versions yields a false signal in both
directions. A version change is a change of *scope*, not evidence of tampering.

## D6 — No storage layer

**Decision declined.** The tool does not write a database, an index, or a file,
unless the caller redirects stdout. Manifests are the caller's responsibility.

**Why.** Writing state introduces retention, consistency, and PII questions that
are out of scope. The audit is a value that is printed; what is done with it
belongs elsewhere.

## D7 — A skipped window is never reported as covered

**Decision.** `skipped` windows do not contribute to `ledgersCovered`, and
always appear in `unverifiableRegions`.

**Why.** Counting an unqueried range as covered would be an unbacked claim.
`--dry-run` therefore reports 0% coverage and zero provable events — the truth
about a run that touched nothing.

## D8 — A total is `EXACT` only when every window is provable

**Decision.** `eventsIsLowerBound` is `true` whenever **any** window is
unprovable, and the renderer prints `>=` and `LOWER BOUND` in that case.

**Why.** This is the central honesty rule. One truncated window is enough to make
a total a bound; presenting it as exact would be wrong.

## D9 — Exit codes encode provability

**Decision.** `0` when every window is provable, `1` when any is not, `2` for
invalid input or a fully-out-of-retention range.

**Why.** A CI job can then gate on provability without parsing output. A lower
bound is a legitimate result but must not silently pass a completeness gate.

## D10 — Mainnet is refused, not attempted

**Decision.** The live path targets `rpc.testnet.minepi.com`. No Mainnet
endpoint is offered.

**Why.** No public Soroban RPC was reachable on Mainnet (measured: HTTP 503). An
option that cannot work would be misleading.

## D11 — The repository's own prose is tested

**Decision.** The test suite scans every Markdown file for the forbidden-claim
phrases and fails if one is **asserted** (not negated and not quoted in a
forbidden-claims table).

**Why.** The failure mode this project guards against is over-claiming. The guard
applies to the project's own documentation, not only to its output.

## D12 — No data-flow analysis, no interpretation of event contents

**Decision declined.** The tool counts and hashes. It does not decode event
bodies and does not reason about what the events mean.

**Why.** Interpretation belongs to the caller and would import assumptions this
project cannot measure.
