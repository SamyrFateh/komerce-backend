# Boutique CSS Debt — B2-1b side-cart cross-owner closure

The three remaining side-cart cascade conflicts were removed without changing the winning desktop values.

- shared-list-side-cart.css: removed the losing desktop tab background.
- modal-shell.css: removed losing modal cart-slot justify-content and padding-block.
- Winning desktop values remain in side-cart-desktop-polish.css.
- Cascade baseline: **170 → 167**
- Specificity baseline: **86 → 86**
- Side-cart cascade conflicts after this patch: **0**
- New CSS debt keys: **0** (strict guards passed before ratchet save)
