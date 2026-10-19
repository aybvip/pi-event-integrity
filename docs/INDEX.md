# Index

Everything in this repository, in reading order.

## Start here

| File | What it is |
|---|---|
| [`../README.md`](../README.md) | the tool, the two verdicts, and what is not claimed |
| [`../llms.txt`](../llms.txt) | a compact machine-readable summary |

## The model

| Document | Contents |
|---|---|
| [`AUDIT-MODEL.md`](AUDIT-MODEL.md) | the four window states, coverage arithmetic, worked examples |
| [`DIGEST-SPEC.md`](DIGEST-SPEC.md) | the canonical byte string, so the digest is reimplementable by hand |
| [`UNVERIFIABLE.md`](UNVERIFIABLE.md) | why a truncated window can never be completed, and what to report instead |

## Discipline

| Document | Contents |
|---|---|
| [`DECISIONS.md`](DECISIONS.md) | D1–D12, including what was declined and why |
| [`SOURCES.md`](SOURCES.md) | official documentation and measured RPC facts |
| [`VERIFICATION.md`](VERIFICATION.md) | exact commands and their observed output |

## Code

| File | Role |
|---|---|
| `lib.mjs` | the audit model as pure data: claim kinds, states, records, coverage, digest spec, boundaries, fixtures |
| `windows.mjs` | pure window arithmetic and retention math, kept in step with `pi-soroban-events` |
| `audit.mjs` | the integrity engine: coverage audit, sha256 digest, verification verdicts (offline) |
| `render.mjs` | render an audit as text or JSON, with the non-claims attached |
| `audit-cli.mjs` | the CLI: live audit, dry run, offline verify, boundaries, help |
| `test/integrity.test.mjs` | 101 offline checks, including a guard on the repository's own prose |

## Boundaries, at a glance

- It does **not** claim an event set is complete.
- It does **not** claim a total when any window is unprovable — that is a lower bound.
- It does **not** re-execute the walk to verify a digest.
- It does **not** sign anything with a key.
- It does **not** store events or state.
- It does **not** work against Mainnet (no public Soroban RPC; measured HTTP 503).
- It does **not** claim Pi Network has reviewed or endorsed it.
