# Boutique CSS Debt — B2-1 side-cart ownership

The current visual result was preserved: only losing declarations from the earlier  layer were removed. Winning declarations remain in .

- Side-cart conflicts identified before patch: **44**
- Losing declarations transferred out of : **41**
- Cascade baseline: **211 → 170**
- Specificity baseline: **86 → 86**
- Expected side-cart conflicts intentionally left for a separate cross-owner patch: **3** ( background,  justify-content + padding-block)
- New CSS debt keys: **0** (strict guards passed before ratchet save)

 remains the structural desktop side-cart layer.  is the owner of the final visual convergence properties listed in .
