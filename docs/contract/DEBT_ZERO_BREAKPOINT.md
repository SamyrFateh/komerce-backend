# Debt Zero — Breakpoints Boutique

Date : 2026-08-27

## Objectif

Fermer la dette historique `check:breakpoints` sans ajouter de seuil local de remplacement et sans élargir le lot aux drifts de bundles CSS non liés.

## État avant

La baseline `public/boutique/scripts/.breakpoints-baseline.json` contenait deux violations physiques :

- `checkout-vertical-rail.css` → `max:380`
- `shared-list-library-remove.css` → `max:430`

`GATE_FINDINGS` ne projetait qu'un warning agrégé `check:breakpoints`, ce qui masquait le fait qu'il restait deux seuils source.

## Correction Shared Cart

`shared-list-library-remove.css` ne possède plus la géométrie de `.k-library-item-row`.

La géométrie reste exclusivement dans son owner canonique `shared-list-lists-tab.css` :

- grille desktop ;
- repli mobile au breakpoint canonique `max-width: 899px` ;
- le fichier de retrait ne possède plus que le style du bouton `Retirer`.

Le seuil local `430px` est supprimé sans recréer un layout concurrent.

## Correction Checkout

Le seuil local `380px` est supprimé au profit d'une géométrie intrinsèque :

- `.ck-recipient-grid` utilise `repeat(auto-fit, minmax(min(100%, 11.5rem), 1fr))` ;
- le padding horizontal du corps checkout utilise `clamp(12px, 4vw, 18px)` ;
- les overrides narrow redondants sur header / CTA / moyen de paiement sont retirés.

Aucun nouveau breakpoint local n'est introduit.

## Ratchet

La baseline est désormais :

```json
{
  "total": 0,
  "perFile": {}
}
```

## Preuve dédiée

Workflow `Debt Zero breakpoint`, run `33092492845` :

- 2 suites responsive : PASS ;
- 15 tests : PASS ;
- `check:breakpoints` : 0 violation ;
- baseline sauvegardée à 0 puis revérifiée ;
- `check-important` : vert ;
- `check-css-vars` : vert ;
- `check-zindex-contract` : vert ;
- `check-sticky-integrity` : vert ;
- audit architecture Boutique : vert ;
- Boutique Feature Registry : 0 orphelin ;
- Boutique Feature Guard : 0 erreur / 0 warning ;
- `GATE_FINDINGS` : 18/18 sources attribuables, 41 findings, 0 finding breakpoint ;
- Business Graph : 0 error / 0 debt-drift ;
- Feature 360 : 0 violation ;
- Code Quality : vert ;
- Contract : vert ;
- Security 360 freshness : vert.

## Hors périmètre

Ce lot ne rebundle pas l'ensemble de la Boutique : le PR enforcement officiel applique les gates CSS directement aux sources. Un rebuild global faisait apparaître des drifts de bundles préexistants sans rapport avec ce lot ; ils ne sont ni acceptés en baseline ni embarqués ici.
