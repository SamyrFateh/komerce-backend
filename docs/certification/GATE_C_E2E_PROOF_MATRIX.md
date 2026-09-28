# Gate C — E2E_CERTIFIED real-proof matrix

Gate C is frozen at **12 scenarios**: CJ + AliExpress × six composed modes.

| Provider | Mode | Verdict | Production proof |
|---|---|---|---|
| CJ | identical_replay | REAL | `gate-c-provider-composition.test.js`: CJ normalizer → V2 → refinery → promotion validation |
| CJ | reordered_payload | REAL | `gate-c-lifecycle-composition.test.js`: CJ normalizer + SKU reconciliation converges without create/deactivate churn |
| CJ | legitimate_update | REAL | stable product/SKU identity; mutable facts change; promotion remains valid |
| CJ | malformed_update | REAL | canonical V2 rejects malformed update before refinery/promotion |
| CJ | interruption_resume | REAL | checkpoint error does not advance; resume persists same supplier identity |
| CJ | disappearance_return | REAL | explicit full-snapshot archive then real upsert reactivates same identity |
| AliExpress | identical_replay | REAL | `gate-c-provider-composition.test.js`: AliExpress normalizer → V2 → refinery → promotion validation |
| AliExpress | reordered_payload | REAL | `gate-c-lifecycle-composition.test.js`: AliExpress normalizer + SKU reconciliation converges without create/deactivate churn |
| AliExpress | legitimate_update | REAL | stable product/SKU identity; mutable facts change; promotion remains valid |
| AliExpress | malformed_update | REAL | canonical V2 rejects malformed update before refinery/promotion |
| AliExpress | interruption_resume | REAL | checkpoint error does not advance; resume persists same supplier identity |
| AliExpress | disappearance_return | REAL | explicit full-snapshot archive then real upsert reactivates same identity |

## Certification properties

- deterministic provider-shaped fixtures;
- real CJ and AliExpress adapter normalization;
- canonical V2 validation/snapshot;
- real refinery normalization and catalog promotion validation/SKU reconciliation;
- real checkpoint and sourcing-candidate lifecycle semantics;
- no live supplier network and no paid AI;
- malformed input fails closed;
- replay/update/resume preserve source identity;
- disappearance/return is explicit and reversible.

## Final verdict

**12/12 Gate C scenarios are bound to deterministic production seams.**

Gate C is therefore **`E2E_CERTIFIED`** for the current CJ + AliExpress canonical pipeline contract.

Together with the closed Gate A and Gate B proof sets, the frozen certification contract now has production evidence for **18 A + 16 B + 12 C = 46 scenarios**, subject to Gate A's documented current-provider applicability rule for cursor-only behavior.
