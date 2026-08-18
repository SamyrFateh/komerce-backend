# Doctrine des Invariants Métier Komerce

> **Version** : 1.3 — 2026-07-05 (v1.2 : kits socle · v1.3 : règle de complétion au contact adoptée — 3e cliquet, QUALITY_PYRAMID §3.1)
> **Statut** : document chapeau — consolide l'approche « ingestion catalogue » (DOCTRINE_INGESTION_CATALOGUE.md) et l'approche « invariants métier exécutables » (analyse blindage 2026-07). Ne remplace aucune doctrine spécialisée : il les gouverne.
> **Code porteur** : `features/*.feature.js` (source de vérité des invariants), `scripts/gates/*`, `tests/contract/*`
> **État vérifié au 2026-07-05** : 27 invariants déclarés dans les 6 cartes critiques (economic-engine : 1, catalog : 9, orders : 7, payments : 3, refunds : 1, shared-cart : 6) — **tous en prose, aucun lié à un test, aucun exécuté par une gate**. Trois paires de cartes strictement dupliquées détectées (`payment`/`payments`, `notification`/`notifications`, `wallet`/`wallet-loyalty`) — deux sources de vérité pour un même domaine, à résorber en INV-0. Les gates actuelles (`gate:schema`, `feature-registry-check`) vérifient que le champ `invariants` *existe*, jamais qu'il est *vrai*.
> **Contrainte fondatrice** : le fondateur arbitre la vision et les seuils. La technique tient toute seule ou elle ment. Un invariant qui n'est que documenté est une promesse ; cette doctrine transforme les promesses en verrous.

---

## 1. Phrase de vérité

> **On ne teste pas d'abord des lignes de code, on teste des vérités métier
> qui ne doivent jamais être violées. Un invariant P0 n'existe que s'il a
> quatre membres : une formulation métier, un fichier owner, un test qui
> l'attaque, et une gate qui refuse le merge quand il tombe. Trois membres
> sur quatre, c'est de la documentation — c'est-à-dire rien, sous charge.**

## 2. Verdict de consolidation

Les deux approches sont **complémentaires, avec une couche manquante entre
les deux** :

- La doctrine ingestion couvre en profondeur **une frontière** (données
  fournisseurs → raffinerie) : contrat de forme, cas tordus, gate dédiée.
  Elle est verticale et déjà déclinée en chantiers (ING-1 → ING-5). **Rien
  n'y change.**
- L'approche invariants couvre **toutes les vérités métier** (économique,
  commandes, paiements, remboursements, panier partagé, publication) mais
  horizontalement : elle dit *quoi* protéger, pas *comment* c'est branché.
- La couche manquante : le **lien exécutable** entre les invariants déjà
  écrits dans les cartes features et les tests qui existent déjà. Le repo
  possède les deux bouts (27 invariants en prose d'un côté, des dizaines de
  tests réels de l'autre — `order-cost-snapshot.test.js`,
  `confirm-payment-cycle.test.js`, `cancel-shared-cart-with-refunds.test.js`…)
  **sans jamais les relier**. Ni doublon, ni contradiction : un pont absent.

## 3. Décision d'architecture — pas de deuxième source de vérité

**Les cartes `features/*.feature.js` restent l'unique source de vérité des
invariants.** On ne crée pas de registre `business-invariants.json`
maintenu à la main à côté : il divergerait des cartes en six mois, exactement
la dette que la gouvernance combat.

À la place, on suit le pattern déjà éprouvé du repo (`arch:gen` →
`arch:check`) :

1. les cartes s'enrichissent d'un format structuré pour les invariants P0 ;
2. un registre **généré** (`governance/business-invariants.generated.json`)
   est produit depuis les cartes — artefact de build pour la CI et les
   dashboards, jamais édité à la main ;
3. la gate lit les cartes, pas le registre.

Format cible dans une carte (rétro-compatible : les invariants prose
existants restent valides, seuls les P0 montent au format structuré) :

