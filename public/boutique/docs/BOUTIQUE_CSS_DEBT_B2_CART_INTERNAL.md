# Boutique CSS Debt — B2-2b cart internal cascade

For exact same selector + media context + property duplicates inside `cart.css`, only declarations before the last winning occurrence were removed.

- Cascade baseline: **124 → 86**
- Internal semantic keys consolidated: **38**
- Superseded declarations removed: **38**
- New cascade keys before ratchet save: **0**
- Specificity ratchet: **unchanged / strict passed**

The final value for every touched property is unchanged: the same last declaration in `cart.css` remains in place.
