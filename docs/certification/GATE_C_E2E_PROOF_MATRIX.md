# Gate C — E2E_CERTIFIED real-proof audit

Gate C is frozen at **12 scenarios**: CJ + AliExpress × six full-pipeline modes.

A scenario is REAL only when deterministic evidence crosses the relevant production seams end-to-end. The Gate C contract test alone is not proof.

| Provider | Mode | Initial verdict |
|---|---|---|
| CJ | identical_replay | GAP |
| CJ | reordered_payload | GAP |
| CJ | legitimate_update | GAP |
| CJ | malformed_update | GAP |
| CJ | interruption_resume | GAP |
| CJ | disappearance_return | GAP |
| AliExpress | identical_replay | GAP |
| AliExpress | reordered_payload | GAP |
| AliExpress | legitimate_update | GAP |
| AliExpress | malformed_update | GAP |
| AliExpress | interruption_resume | GAP |
| AliExpress | disappearance_return | GAP |

## Evidence already available below the E2E boundary

Gate A proves the sourcing failure/replay/update seams, including CJ production pagination and persisted candidate identity. Gate B proves the canonical refinery/catalog fail-closed, update, taxonomy, publication and transactional interruption seams.

Those proofs are prerequisites, but they are **not silently promoted into Gate C**. Gate C must demonstrate the composition for each provider and mode.

## Rules

- no live supplier dependency in certification;
- no paid AI;
- use persisted/provider fixtures through real adapters and canonical V2;
- prove exact accounting: no duplicate, no silent loss, no unsafe publication;
- replay/update/resume must preserve supplier and SKU identity;
- malformed input must fail closed;
- disappearance/return must be explicit and reversible.

## Initial verdict

**0/12 are currently claimed REAL at the composed E2E boundary.**

This is deliberately conservative. The next patches close only scenarios that execute the actual CJ/AliExpress → V2 → sourcing → refinery/catalog composition.
