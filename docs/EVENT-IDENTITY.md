# Event identity

The coverage audit answers *"which ledger ranges can be proven?"*. This layer
answers a different question: *"which **events** did the RPC actually show, and
can two runs be told apart?"*

It exists because coverage alone is not enough to detect a lost or repeated
event. To say anything about a duplicate or a gap, the record needs an **ordering
key** — and the RPC provides one.

## 1. The measured event shape

Measured on **2026-10-19** against `https://rpc.testnet.minepi.com`
(protocol `28`). Every `getEvents` event carries:

```json
{
  "id": "0117041702811729920-0000000000",
  "ledger": 27250895,
  "ledgerClosedAt": "2026-10-19T13:06:20Z",
  "txHash": "b62fbae01fa080f5cf51743a36d132574df30cf24afdc17d55ba321af1a61820",
  "transactionIndex": 0,
  "operationIndex": 0,
  "type": "contract",
  "contractId": "CDG6Z...",
  "topic": ["...", "..."],
  "value": "...",
  "inSuccessfulContractCall": true
}
```

The audit reads only the **ordering and identity** fields. Everything else —
`topic`, `value`, `contractId`, `type`, `inSuccessfulContractCall` — is
explicitly **not interpreted**.

## 2. The id is a global ordering key

The `id` has the form `{TOID}-{index}`:

```
0117041702811729920-0000000000
└────── TOID ──────┘ └ index ┘
```

- the **TOID** (Total Order ID) is a monotonically increasing integer;
- the **index** is the event's position inside its transaction.

Measured properties:

| Property | Measurement |
|---|---|
| TOID monotonic across a page | **yes** (100 of 100 ids in ascending order) |
| distinct ids in one page | **100 of 100** |
| a full page's ledger span | **17 ledgers** for 100 events |
| ledgers missing inside that span | **3** — ledgers with no events |
| overlapping windows share ids | **0** shared ids |

The last row matters: two windows sharing 50 ledgers returned **disjoint** pages.
That is because `endLedger` is exclusive and the page restarts from the window
start. So a repeated id is **not** an expected artefact of overlapping windows —
which is exactly why reporting one is meaningful.

## 3. What the audit reports

For every window that carried event ids, the audit reports:

| Field | Meaning |
|---|---|
| `windowsWithIds` | how many windows carried id evidence |
| `idsExamined` | how many ids were seen in total |
| `idsAnalysed` | whether any statement is possible at all |
| `ordering` | whether the ids were in non-decreasing TOID order |
| `malformedIds` | ids that did not match `{TOID}-{index}` — reported, never mis-parsed |
| `duplicates` | the duplicate finding (see [`GAPS-DUPLICATES-RESUME.md`](GAPS-DUPLICATES-RESUME.md)) |
| `gaps` | the empty-ledger finding (same document) |
| `scope` | a plain sentence naming which windows the findings cover |

## 4. The identity layer is separate from the digest

Identity evidence (`sampleIds`, `sampleLedgers`) is **not** part of the coverage
digest's canonical string. This is deliberate:

- the digest answers *"is this coverage record unchanged?"*;
- the identity layer answers *"which events were seen?"*.

Keeping them apart means the two can be verified independently. The test suite
asserts that adding identity evidence does **not** change the coverage digest.

## 5. Not claimed

- The audit does **not** claim an event set is complete.
- The audit does **not** claim that a duplicate does not exist — only whether one
  was **observed**.
- The audit does **not** interpret `topic` or `value`; it reads identity fields.
- The audit does **not** treat a ledger with no events as an error.
