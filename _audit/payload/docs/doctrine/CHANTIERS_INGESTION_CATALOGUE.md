# Chantiers d'Ingestion Catalogue — ING-1 → ING-5

> **Version** : 1.0 — 2026-07-04
> **Doctrine porteuse** : `docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md`
> **Origine** : audit ingestion 2026-07-04 (verdict 🟠 ORANGE — 14 cas sales exécutés avec succès contre le code actuel)
> **Règle de taille** : un chantier = une session, pattern des lots K-1…K-5. Aucune refonte : contrat + tests + gate + verrous.
> **Ordre** : ING-5 est indépendant et ferme les risques P0 douane/devise — il peut (doit) passer en premier. ING-1 → ING-4 sont une chaîne.

---

## Vue d'ensemble

| Chantier | Contenu | Ferme les risques | Dépend de | Taille |
|---|---|---|---|---|
| **ING-5** | Trois verrous raffinerie (douane, devise, coût zéro) + persistance `raw_payload` | #3, #4, #5(b), #9 | rien | ½ session |
| **ING-1** | Contrat pivot officiel v1 (schéma JSON + ajv) | #7, #10, #13 | rien | ½ session |
| **ING-2** | Connecteurs stricts (papaparse, zéro défaut inventé, brut intégral) | #1, #2, #5(a), #6, #8, #11 | ING-1 | 1 session |
| **ING-3** | Corpus de fixtures sales + tests de contrat | ING-I7 | ING-2 | ½ session |
| **ING-4** | Gate CI bloquante `gate:catalog-contract` | ING-I4, fausse sécurité | ING-3 | ½ session |

Numéros de risques = table de l'audit 2026-07-04 (reprise en §3 de la doctrine).

---

## ING-5 — Trois verrous raffinerie (À FAIRE EN PREMIER)

**But** : fermer aujourd'hui les portes P0 qui ne demandent aucun contrat.

**Modifications :**

1. `routes/sourcing-scanner.js` — `POST /candidates/:id/import-product` :
   refuser `409` si `c.state === 'rejected'` ou
   `c.scan_result?.sourcing_decision === 'EXCLUDED'`, avec message
   « Candidat exclu (douane/légal) — import interdit, non ré-évaluable ».
2. `routes/sourcing-scanner.js` — `PUT /candidates/:id` : valider
   `body.currency` contre `['AED','EUR','USD','KMF']`, `400` sinon.
3. `services/supplier-catalog-scanner.js` — `convertToKMF()` : `throw`
   sur devise hors whitelist (plus de `return Math.round(v)` par défaut) ;
   `scanCandidate()` : si `purchase_price_kmf` absent ou 0 →
   court-circuit `sourcing_decision='WATCH'`, raison « Prix d'achat
   manquant — décision impossible », sans appel pricing.
4. Migration légère (pattern 098) : `ALTER TABLE sourcing_candidates ADD
   COLUMN IF NOT EXISTS raw_payload jsonb;` + orchestrateur : persister
   `product.raw_payload` dans l'INSERT/UPSERT.

**Tests à ajouter :**
- `tests/unit/sourcing-scanner.test.js` : import d'un candidat `rejected`
  → 409 ; PUT currency `GBP` → 400.
- `tests/unit/supplier-catalog-scanner.test.js` : `convertToKMF(100,'GBP')`
  → throw ; candidat sans prix → `WATCH` + raison, `TEST` impossible.

**Definition of done** : un candidat exclu douane est physiquement
inimportable ; une devise inconnue ne peut plus produire un
`purchase_price_kmf` faux ; aucun `TEST` sur coût zéro ; le brut est en
base.

---

## ING-1 — Contrat pivot officiel v1

**But** : transformer la convention JSDoc en contrat exécutable versionné.

**Créer** `schemas/catalog/normalized-supplier-product.v1.schema.json` :