```js
invariants: [
  'invariant P1/P2 en prose — inchangé',
  {
    id: 'INV-ORD-2',
    level: 'P0',
    statement: 'snapshot de coût figé à la création, jamais recalculé rétroactivement',
    owner_file: 'services/order-cost-snapshot.js',
    tests: ['tests/unit/order-cost-snapshot.test.js'],
    alerting: 'violation runtime → alerts(level=critical, source=invariant_breach)',
  },
],
```

## 4. Les quatre membres d'un invariant P0

| Membre | Exigence | Vérifié par |
|---|---|---|
| **Formulation** | une phrase métier, lisible par le fondateur, sans jargon | revue humaine |
| **Owner** | `owner_file` existe sur disque et appartient au périmètre de la carte | `gate:business-invariants` |
| **Test** | chaque fichier de `tests` existe, est vert, et **attaque** l'invariant (cas tordu inclus), pas seulement le chemin heureux | `gate:business-invariants` (existence + exécution) |
| **Alerting** | une violation en production est bruyante : ligne `alerts` ou log `critical` — jamais un échec silencieux | revue + convention `invariant_breach` |

Un invariant P1/P2 peut rester en prose. Un invariant **P0 incomplet fait
échouer la gate** — c'est le méta-invariant INV-GOV-1.

## 5. Hiérarchie des gates

```txt
npm run predeploy                    ← porte de sortie unique avant GoLive/déploiement
  └── npm run map:check              ← cohérence carte/code (existant)
  └── npm run gate:business-invariants   ← NOUVELLE : lit les cartes,
        │                                  vérifie les 4 membres de chaque P0,
        │                                  exécute leurs tests
        └── npm run gate:catalog-contract ← sous-gate spécialisée (ING-4),
                                            appelée, jamais dupliquée
  └── gates existantes (arch:gate, gate:schema, jest CI) — inchangées
```

`gate:catalog-contract` reste **autonome et appelable seule** (boucle courte
pendant les chantiers ING) *et* devient une sous-gate de
`gate:business-invariants` (vision consolidée). Une seule implémentation,
deux points d'appel.

## 6. Top 17 invariants P0 consolidés — état honnête

Statuts : **blindé** = 4 membres présents et gate-és · **partiel** = test
existant mais lien/gate absents · **absent** = ni test dédié ni verrou code.

