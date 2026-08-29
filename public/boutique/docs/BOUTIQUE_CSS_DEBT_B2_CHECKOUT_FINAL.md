# Boutique CSS Debt — B2-2c final checkout cascade

- Cascade baseline: **86 → 75**
- Checkout cascade conflicts: **11 → 0**
- Losing conflict declarations removed: **11**
- New cascade keys before ratchet save: **0**
- Specificity ratchet: **86, unchanged / strict passed**

Sources consolidated:
- `cart.css`: 8 losing declarations removed;
- `modal-shell.css`: 2 losing `.k-modal-subtotal` declarations removed;
- `checkout-vertical-rail.css`: relay state color split so loading/empty stay muted and error stays coral.

All final winning values are unchanged.
