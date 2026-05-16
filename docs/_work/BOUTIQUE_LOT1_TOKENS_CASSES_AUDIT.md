# Lot 1 — Tokens cassés

**11 corrections, 4 fichiers touchés, 0 risque visuel.**

## Pourquoi

Une migration find-replace `#fff` → `var(--white)` a transformé silencieusement
les hex à 6 chiffres en charabia invalide :

```
#fff8e7  →  var(--white)8e7   ❌ ignoré par le navigateur
#fffbeb  →  var(--white)beb   ❌
#fff4ed  →  var(--white)4ed   ❌
#fff8f8  →  var(--white)8f8   ❌
#fff8ed  →  var(--white)8ed   ❌
#fffdf7  →  var(--white)df7   ❌
```

Résultat : **11 déclarations de couleur ne s'appliquent pas en production**.
Le state actif du rail desktop (`.k-chip.active`, `.k-subchip.active`) et
plusieurs bannières du panier (cash ref, pay helper, partage WhatsApp, fav promo)
tournent sans leur fond crème. C'est probablement pour ça que tu trouvais
le rail "pas fini" sans pouvoir mettre le doigt dessus.

## Ce que fait le patch

### 1. tokens.css — ajoute 5 nouveaux tokens sémantiques

```css
--cream-warm:       #fff8e7;  /* gradient haut — état actif rail desktop */
--cream-pearl:      #fffdf7;  /* gradient bas — état actif rail desktop */
--cream-amber-bg:   #fffbeb;  /* fond bannière cash, badge référence */
--cream-peach:      #fff4ed;  /* fond pay helper coral */
--cream-blush:      #fff8f8;  /* fond hover partage WhatsApp */
```

Note : pour `#fff8ed`, **`--amber-bg` existait déjà** dans tokens.css. Réutilisé.

### 2. boutique-desktop.css — 2 fixes (rail desktop)

- ligne 1012 : `.k-chip.active` → fond gradient `cream-warm` → `cream-pearl`
- ligne 1139 : `.k-subchip.active` → idem

### 3. cart.css — 4 fixes

- ligne 80 : `.k-cart-item.new-item` (animation ajout panier) → `cream-amber-bg`
- ligne 506 : `.k-pay-helper` → `cream-peach`
- ligne 707 : `.k-confirm-cash-ref` (badge ref cash) → `cream-amber-bg`
- ligne 825 : `.k-share-choice:hover` → `cream-blush`

### 4. interactions.css — 3 fixes

- ligne 141 : `.k-confirm-ref-block` → `--amber-bg` (existant)
- ligne 216 : `.k-fav-promo-banner` → `--amber-bg` (existant)
- ligne 427 : `.ck-pay-helper` → `cream-peach`

## Effet visuel attendu

Tu vas voir **apparaître** un fond crème sur :
- l'état actif des chips et sous-chips du rail desktop ✨
- la bannière du nouvel item ajouté au panier
- les helpers de paiement
- le badge de référence cash (page confirmation commande)
- le hover du partage WhatsApp
- la bannière "confirm ref"
- la bannière promo favoris

Aucun élément ne va disparaître ou changer de structure. Le patch **n'ajoute
que des couleurs qui auraient déjà dû être là**.

## Validation

Avant :
```bash
npm run audit:arch
# ❌ I-4 : 11 violations
```

Après :
```bash
npm run audit:arch
# ✅ I-4 : 0 violation
```

Le score `ARCHITECTURE_LIVE.md` passe de :
- Tokens cassés : **11 → 0** ✅

## Application

Option A — appliquer le patch unifié :
```bash
cd /chemin/du/repo/boutique
patch -p0 < PATCH.diff
npm run audit:arch    # doit montrer 0 violation I-4
npm run docs:arch     # régénère LIVE
```

Option B — remplacer les 4 fichiers (plus simple) :
```bash
cp lot1-tokens-cassés/*.css boutique/css/
npm run audit:arch
npm run docs:arch
```

## PR suggérée

```
Branche : fix/lot1-tokens-cassés-cream
Titre  : Lot 1 — Restaure 11 tokens crème cassés par migration find-replace
Body   :
  Le find-replace #fff → var(--white) a invalidé 11 déclarations de
  fond crème (var(--white)8e7 etc.). Ces couleurs ne s'appliquaient
  plus en production.

  Restaure les hex en passant par 5 nouveaux tokens sémantiques
  dans tokens.css. Réutilise --amber-bg là où il existait déjà.

  Validation : npm run audit:arch → I-4 passe de 11 à 0.

  Aucun changement structurel. Aucun risque mobile.
  Effet visible : state actif du rail desktop + 7 bannières du panier
  retrouvent leur fond crème.
```

## Suivant

Une fois mergé, lancer Lot 2 (orphelins) — décision binaire sur 7 fichiers
CSS qui existent sur disque mais ne sont pas bundlés.
