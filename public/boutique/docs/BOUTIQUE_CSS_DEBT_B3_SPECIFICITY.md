# Boutique CSS Debt — B3-1 same-media specificity

- Specificity baseline: **86 → 43**
- All-physical-pairs same-media keys consolidated: **43**
- Cascade baseline: **0 → 0**
- Premium class lifecycle: additive/permanent; no remove/toggle path observed
- Strategy: premium winning value moved into the latest normal-cascade base owner for the same media; premium property and redundant losing base declarations removed
- New specificity keys before ratchet save: **0**

No winning value changes. Mobile/global rules outside the matching media are untouched.
