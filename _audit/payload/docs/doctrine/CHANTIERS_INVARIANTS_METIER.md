# Chantiers Invariants Métier — INV-0 → INV-6

> **Version** : 1.2 — 2026-07-05 (v1.1 : dédup + top 17 · v1.2 : kits socle de test intégrés — outillage officiel des tests P0, cliquet en INV-7)
> **Doctrine porteuse** : `docs/doctrine/DOCTRINE_INVARIANTS_METIER.md`
> **Règle de taille** : un chantier = une session (pattern K/ING). Aucune usine à gaz : l'essentiel est de la **déclaration** (relier des tests qui existent déjà à des invariants qui existent déjà), pas de la construction.
> **Non-négociable** : les chantiers ING-1 → ING-5 ne bougent pas d'une ligne. INV les branche.

---

## Vue d'ensemble

| Chantier | Contenu | Livrable de preuve | Dépend de | Taille |
|---|---|---|---|---|
| **INV-0** | Consolidation doctrinale sans doublon + dédup des cartes dupliquées | doctrines cohérentes, 22 → 19 cartes, zéro doublon | rien | ½ session |
| **INV-1** | Format structuré des invariants P0 dans les cartes + générateur de registre | `governance/business-invariants.generated.json` | INV-0 | ½ session |
| **INV-2** | Déclaration des P0 catalogue (branchement ING) | 5 invariants INV-CAT déclarés, sous-gate branchée | INV-1 + ING-4 | ¼ session |
| **INV-3** | P0 moteur économique (dont 2 trous à combler en code) | INV-ECO-1/2/3 blindés | INV-1 | 1 session |
| **INV-4** | P0 commandes / paiements / remboursements / panier partagé / wallet / douane | 8 invariants déclarés + tests d'attaque manquants | INV-1 | 1 session |
| **INV-5** | La gate `gate:business-invariants` | commande qui échoue si un P0 est incomplet | INV-1 | ½ session |
| **INV-6** | Intégration `predeploy` + rapport fondateur | une ligne par domaine, vert/rouge | INV-5 | ¼ session |
| **INV-7** | Outillage : cliquet kits + fixtures de réponses partagées | grep-gate kit + fixtures API générées backend | kits livrés (fait) | ½ session |

INV-2/3/4 sont parallélisables après INV-1. INV-5 peut se coder dès INV-1
(la gate tourne « à vide » puis se remplit).

---

## INV-0 — Consolider les doctrines sans doublon

**But** : trois documents, trois rôles, zéro recouvrement.

- `DOCTRINE_INVARIANTS_METIER.md` (chapeau) : le modèle des 4 membres, la
  hiérarchie des gates, le top 15 P0. **Ne décrit aucun domaine en détail.**
- `DOCTRINE_INGESTION_CATALOGUE.md` : inchangée sur le fond ; ajouter en
  en-tête « chapitre spécialisé de DOCTRINE_INVARIANTS_METIER.md » et
  mapper ses invariants ING-I1…I8 vers les ID INV-CAT (table de
  correspondance en fin de document, 8 lignes).
- `DOCTRINE_CATALOGUE.md`, `DOCTRINE_ECONOMIQUE_KOMERCE.md`, etc. :
  intactes. Le chapeau les référence, ne les réécrit pas.

**Dédup des cartes (découverte audit 2026-07-05, bloquant pour la suite)** :
trois paires de cartes strictement identiques existent — `payment`/`payments`,
`notification`/`notifications`, `wallet`/`wallet-loyalty`. Le socle entier
repose sur « les cartes disent vrai » : deux cartes pour un domaine, c'est
deux vérités en attente de divergence. Supprimer une carte de chaque paire
(garder le nom au pluriel pour payments/notifications, `wallet` pour le
wallet — aligner les références des scripts qui les chargent), et vérifier
`gate:schema` + `feature-registry-check` verts après suppression.

**DoD** : aucune règle n'est énoncée dans deux documents ; 19 cartes, zéro
doublon ; toute règle opérationnelle vit dans la doctrine spécialisée, le
chapeau ne porte que le méta-modèle.

---

## INV-1 — Format structuré + registre généré

**But** : les cartes deviennent machinement exploitables sans casser
l'existant.

**Modifier** (aucun script existant ne casse : le champ `invariants`
accepte désormais `string | object`) :
- `scripts/feature-schema-check.js` : accepter les deux formes ; en
  `--strict --full`, exiger les 4 membres (`id`, `level`, `statement`,
  `owner_file`, `tests`, `alerting`) quand `level === 'P0'`.

