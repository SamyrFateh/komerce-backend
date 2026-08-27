# Debt Zero — Gate Findings projection

Date: 2026-08-27

## Objectif

Fermer la dette de projection `docs/GATE_FINDINGS.json` sans modifier le runtime métier.

Le générateur `scripts/gen-gate-findings.js` exige que chacune de ses 18 sources de gate soit attribuable à une feature canonique avant de projeter les findings. Après les lots Canonical récents, sept sources existantes n'étaient plus revendiquées par leurs manifests : un middleware backend et six CSS Boutique.

## Rattachements réconciliés

### Dashboard backend

- `middleware/require-dashboard-global-authority.js` → `dashboard`
- témoin direct déclaré : `tests/unit/require-dashboard-global-authority.test.js`

Le middleware porte `@domain admin-dashboard` et protège l'autorité globale du dashboard ; il ne crée aucune nouvelle frontière métier.

### Boutique

- `public/boutique/css/mobile-cart-convergence.css` → `orders-client` → canonical `orders`
- `public/boutique/css/mobile-catalog-convergence.css` → `catalog`
- `public/boutique/css/mobile-shell-convergence.css` → `platform-ops`
- `public/boutique/css/modal-desktop-density.css` → `modal-product` → canonical `catalog`
- `public/boutique/css/modal-suggestion-card-polish.css` → `recommendations`
- `public/boutique/css/modal-suggestion-filter.css` → `recommendations`

Les trois convergences mobile disposent déjà de témoins homonymes, désormais déclarés dans leurs manifests respectifs.

## Preuve

CI dédiée **Debt Zero Gate Findings closure**, run `33087211034`, exécutée sur le `main` après PR #951 :

- témoins directs backend/Boutique : verts
- registry root : 0 erreur / 0 warning non attribué
- registry Boutique : 0 erreur / 0 warning non attribué
- `GATE_FINDINGS` : **18/18 sources attribuables**
- sources en échec d'attribution : **0**
- fichiers `UNPROJECTABLE` : **0**
- fichiers `MULTI_PROJECTED` : **0**
- findings sans attribution canonique : **0**
- Business Feature Graph régénéré et check vert
- Feature 360 régénéré et check vert
- Feature Guard root et Boutique verts
- Quality Gate vert
- Contract Check vert
- Security 360 freshness vert
- arbre non muté par les gates avant commit de la projection vérifiée

## Non-changement runtime

Ce lot ne modifie :

- aucune route HTTP ;
- aucune requête SQL ;
- aucune mutation métier ;
- aucun CSS ou JavaScript actif ;
- aucune autorité fonctionnelle.

Il réconcilie uniquement la carte d'ownership avec des fichiers qui existaient déjà dans le runtime.
