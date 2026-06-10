# Lot 1 — Fondation CSS

> Date : 10/06/2026  
> Fichiers modifiés : `css/tokens.css`, `css/components.css`  
> Fichiers non modifiés (lot 1 = CSS uniquement, zéro vue touchée)

---

## tokens.css — Tokens manquants ajoutés

Variables référencées dans plusieurs vues mais absentes du fichier :

| Variable ajoutée | Valeur |
|---|---|
| `--bg-secondary` | `#F1F5F9` |
| `--surface-primary` | alias `--bg-card` |
| `--surface-secondary` | alias `--bg-page` |
| `--border-subtle` | alias `--border-color` |
| `--color-green-600` | alias `--kmc-green` |
| `--color-blue-600` | alias `--kmc-blue` |
| `--color-red-400` | `#F87171` |
| `--color-amber-400` | `#FBBF24` |
| `--kmc-amber-dark` | `#B45309` (hover bouton primary) |

---

## components.css — Système de boutons unifié (Problème 0 audit)

**Cause racine corrigée :** 18 noms de classes bouton différents dans le projet → 1 système.

### Classes de base ajoutées

```
.btn              — base commune (36px min-height, 14px, flex, transitions)
.btn-primary      — amber Komerce, texte navy
.btn-secondary    — fond blanc, bordure grise
.btn-ghost        — transparent, texte secondaire
.btn-danger       — fond rouge clair, texte rouge foncé
.btn-info         — fond bleu clair, texte bleu foncé
.btn-sm           — 28px min-height, 12px
.btn-lg           — 44px min-height, 16px (tactile mobile)
.btn-icon         — carré, centré
```

### Alias rétrocompat (à migrer dans les lots 2–4)

```
.kmc-btn / .kmc-btn-primary / .kmc-btn-secondary / .kmc-btn-ghost
```

Ces alias reproduisent le comportement attendu sans casser l'existant.
Migration progressive : remplacer dans chaque vue lors du passage en lot 2/3.

---

## components.css — Utilitaires ajoutés

| Classe | Usage |
|---|---|
| `.text-truncate` | `overflow:hidden` + ellipsis + nowrap sur conteneurs à largeur fixe |
| `.fs-floor-sm` | Force `--fs-sm` (14px) sur données opérationnelles migrées |
| `.fs-floor-xs` | Force `--fs-xs` (12px) sur labels/headers th migrés |
| `.bg-page / .bg-card / .bg-hover` | Tokens bg en classes utilitaires |
| `.text-primary/secondary/tertiary` | Tokens texte en classes |
| `.text-green/red/orange/blue/amber` | Couleurs statut en classes |

---

## Apps Hub & Relais — Corrections mobiles (Problème 6 audit)

Règles CSS ajoutées dans `components.css` (reporter aussi dans `hub/index.html` et `relais/index.html`) :

| Sélecteur | Avant | Après |
|---|---|---|
| `.card-age` | `font-size: 10px` | `font-size: 11px` |
| `.tab-badge` | `font-size: 10px` | `font-size: 11px` |
| `.info-val` | `font-size: 12px` | `font-size: 13px` + `font-family: var(--font-mono)` |

`.badge` et `.action-btn` étaient déjà corrects — conservés.

---

## Impact immédiat

Toutes les vues qui utilisaient déjà `.btn-primary`, `.kmc-btn-primary`, etc. reçoivent
automatiquement le style unifié. Les 580 styles inline ne sont pas encore migrés —
c'est l'objet des lots 2 et 3.

## Lot suivant : Lot 2 — Typographie et tableaux

Cibles : 19 vues, ~280 occurrences de `font-size < 13px`.  
Priorité : `HubRelaisView`, `AccountingView`, `SourcingScannerView`, `PricingWorkshopView`, `SettingsView`.