```jsonc
{
  "$id": "komerce/catalog/normalized-supplier-product/v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["supplier_name", "product_name", "currency", "raw_payload"],
  "properties": {
    "schema_version":      { "const": "1" },
    "supplier_name":       { "type": "string", "minLength": 1 },
    "supplier_product_id": { "type": ["string", "null"], "maxLength": 128 },
    "product_name":        { "type": "string", "minLength": 2, "maxLength": 300 },
    "supplier_category":   { "type": ["string", "null"], "maxLength": 200 },
    "purchase_price":      { "type": ["number", "null"], "exclusiveMinimum": 0, "maximum": 10000000 },
    "currency":            { "enum": ["AED", "EUR", "USD", "KMF"] },
    "image_url":           { "type": ["string", "null"], "format": "uri", "maxLength": 2000 },
    "product_url":         { "type": ["string", "null"], "format": "uri", "maxLength": 2000 },
    "description":         { "type": ["string", "null"], "maxLength": 10000 },
    "stock_available":     { "type": ["integer", "null"], "minimum": 0 },
    "min_order_qty":       { "type": ["integer", "null"], "minimum": 1 },
    "supplier_delay_days": { "type": ["integer", "null"], "minimum": 0, "maximum": 365 },
    "weight_kg":           { "type": ["number", "null"], "exclusiveMinimum": 0, "maximum": 500 },
    "dimensions": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "properties": {
        "l_cm": { "type": "number", "exclusiveMinimum": 0, "maximum": 1000 },
        "w_cm": { "type": "number", "exclusiveMinimum": 0, "maximum": 1000 },
        "h_cm": { "type": "number", "exclusiveMinimum": 0, "maximum": 1000 }
      }
    },
    "raw_payload":         { "type": "object" }
  }
}
```

(Bornes `maximum` prix/poids : brancher sur `business_rules`
`CATALOG_MAX_UNIT_PRICE_KMF` / `CATALOG_MAX_WEIGHT_KG` au chargement si on
veut les rendre arbitrables sans PR — sinon constantes v1, arbitrées à la
v2 du schéma.)

**Modifier** `services/suppliers/normalized-product.js` : ajv compilé au
require (`ajv` + `ajv-formats`, dépendances dev→prod dans `package.json`),
`validateNormalizedProduct()` et `partitionValid()` gardent leur signature
exacte — les connecteurs et l'orchestrateur ne changent pas. Les erreurs
ajv sont traduites en messages lisibles (« weight_kg hors bornes (0, 500] »),
car elles remontent jusqu'à l'écran admin.

**Tests** : `tests/contract/catalog-normalized-product.contract.test.js` —
un `it` par règle du schéma, y compris les cas qui passaient avant : champ
inconnu → invalide ; `raw_payload` absent → invalide ; devise absente →
invalide ; stock −50 → invalide ; poids 25000 → invalide ; dimensions
`{l_cm:"très long"}` → invalide.

**DoD** : les 5 checks manuels sont remplacés par le schéma ; `npm test`
vert ; le contrat a un numéro de version et un fichier propriétaire.

---

## ING-2 — Connecteurs stricts, prêts à tout

**But** : les connecteurs encaissent n'importe quelle source et sortent du
contrat v1 ou du rejet motivé. Politique d'erreur unique : **une valeur
inexploitable rejette la ligne avec raison** — plus jamais trois politiques
mélangées (drop silencieux / rejet / invention).

**`services/suppliers/connectors/csv-connector.js` :**
- Parsing : remplacer le `split()` maison par **papaparse**
  (`skipEmptyLines`, détection séparateur, guillemets RFC-4180,
  multi-lignes). Le commentaire du fichier prévoyait déjà cette bascule.
- Rejet structurel : headers dupliqués → erreur d'import explicite ;
  ligne dont le nombre de cellules ≠ headers → ligne rejetée
  `malformed_row` (papaparse le signale via `errors`).
- `raw_payload` = **la ligne brute intégrale** (toutes colonnes, y compris
  non mappées — c'est ce qui permet à l'éligibilité de matcher un
  `hazmat_class`). Les colonnes non mappées sont en plus comptées et
  remontées dans le résultat (`unmapped_columns: [...]`) pour visibilité.
- Suppression de `currency: (row.currency || 'AED')` → `currency` mappée
  ou ligne invalide (« devise absente — colonne currency requise ou
  csv_mapping.currency »).
- Valeur numérique non parsable (`stock="many"`, `price="abc"`) → ligne
  invalide avec raison, plus de drop du champ. `"120 USD"` dans une
  colonne prix → invalide (regex stricte nombre), pas `120`.
- Dédup SKU intra-fichier : doublon → les lignes suivantes rejetées
  `duplicate_sku_in_file` (la première gagne, mais **bruyamment**).

**`services/suppliers/connectors/manual-connector.js` :**
- Suppression du `|| 'AED'` (le formulaire Dash enverra la devise —
  champ requis côté UI, chantier Dash séparé).
- `item.dimensions` : re-validé champ par champ (nombres > 0), plus
  d'objet libre accepté tel quel.

