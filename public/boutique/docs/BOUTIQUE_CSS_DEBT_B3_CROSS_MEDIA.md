# Boutique CSS Debt — B3-2 cross-media safe specificity

- Specificity baseline: **43 → 8**
- Safe premium keys consolidated: **35** (23 mixed-media + 12 all-different-media)
- Cascade baseline: **0 → 0**
- Strategy: remove the permanent premium prefix at the winner media; delete every pre-existing base declaration for the same selector/property/media (including declarations hidden from the specificity report); preserve different-media base behavior
- Remaining: **7 explicit re-home keys + 1 transient `modal-open` state**

No winning value changes and no mobile/global declarations outside the winner media are removed.