**Créer** :
- `scripts/gen-business-invariants.js` : lit `features/*.feature.js`,
  produit `governance/business-invariants.generated.json` (artefact,
  jamais édité à la main — pattern `arch:gen`). Contenu par invariant :
  id, domaine, statement, owner_file, tests, statut calculé
  (fichiers présents ? tests listés existants ?).
- `package.json` : `"invariants:gen": "node scripts/gen-business-invariants.js"`.

**DoD** : `npm run invariants:gen` produit le registre ; les cartes
non migrées restent valides.

---

## INV-2 — Brancher les invariants catalogue (ING)

**But** : le travail ING devient visible dans le registre sans duplication.

**Modifier** `features/catalog.feature.js` : monter au format structuré
les 5 P0 catalogue (INV-CAT-1 → INV-CAT-5), en pointant vers les tests des
chantiers ING (`tests/contract/catalog-normalized-product.contract.test.js`,
fixtures ING-3, tests ING-5). Tant qu'ING n'est pas livré, leur statut
généré est honnêtement `absent` — c'est voulu : le registre dit la vérité,
il ne la maquille pas.

**Déclarer la sous-gate** : `gate:business-invariants` (INV-5) appelle
`gate:catalog-contract` pour tout invariant marqué
`gate: 'catalog-contract'`.

**DoD** : le rapport affiche `catalogue : 1/5 blindé` aujourd'hui, `5/5`
après ING — sans retoucher INV-2.

---

## INV-3 — P0 moteur économique

**But** : le moteur non négociable passe de 1 invariant prose à 3 P0
blindés. Deux demandent du code, pas seulement de la déclaration :

1. **INV-ECO-1 — plancher de sécurité** (trou réel constaté) :
   `services/product-publication-guard.js` ne vérifie que `price_kmf > 0`.
   Ajouter : à la publication (`is_active`/`is_available` → true), si un
   `minimum_safe_price_kmf` est calculable pour le produit et que
   `price_kmf` est en dessous → refus `below_safe_price`, sauf override
   explicite tracé (`alerts` + champ de décision). Test : publication sous
   plancher → refus ; avec override tracé → passe + alerte.
2. **INV-ECO-3 — devise inconnue lève** : déjà codé par ING-5 (chantier
   inchangé) ; ici on le **déclare** dans `economic-engine.feature.js`
   avec ses tests ING-5.
3. **INV-ECO-2 — stratégie versionnée, jamais rétroactive** : test
   existant (`order-cost-snapshot.test.js`) ; ajouter un cas d'attaque
   (changement de matrice tarifaire après création → le snapshot ne bouge
   pas), puis déclarer.

**Modifier** : `features/economic-engine.feature.js` (3 P0 structurés),
`services/product-publication-guard.js`, tests associés.

**DoD** : `économique 3/3 blindé` au rapport.

---

## INV-4 — P0 commandes, paiements, remboursements, panier partagé, wallet, douane

**But** : relier l'existant, ajouter les cas d'attaque manquants. Pour
chaque invariant : (a) déclaration structurée dans la carte, (b) test
d'attaque si le test existant ne couvre que le chemin heureux.

| Invariant | Test existant à relier | Cas d'attaque à ajouter |
|---|---|---|
| INV-ORD-1 (machine de statuts) | tests order-status existants | transition interdite directe → refus ; UPDATE hors machine détecté par grep-gate simple sur `UPDATE orders SET status` hors owner |
| INV-ORD-2 (snapshot figé) | `order-cost-snapshot.test.js` | re-pricing après création → snapshot inchangé |
| INV-ORD-3 (remboursement au payeur) | `admin-order-refund.test.js` | tentative de remboursement vers destinataire ≠ payeur → refus |
| INV-PAY-1 (idempotence webhook) | `confirm-payment-cycle.test.js` | rejeu du même webhook 2× → un seul effet, deuxième tracé no-op |
| INV-REF-1 (jamais deux fois) | `cancel-shared-cart-with-refunds.test.js` | double événement source → un seul remboursement |
| INV-SC-1 (snapshot + wallet) | tests v41 + cancel-shared-cart | annulation avec contribution confirmée → wallet restauré au centime |
| INV-WAL-1 (une fois par événement, jamais négatif) | `wallet-service.test.js` | même événement source rejoué 2× → une seule application ; débit menant à solde négatif sans flag → refus |
| INV-DOU-1 (déclaration instrumentée) | `customs-classification.test.js` | tentative de classification minorant artificiellement la valeur/catégorie → refus ou alerte tracée |

**Outillage imposé** : tous les cas d'attaque s'écrivent avec
`backendTestKit.js` (`invokeHandler` pour les routes,
`makeClient`/`expectTransactionRolledBack` pour l'idempotence et les
transactions) — doctrine §7.