| ID | Domaine | Formulation métier | Owner | Test attendu | Statut |
|---|---|---|---|---|---|
| INV-CAT-1 | Catalogue | toute sortie connecteur est du contrat pivot v1 ou un rejet motivé — jamais une donnée devinée | `services/suppliers/normalized-product.js` | `tests/contract/catalog-normalized-product.contract.test.js` (ING-1) | **absent** |
| INV-CAT-2 | Catalogue | une exclusion douane absolue est terminale : aucun clic ne la transforme en produit | `routes/sourcing-scanner.js` | test 409 import-product sur candidat rejected (ING-5) | **absent** |
| INV-CAT-3 | Catalogue | la boutique ne lit que les champs publiés — un champ de cuisine est invisible par défaut | `services/catalog-public-view.js` | `tests/unit/catalog-public-view.test.js` (existe, vert) | **blindé** (à déclarer) |
| INV-CAT-4 | Catalogue | aucune fiche pipeline ne passe `active` sans approbation humaine initiale | `services/catalog-approval.js` | `tests/unit/catalog-approval.test.js` (existe) | partiel |
| INV-CAT-5 | Catalogue | la donnée source fournisseur ne se perd jamais (`raw_payload`, `name_source`) | `services/suppliers/catalog-import-orchestrator.js` | fixture `dirty-hazmat-hidden.csv` (ING-3) | **absent** |
| INV-ECO-1 | Économique | aucun produit publié sous son prix plancher de sécurité sans décision explicite tracée | `services/product-publication-guard.js` | test guard : publish sous `minimum_safe_price_kmf` → refus | **absent** (le guard ne vérifie que prix > 0) |
| INV-ECO-2 | Économique | une stratégie tarifaire est versionnée, jamais appliquée rétroactivement à une commande figée | `services/pricing-engine.js` | `tests/unit/order-cost-snapshot.test.js` (existe) | partiel |
| INV-ECO-3 | Économique | une conversion de devise inconnue lève une erreur — elle ne « fait au mieux » jamais | `services/supplier-catalog-scanner.js` | test `convertToKMF('GBP')` → throw (ING-5) | **absent** |
| INV-ORD-1 | Commandes | toute transition de statut passe par la machine de statuts — aucun UPDATE direct | `services/order-status-machine.js` | test transitions interdites → refus | partiel |
| INV-ORD-2 | Commandes | le snapshot de coût est figé à la création, jamais recalculé | `services/order-cost-snapshot.js` | `tests/unit/order-cost-snapshot.test.js` (existe) | partiel |
| INV-ORD-3 | Commandes | tout remboursement retourne au payeur, jamais au destinataire | `services/refunds*` | `tests/unit/admin-order-refund.test.js` (existe) | partiel |
| INV-PAY-1 | Paiements | idempotence stricte sur tout webhook — rejouer un webhook ne produit jamais un deuxième effet | `middleware/verify-authkey-webhook.js` + services paiement | `tests/unit/confirm-payment-cycle.test.js` (existe) + test rejeu explicite | partiel |
| INV-REF-1 | Remboursements | un remboursement n'est jamais appliqué deux fois pour le même événement source | services refunds | test double-application → refus | partiel |
| INV-SC-1 | Panier partagé | le snapshot est figé après la première contribution payée ; l'annulation restaure le wallet | services shared-cart | `tests/unit/cancel-shared-cart-with-refunds.test.js` + v41 (existent) | partiel |
| INV-WAL-1 | Wallet | le wallet s'applique une seule fois par événement source ; le solde n'est jamais négatif sans flag explicite admin | `services/wallet-service.js` | `tests/unit/wallet-service.test.js` (existe) + cas d'attaque double-application | partiel |
| INV-DOU-1 | Douane | la déclaration douanière est instrumentée, jamais optimisée pour réduire un coût | `services/customs-classification.js` | `tests/unit/customs-classification.test.js` (existe) + cas d'attaque sous-déclaration | partiel |
| INV-GOV-1 | Gouvernance | tout invariant P0 déclaré porte ses 4 membres, vérifiés en CI — sinon le build échoue | `scripts/gates/business-invariants-gate.js` | la gate est son propre test | **absent** |

Lecture froide : **1 blindé, 10 partiels, 6 absents.** Les partiels sont la
bonne nouvelle — les tests existent, il manque 30 lignes de déclaration et
une gate. Les absents sont concentrés sur catalogue-ingestion (couverts par
ING-1 → ING-5, déjà planifiés) et deux trous économiques (INV-ECO-1,
INV-ECO-3).

## 7. Outillage de test — les kits socle au service des invariants

