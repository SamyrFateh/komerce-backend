# LOT 4E — Sourcing Workspace Canonical

## Mission

Le Sourcing Workspace est la surface d’action centrale pour transformer une opportunité fournisseur en candidat qualifié, puis en brouillon catalogue quand la décision humaine est prise.

Doctrine :

> Dashboard observe. Workspace agit. Entity 360 explique.

Le Workspace orchestre deux autorités historiques homonymes sans les fusionner :

- lifecycle des `sourcing_candidates` : feature `sourcing` ;
- métadonnées rail/marge des produits déjà au catalogue : autorités `economic-engine` / `catalog` existantes.

## Surface stable

- HTML : `GET /admin/workspaces/sourcing`
- alias build : `/admin-next/workspaces/sourcing`
- API : `/api/admin/workspaces/sourcing`

Legacy reste disponible pendant la preuve :

- `/admin/sourcing`
- `/admin/sourcing-scanner`
- `/admin/suppliers`

Aucun cutover destructif dans LOT 4E.

## Sourcing global, pas market-scoped

Le sourcing fournisseur est central. LOT 4E refuse explicitement toute dimension marché envoyée par le navigateur :

- `market_id`
- `marketId`
- `market_code`
- `marketCode`

Le rôle `admin` ne vaut jamais autorité Sourcing globale.

Migration `149_sourcing_workspace_business_refs.sql` crée `sourcing_global_access_grants`, autorité persistée et révocable. Le bootstrap initial conserve la continuité des autorités centrales existantes puis la table devient la source de vérité.

Les rôles admis par le routeur sont `admin` et `sourcing`, mais les deux doivent posséder un grant actif.

## Références métier navigateur

Le navigateur ne manipule aucun UUID interne.

- produit : `product_ref` (`KPR-...`)
- candidat : `candidate_ref` (`KSC-...`)
- batch import : `import_ref` (`KSI-...`)
- partenaire : `partner_ref` (`KPT-...`)

Les champs top-level `id`, `candidate_id`, `product_id`, `partner_id` et `import_id` sont refusés par l’API Canonical.

## Frontière partenaires

`SuppliersView` Legacy administrait plusieurs familles de partenaires. LOT 4E ne reprend pas cette confusion d’autorité.

Le Sourcing Workspace ne lit et ne modifie que :

```text
partner_type = sourcing
```

Transitair​es, relais, partenaires personnalisés et équipes Hub restent hors de cette autorité pendant la migration.

Canonical n’expose aucun hard-delete partenaire. Il expose création, modification, désactivation et réactivation.

## Autorités métier réutilisées

### Portefeuille produit sourcing

Canonical résout `product_ref → products.id` côté serveur puis délègue à `services/sourcing-mutations.js`, qui continue lui-même à déléguer les écritures owner à `catalog-product-mutation-service`.

### Candidats

LOT 4E extrait l’autorité de mutation de `routes/sourcing-scanner.js` dans `services/sourcing-candidate-actions.js` :

- correction ;
- scan ;
- watchlist ;
- rejet ;
- promotion catalogue.

La promotion conserve la transaction existante : création brouillon produit, promotion du contrat normalisé, transition candidat et événement d’audit, puis enrichissement après commit.

### Imports fournisseur

Le dispatch connecteur est partagé via `services/sourcing-import-dispatch.js`.

L’orchestration reste `services/suppliers/catalog-import-orchestrator.js`. Le Workspace ne recode ni normalisation, ni seuils de rejet, ni éligibilité, ni scan pricing.

### Partenaires sourcing

Les mutations partenaires sont extraites dans `services/partner-admin-service.js`, réutilisable par Legacy et Canonical.

## Projection de lecture

`GET /api/admin/workspaces/sourcing`

```json
{
  "scope": { "mode": "global_sourcing" },
  "summary": {},
  "portfolio": {
    "synthesis": {},
    "products": []
  },
  "imports": [],
  "candidates": [],
  "suppliers": [],
  "connectors": {}
}
```

Aucun UUID interne n’est exposé dans cette projection.

## Routes d’action

### Import

- `POST /imports`

### Produit sourcing

- `POST /products/:productRef/update`

### Candidat

- `POST /candidates/:candidateRef/update`
- `POST /candidates/:candidateRef/scan`
- `POST /candidates/:candidateRef/promote`
- `POST /candidates/:candidateRef/watchlist`
- `POST /candidates/:candidateRef/reject`

### Fournisseur sourcing

- `POST /suppliers`
- `POST /suppliers/:partnerRef/update`
- `POST /suppliers/:partnerRef/deactivate`
- `POST /suppliers/:partnerRef/activate`

Toutes exigent session, rôle admis et grant `sourcing_global_access_grants` actif.

## Browser invariants

Le module Canonical :

- appelle uniquement `/api/admin/workspaces/sourcing...` ;
- n’appelle ni `/api/admin/sourcing`, ni `/api/admin/partners` ;
- n’importe pas `SourcingView`, `SourcingScannerView`, `SuppliersView`, `ApiClient` ou `KmcApi` ;
- ne transmet aucun UUID ;
- ne transmet aucune dimension marché ;
- ne recalcule ni pricing, ni normalisation, ni décision d’éligibilité ;
- recharge sa projection après mutation ;
- ouvre Product 360 par `product_ref` pour l’explication détaillée.

## Hors périmètre

LOT 4E ne :

- crée pas de sourcing par pays ;
- supprime pas les vues Legacy ;
- reprend pas le hard-delete partenaire ;
- administre pas les transitaires/relais/agents Hub depuis Sourcing ;
- duplique pas la raffinerie JSON avancée ou les profils d’ingestion dans l’UI V1 ;
- remplace pas Product 360 ;
- fusionne pas les propriétaires `sourcing`, `economic-engine` et `catalog`.

## Vérification de merge

LOT 4E est validé contre le `main` courant avant merge. La branche doit rester à jour et repasser le check requis `Required verdict` conformément à la politique stricte du dépôt ; un verdict obtenu sur une tête devenue obsolète n’est pas utilisé pour contourner cette protection.
