# Mission 2 — Matrice des capacités fournisseurs (champs de catalogue)

Cf. `docs/doctrine/DOCTRINE_CATALOG_CHANGE_INTAKE.md` et `services/catalog-provider-capability-contract.js`
pour le vocabulaire `documented / authorized / implemented / proved`.

**Verdict global, sans ambiguïté** : pour **aucun** fournisseur réel et **aucun** champ,
la chaîne n'est aujourd'hui `authorized` + `proved` en production. Le moteur (décideur +
application) est `implemented` et `proved` **uniquement en PostgreSQL CI jetable, isolé**
(`isolatedFieldSyncProofTest()`, `services/catalog-field-sync-decision.js` et
`services/catalog-stock-sync-decision.js`). Aucune synchronisation automatique, aucune
modification de prix de vente, aucune publication n'est active — c'est un fait vérifiable
dans le code (garde fail-closed par défaut), pas une simple déclaration d'intention.

## Fournisseurs réels connus du système (union actuelle réellement supportée)

D'après `docs/gaps/GAP_SUPPLIER_CONNECTIVITY_ALIGNMENT.md` §"provider / platform" :
`allegro`, `aliexpress`, `cj`, `noon`, `amazon_uae`, `local`, `whatsapp`.
`manual` est explicitement exclu — ce n'est pas un provider (doctrine déjà tranchée).

## Par champ, état réel (pas déclaratif)

| Champ (fait Catalog Change Intake) | Décideur | Écriture | Cible réelle | État pour TOUT provider réel |
|---|---|---|---|---|
| `stock_available` | `catalog-stock-sync-decision.js` (Mission 1) | `catalog-stock-sync-application.js` | `product_skus.stock` (absolu, jamais via `adjustStock`) | `implemented` + `proved` en CI isolée uniquement. `authorized` = **false** pour tous — aucun résolveur d'autorité runtime (`authorityFn`/`reconciliationFn`) n'existe encore ; le décideur échoue fermé (`STOCK_AUTHORITY_NOT_PROVEN`) par construction. |
| `title` | `decideProductTextFieldSync` | `applyProductTextFieldSync` | `products.name`, protégé par `catalog_field_overrides` | `implemented` + `proved` en CI isolée uniquement. `authorized` = **false** pour tous — même garde fail-closed (`FIELD_AUTHORITY_NOT_PROVEN`). |
| `description` | `decideProductTextFieldSync` | `applyProductTextFieldSync` | `products.description`, protégé par `catalog_field_overrides` | Idem `title`. |
| `media` | `decideProductMediaSync` | `applyProductMediaSync` | `products.images`/`image_url`, protégé par lecture de `catalog_field_overrides` (aucune écriture d'override dédiée à ce jour) | Idem. |
| `purchase_price` / `currency` | `decidePurchasePriceSync` | `applyPurchasePriceSync` | **`catalog_field_sync_state` uniquement** — jamais `products.cost_kmf` (moteur économique actif, `services/pricing-output.js`) | Idem, **plus** une frontière structurelle additionnelle : même avec une autorité prouvée demain, ce chemin ne peut techniquement pas toucher le prix de vente — il faudrait un chantier séparé et délibéré pour connecter `catalog_field_sync_state` au moteur économique. |
| `offer_status` | `decideOfferLifecycleFieldSync` | **Aucune** | — | *Decision-only.* Ne retourne jamais `APPLY`. Toujours `REVIEW_REQUIRED` (`PUBLICATION_LINKED_DECISION_ONLY`) une fois l'identité prouvée — la mutation vit dans `services/catalog-promotion/*`, jamais invoqué par ce moteur. |
| `is_active` | `decideOfferLifecycleFieldSync` | **Aucune** | — | Idem `offer_status`. |
| `option_axes` | `decideOfferLifecycleFieldSync` | **Aucune** | — | Idem — risque explicite de recyclage d'identité SKU déjà utilisé par une commande (brief §2.2), jamais couru puisqu'aucune écriture n'existe. |
| `sellable_units` | `decideOfferLifecycleFieldSync` | **Aucune** | — | Idem `option_axes`. |
| `attributes` | — | — | — | **Non implémenté** cette passe. `catalog-change-intake.js` normalise déjà ce fait (contrat commun), mais aucun décideur de champ n'existe encore pour `attributes` — à faire dans un chantier ultérieur, même patron que `title`/`description` si un mécanisme d'autorité de champ est identifié. |

## Ce qui est prouvé, précisément

- **Identité exacte, réutilisée sans modification de sa preuve finale** : `sourcing-catalog-change-sku-identity-proof.js` résout `product_sku_id` **et** `catalog_product_id` à partir du même grain `unit`, quel que soit le champ observé — aucune preuve d'identité parallèle créée.
- **Provenance** : chaque observation porte son fournisseur, son compte, sa méthode, son horodatage (`field_provenance`), inchangé depuis Mission 1, généralisé à tout fait.
- **Autorité** : porte fermée par défaut (`DEFAULT_UNPROVEN_AUTHORITY`), synthétique interdite hors CI PostgreSQL jetable (`SYNTHETIC_PROOF_NOT_ALLOWED`) — même garde que Mission 1.
- **Overrides manuels** : `title`/`description` réutilisent `catalog_field_overrides` existant sans le modifier ; `media` en réutilise la lecture. Une correction manuelle bloque inconditionnellement, quelle que soit la fraîcheur de l'observation.
- **Idempotence** : rejeu de la même observation → `NO_CHANGE`, jamais un second effet (prouvé pour title/description/media/purchase_price).
- **Conflits** : un sujet touché après l'observation (`updated_at` du produit) → `REVIEW_REQUIRED`, jamais un écrasement silencieux d'un mouvement local plus récent.
- **Lecture après écriture** : chaque écriture réelle (title/description/media) et chaque enregistrement de suivi (purchase_price) est relu dans la même transaction avant COMMIT.

## Ce qui reste, sans le déclarer "terminé"

- Aucun résolveur d'autorité provider/account/environment/unit réel n'existe — c'est la même
  limite non levée que Mission 1, qui s'étend mécaniquement à tous les champs de cette passe.
- Aucune route HTTP, webhook ou job ne consomme ce moteur — decision-only en pratique, même
  pour les champs "à écriture réelle" (title/description/media/purchase_price), tant que rien
  n'appelle `persistCatalogChange` en dehors des tests.
- `attributes` n'a aucun décideur de champ à ce jour.
- Aucun essai réel auprès d'un provider n'a été tenté dans cette passe — uniquement des
  données synthétiques sur base PostgreSQL isolée, comme l'exige le brief.