Trois kits socle existent (livraison Sonnet 2026-07-05, tampon 🟢 sur
exécution réelle) : `backendTestKit.js` (makeReq/makeRes/invokeHandler +
ré-export du harnais transactionnel `mock-db.js`), `boutiqueTestKit.js`
(reset d'état `b-store`, mock `window.K`), `dashboardTestKit.js`
(loadView normalisé, mocks KmcApi/KmcFilters).

**Doctrine d'usage — le kit sert le blindage, pas la couverture :**

1. **P0 d'abord.** Tout test d'attaque d'un invariant P0 (chantiers ING/INV)
   s'écrit avec le kit. `expectTransactionRolledBack` est l'outil canonique
   des preuves d'idempotence (INV-PAY-1) et de machine de statuts
   (INV-ORD-1) ; `invokeHandler` celui des verrous de routes (ING-5).
   Un kit qui ne ferait monter que la couverture de lignes sans attaquer
   un P0 finance du confort, pas du blindage.
2. **Cliquet anti-fourche (jamais de migration big-bang).** Tout fichier de
   test **nouveau ou touché** importe du kit ; interdiction d'y redéfinir un
   `makeReq`/`makeRes`/`loadView` local. Les ~238 fichiers historiques se
   résorbent au fil de l'eau — même régime que les invariants prose.
   Vérifié par un grep-gate léger (INV-7), même esprit que le RATCHET
   existant de `feature-schema-check`.
3. **Fixtures de réponses partagées (anti-dérive des mocks).** Les mocks
   `KmcApi`/`window.K` simulent des réponses API : le jour où l'API réelle
   change de forme, ces tests restent verts sur un mensonge. Remède : un
   jeu de fixtures de réponses **généré ou validé côté backend** et consommé
   par boutique/dashboards — une source, trois consommateurs (INV-7).
4. **Vérités de parcours.** Les P0 du circuit de l'argent
   (paiement → commande → remboursement → wallet) se prouvent aussi en
   intégration via `tests/integration/test-harness/seed-helpers.js` —
   3-4 parcours ciblés, pas un framework E2E.
5. **Complétion au contact (3e cliquet, QUALITY_PYRAMID_DOCTRINE §3.1).**
   Quand un fichier ET son test sont touchés dans la même PR, la couverture
   du fichier doit atteindre le seuil cible (100/100 par défaut, overrides
   justifiés dans `governance/coverage-thresholds.json`) — fini la
   couverture partielle stable qui se maquille en « testé ». Hiérarchie
   assumée : les invariants décident **quoi** tester (les vérités), la
   complétion décide **jusqu'où** quand on touche, le kit décide **avec
   quoi**. La complétion ne remplace jamais un test d'attaque : 100 % de
   lignes sur des assertions molles reste un mensonge — le tampon et la
   revue jugent la qualité d'attaque, pas la gate.

## 8. Priorités — ce qui bloque, ce qui attend

- **Bloquant avant GoLive / accélération forte** : les 17 P0 ci-dessus au
  statut *blindé*. Concrètement : chantiers ING-5 puis INV-1 → INV-5
  (l'essentiel du travail est de la déclaration, pas de l'écriture de tests).
- **P1, sans bloquer** : les invariants prose restants des cartes (badge
  suivi, référence lisible, fenêtre 48h panier partagé…) — ils montent au
  format structuré au fil des retouches de leurs features, jamais en big-bang.
- **P2** : enrichir `economic-engine.feature.js` et `refunds.feature.js`,
  anormalement pauvres (1 invariant chacun) pour des moteurs non
  négociables — au fil des prochains chantiers de ces domaines.

## 9. Ce que cette doctrine interdit

- Ne jamais créer un registre d'invariants édité à la main hors des cartes.
- Ne jamais déclarer un invariant P0 sans ses 4 membres.
- Ne jamais faire passer `gate:business-invariants` d'un statut bloquant à
  informatif, ni l'exempter dans `governance/test-exemptions.json`.
- Ne jamais dupliquer une sous-gate spécialisée dans la gate globale : elle
  l'appelle.
- Ne jamais supprimer un invariant P0 sans PR dédiée expliquant pourquoi la
  vérité métier a changé.
- Ne jamais violer un invariant silencieusement en production : la
  convention `invariant_breach` (table `alerts`, level `critical`) est le
  canal unique et obligatoire.
- Ne jamais redéfinir un mock local (`makeReq`/`makeRes`/`loadView`) dans
  un fichier de test nouveau ou touché : le kit socle est le chemin unique.
- Ne jamais lancer une migration big-bang des tests historiques vers les
  kits : le cliquet suffit.

## 10. Définition de « terminé »

Le blindage est posé quand :

1. `npm run gate:business-invariants` existe, échoue si un P0 est incomplet
   ou si son test tombe, et est appelé par `predeploy` ;
2. les 17 P0 du §6 sont au statut *blindé* ;
3. le fondateur peut lire un rapport d'une ligne par domaine :
   `catalogue 5/5 · économique 3/3 · commandes 3/3 · paiements 1/1 ·
   remboursements 1/1 · panier 1/1 · wallet 1/1 · douane 1/1 ·
   gouvernance 1/1` — vert ou rouge,
   rien d'autre à comprendre.

## 11. Séquencement

Voir `CHANTIERS_INVARIANTS_METIER.md` — INV-0 → INV-7. Les chantiers
ING-1 → ING-5 restent inchangés et se branchent tels quels (ING-4 devient
la première sous-gate appelée).