**Orchestrateur** `catalog-import-orchestrator.js` :
- Seuil fichier malade : si `invalid.length / total >
  CATALOG_IMPORT_MAX_INVALID_PCT` (business_rules, défaut 30) → `400`
  import refusé en bloc, raisons agrégées dans la réponse.
- Réponse d'import enrichie : `{ accepted, rejected, reject_reasons:
  {raison: count}, unmapped_columns }` — la ligne de synthèse que lit le
  fondateur.

**Tests à inverser** dans `tests/unit/csv-connector.test.js` (ils
verrouillent aujourd'hui les failles) : « colonnes inconnues → ignorées
silencieusement » devient « colonnes inconnues → conservées dans
raw_payload + signalées » ; « champ entier invalide → ignoré » devient
« → ligne rejetée avec raison » ; « currency absente → défaut AED » devient
« → ligne rejetée ».

**DoD** : `"Casque, Bluetooth Pro",5000` ressort avec son nom complet et
son prix ; plus aucune devise inventée ; plus aucun drop silencieux ; le
brut intégral voyage jusqu'en base.

---

## ING-3 — Corpus de fixtures sales

**But** : la définition exécutable de « connecteurs prêts à tout ». Le
corpus grandit à chaque incident réel, ne rétrécit jamais (ING-I7).

**Créer** `tests/fixtures/catalog/` :

| Fixture | Contenu | Attendu (`expected/*.json`) |
|---|---|---|
| `dirty-commas-quotes.csv` | virgules dans titres, guillemets internes, cellule multi-ligne | noms intacts, prix intacts, 0 corruption |
| `dirty-currencies.csv` | devise absente, `GBP`, `usd` minuscule, `120 USD` en cellule prix | absente/inconnue → rejet motivé ; `usd` → `USD` |
| `dirty-stock.csv` | `-50`, `many`, `yes`, `12 units`, `12.9` | tous rejetés avec raison, aucun null silencieux |
| `dirty-duplicates.csv` | SKU dupliqués, headers dupliqués (`price,price`), colonnes d'une lettre | doublons SKU rejetés bruyamment ; headers dupliqués → import refusé |
| `dirty-extremes.csv` | poids 0 / 25000, prix 0 / 999999999, titre 500 chars, dimensions 2×90000×1 | tous rejetés (bornes contrat) |
| `dirty-hazmat-hidden.csv` | colonnes non mappées `hazmat_class`, `battery_type`, description keyword-stuffée | colonnes présentes dans `raw_payload`, signalées dans `unmapped_columns` |
| `clean-baseline.csv` | 20 lignes parfaites | 20/20 acceptées (anti-régression : le strict ne doit pas rejeter le propre) |

**Créer** `tests/contract/catalog-dirty-fixtures.contract.test.js` : pour
chaque fixture, rejouer `csvConnector.fetchProducts()` réel et comparer à
l'attendu (compte d'acceptés, raisons de rejet, intégrité des noms/prix).

**DoD** : chaque cas de l'audit 2026-07-04 a sa ligne de fixture ; un
nouveau connecteur ne peut pas être mergé sans passer le corpus.

---

## ING-4 — Gate CI bloquante

**But** : répondre par un code de sortie à la question du fondateur :
*« est-ce qu'un fournisseur sale peut polluer la raffinerie ? »*

**Créer** `scripts/gates/catalog-contract-gate.js` :
- exécute jest sur `tests/contract/` (contrat v1 + fixtures sales) ;
- sortie humaine par fixture : `✔ dirty-currencies.csv : 0 devise inventée`
  / `✘ dirty-stock.csv : stock -50 accepté → GATE FAILED` ;
- `exit 1` au premier sale accepté.

**`package.json`** :

```json
"gate:catalog-contract": "node scripts/gates/catalog-contract-gate.js"
```

**`.github/workflows/ci.yml`** : step dédié après le job jest unitaire,
non contournable (pas dans `governance/test-exemptions.json`).

**DoD** : la gate tourne à chaque PR ; toute régression d'ingestion casse
le build avant d'atteindre `main` ; le fondateur n'a plus à « faire
confiance » — il a un feu rouge/vert.

---

## Après ING-1 → ING-5

L'ingestion est verrouillée au sens du §8 de la doctrine : la raffinerie
(K-3 → K-5 de DOCTRINE_CATALOGUE) peut accélérer sur une base
contractuellement propre. Les connecteurs futurs (API fournisseur,
sources surprenantes) héritent du même régime : schéma v1 + corpus sale +
gate — brancher une nouvelle source devient un exercice borné, pas un
risque.
