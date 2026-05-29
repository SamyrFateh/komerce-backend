# refactor(group): move group cockpit styles to CSS owner

**Branche** : `refactor/group-owner-css`  
**Date** : 2026-05-28

---

## Fichiers modifiés

| Fichier | Action |
|---|---|
| `css/tokens.css` | +18 tokens alpha groupe (green-alpha-*, coral-bg-*, amber-bg-*, danger, etc.) |
| `css/group-cart-flow.css` | Owner officiel de tous les `.k-group-*` (+1 538 lignes) |
| `css/dist/components.css` | Rebundlé (`npm run bundle:css`) |
| `js/b-group-view.js` | `injectStyles()` → no-op, 3 inline styles → classes CSS (−1 534 lignes) |
| `docs/BOUTIQUE_ARCHITECTURE_LIVE.md` | Régénéré (`npm run audit:arch:live`) |

---

## Résultats des checks

```
npm run bundle:css       ✅  4 bundles OK
npm run audit:arch       ✅  0 violation — Architecture conforme
npm run check:imports    ✅  0 import fantôme / 0 cycle
npm run check:all        ✅  (1 erreur HTML pré-existante #k-cart-whatsapp hors périmètre)
npm run audit:arch:live  ✅  BOUTIQUE_ARCHITECTURE_LIVE.md généré
node --check b-group-view.js   ✅
node --check b-share-cart.js   ✅
node --check b-identity.js     ✅
```

---

## Tokens ajoutés dans `tokens.css`

```css
/* ── Groupe / panier partagé — tokens alpha ── */
--green-alpha-06:   rgba(31,122,84,.06);
--green-alpha-09:   rgba(31,122,84,.09);
--green-alpha-12:   rgba(31,122,84,.12);
--green-alpha-14:   rgba(31,122,84,.14);
--green-alpha-20:   rgba(31,122,84,.20);
--green-alpha-24:   rgba(31,122,84,.24);
--green-alpha-28:   rgba(31,122,84,.28);
--green-text-sett:  #1f7a54;
--coral-bg-09:      rgba(239,125,95,.09);
--coral-bg-12:      rgba(239,125,95,.12);
--coral-bg-18:      rgba(239,125,95,.18);
--coral-bg-38:      rgba(239,125,95,.38);
--amber-bg-08:      rgba(230,130,0,.08);
--amber-bg-12:      rgba(230,130,0,.12);
--amber-border-28:  rgba(230,130,0,.28);
--amber-text-sett:  #b45309;
--violet-bg-light:  #ede7f6;
--danger:           #e53935;
```

---

## Inline styles convertis en classes CSS

| Avant (JS template) | Après |
|---|---|
| `${expSoon ? 'color:#e53935;font-weight:700' : ''}` | `.k-group-share-hint.is-exp-soon` |
| `style="color:#e53935;border-color:#e53935;opacity:.8;width:100%"` | `.k-group-btn--danger` |
| `style="border-color:rgba(230,130,0,.28);background:rgba(230,130,0,.08)"` | `.k-group-funded-callout--gap` |

---

## Multi-owner résiduel connu (hors périmètre)

~~19 sélecteurs `.k-group-*` existent encore dans `cart.css` (legacy PR-0).~~
**✅ Nettoyé** — les 19 sélecteurs `.k-group-*` ont été retirés de `cart.css`.
`group-cart-flow.css` est désormais le seul owner des règles `.k-group-*`.
Les `!important` de `group-cart-flow.css` qui couvraient des conflits de cascade avec `cart.css`
peuvent être revus au prochain chantier CSS (voir `ANALYSE_BOUTIQUE §ARCH-5`).

---

## Points visuels à tester

1. Cockpit créateur desktop >1000px : layout 2 colonnes, margin-top négatif sous header
2. Colonne articles droite : sticky, compact → ultra-compact
3. Mini-guide créateur : 3 cols desktop, 1 col mobile
4. Switcher multi-panier : tab active coral, scroll horizontal
5. Badges phase ouverte (vert) / règlement (amber)
6. Bouton "Annuler le panier" : rouge via `.k-group-btn--danger`
7. Expiration imminente : texte rouge+gras via `.is-exp-soon`
8. Gap non couvert : fond amber via `.k-group-funded-callout--gap`
9. Mobile ≤700px : sous-titre masqué, formulaire condensé
10. Mobile ≤390px : ultra dense