**Modifier** : `features/orders.feature.js`, `payments.feature.js`,
`refunds.feature.js`, `shared-cart.feature.js`, `wallet.feature.js`,
`customs.feature.js` + les fichiers de tests listés.

**DoD** : `commandes 3/3 · paiements 1/1 · remboursements 1/1 ·
panier 1/1 · wallet 1/1 · douane 1/1` au rapport.

---

## INV-5 — La gate `gate:business-invariants`

**But** : la question du fondateur — « mes vérités métier tiennent-elles ? »
— reçoit une réponse par code de sortie.

**Créer** `scripts/gates/business-invariants-gate.js` :
1. `invariants:gen` (registre frais) ;
2. pour chaque P0 : `owner_file` existe · chaque fichier de `tests`
   existe · exécution jest ciblée de ces tests ;
3. appel des sous-gates déclarées (`gate:catalog-contract`) ;
4. sortie : une ligne par domaine + détail des manquants ; `exit 1` au
   premier P0 incomplet ou test rouge.

**`package.json`** :
```json
"gate:business-invariants": "node scripts/gates/business-invariants-gate.js"
```

**DoD** : supprimer un test lié ou casser un invariant fait échouer la
commande — prouvé par un test de la gate elle-même (INV-GOV-1).

---

## INV-6 — Intégration `predeploy` + rapport fondateur

**But** : une seule porte de sortie.

- `scripts/predeploy-gate.js` : ajouter l'étape `gate:business-invariants`
  (bloquante, non exemptable).
- `map:check` : le registre généré alimente la carte (statuts par domaine)
  — lecture seule, pas de logique dupliquée.
- CI : step dédié dans `ci.yml`, à côté du jest unitaire.

**DoD** : impossible de déployer avec un P0 rouge ; le fondateur lit
7 lignes, pas 7 fichiers.

---

## INV-7 — Outillage : cliquet kits + fixtures partagées

**But** : les kits socle (tamponnés, backend exécuté 14/14) servent le
blindage durablement, sans fourche ni dérive.

1. **Cliquet anti-fourche** — `scripts/gates/testkit-ratchet-gate.js` :
   sur les fichiers de test nouveaux/touchés de la PR (même mécanique que
   `touched-files-feature-gate`), refuser toute redéfinition locale de
   `makeReq`/`makeRes`/`makeNext`/`loadView` (grep ciblé) et exiger
   l'import du kit. Les fichiers historiques non touchés sont exempts.
   Branché dans `gate:business-invariants` (étape légère, avant les tests).
2. **Fixtures de réponses partagées** — `tests/fixtures/api-responses/` :
   pour les endpoints consommés par boutique/dashboards (produits,
   commandes, wallet), un fichier JSON par réponse type, **validé par un
   test backend** (la vraie route produit une réponse conforme à la
   fixture). Boutique et dashboards importent ces fixtures dans
   `mockWindowK()`/`makeKmcApi()` au lieu d'inventer leurs formes.
   Anti-dérive : si l'API change, le test backend casse d'abord.
3. **Parcours argent** — 3 tests d'intégration ciblés avec
   `seed-helpers.js` : paiement→commande, annulation→remboursement→wallet,
   rejeu webhook→no-op. Ils portent les ID INV-PAY-1/INV-REF-1/INV-WAL-1
   en complément des tests unitaires d'attaque.

**DoD** : une PR qui réinvente un mock local échoue ; une divergence de
forme API casse côté backend avant de mentir côté front ; le circuit de
l'argent est prouvé de bout en bout.

---

## Ce qu'il faut demander à Sonnet, dans l'ordre

0. **Fait ✅ — kits socle de test** (backend/boutique/dashboards) : tampon
   🟢 2026-07-05, test auth 14/14 exécuté contre le code réel. Committer.
1. **ING-5** (les trois verrous + raw_payload) — ferme les P0 douane/devise
   aujourd'hui, indépendant de tout. Cas d'attaque écrits avec le kit.
2. **INV-0** (consolidation + dédup des 3 paires de cartes) — un socle sur cartes dupliquées est un socle fissuré.
3. **INV-1** (format + générateur) — débloque tout le reste.
4. **ING-1 → ING-4** (contrat, connecteurs, fixtures, sous-gate).
5. **INV-3** (plancher économique — le seul vrai code nouveau hors ING).
6. **INV-2, INV-4, INV-5, INV-6** (déclaration + gate + intégration).
7. **INV-7** (cliquet + fixtures partagées + parcours argent) — peut se
   glisser dès qu'INV-5 existe.

Chaque item est une session bornée, avec DoD et commande de preuve.
