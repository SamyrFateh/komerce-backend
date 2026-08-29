# Boutique CSS Debt — B3 final specificity zero

- Specificity baseline: **1 → 0**
- Cascade baseline: **0 → 0**
- Final state override: `body:where(.modal-open) { position: fixed; }`
- `:where()` contributes zero class specificity; the state rule has the same CSS specificity as base `body` and wins by source order only
- Other `body.modal-open` properties remain unchanged
- Guard fix: `css-specificity-guard.js --save` now persists `{ total: 0, keys: [] }` when no findings remain
- Regression test proves zero-findings save behavior in an isolated temporary workspace

B3 specificity debt is fully repaid: **87 historical → 0 current**.
