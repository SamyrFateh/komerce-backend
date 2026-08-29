# Boutique CSS Debt — B2-1 side-cart ownership

The current visual result is preserved: only losing declarations from the earlier `boutique-desktop.css` layer were removed. Winning declarations remain in `side-cart-desktop-polish.css`.

- Side-cart conflicts identified before patch: **44**
- Losing declarations removed from `boutique-desktop.css`: **41**
- Cascade baseline: **211 → 170**
- Specificity baseline: **86 → 86**
- Expected side-cart conflicts intentionally left for a separate cross-owner patch: **3** (`#k-cart-surface-switch.k-cart-tabs` background, `#k-modal .k-modal-cart-slot` justify-content + padding-block)
- New CSS debt keys: **0** (strict guards passed before ratchet save)

`boutique-desktop.css` remains the structural desktop side-cart layer. `side-cart-desktop-polish.css` owns the final visual convergence properties listed in `side-cart-css-ownership.test.js`.
