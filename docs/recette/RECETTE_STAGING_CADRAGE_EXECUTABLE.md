# Recette staging : cadrage exécutable (pour GPT), v3

**Statut.** La cible staging est confirmée et l'inventaire est propre (#2667) : ne pas refaire ces vérifications. Rien n'est installé et rien n'est recetté.

**Règles.**
- Aucun RESET ni purge.
- Aucun remplissage SQL destiné à fabriquer un vert.
- Les coûts de recette sont des **faits simulés du scénario**, jamais des dépenses réelles de l'entreprise.
- Une observation n'est pas une validation, et une CI verte n'est pas une validation métier.
- G1 reste désactivé.

## 0. Décisions intégrées

| # | Décision | Traduction dans ce cadrage |
|---|---|---|
| B1 | « Tout manquant » n'est acceptable qu'en **phase 1 (diagnostic)** | Le livrable final doit contenir au moins une commande à **marge finale calculable**, avec un attendu chiffré indépendamment (§5, E1). Prérequis : lot L1 (saisie manuelle traçable) |
| B2 | Pas d'exclusion générale du hub | Dans le code, `hub` = **Hub VARIABLE causé par le flux** (`cost-types.js`), à distinguer de `hub_structure`, qui est une charge de structure de période, hors commande. Lot L2 : le hub variable n'est applicable que si l'estimation de la commande en contient (`cost_breakdown.landed_relay.hub > 0`), sinon il est non applicable avec motif |
| B3 | La commission relais est saisie par un admin de test, avec la provenance « FICTIF recette » | Lot L3 : un coût réel exige une provenance explicite, propagée à l'allocation et affichée. `updated_by` seul ne suffit plus |
| B5 | Un prix saisi en devise locale teste le prix local, pas la conversion | Ajout du scénario de conversion P5, avec un attendu calculé indépendamment (§4). L'écart éventuel est classé, jamais « lu puis validé » |
| B6 | Mode test Stripe à vérifier avant exécution | Si le mode test n'est pas confirmé, Stripe est **non couvert**. Les scénarios cash ne le remplacent pas |
| Admin | Réutiliser l'admin staging existant | Aucun second administrateur créé. La session ou l'accès est fourni hors du chat |

## 1. Lots livrés (code) — mécanismes à utiliser

- **L2 (#2669, fusionné)** — Hub variable applicable si le parcours ou les opérations canoniques le montrent : une ligne `IMPORT`, une ligne de provenance **inconnue** (NULL = donnée manquante, jamais preuve de non-applicabilité), ou une opération Hub (`orders.hub_preparation_at`). Non applicable (motif affiché) seulement si toutes les lignes sont `LOCAL_STOCK` sans opération Hub. Provenance inconnue ⇒ manquant « applicabilité présumée ». `hub_structure` jamais attendu par commande.
- **L3 (#2670, fusionné)** — `orders.simulation_scope` (NULL = activité réelle ; immuable une fois posé) ; un seul moteur : par défaut, tous les dashboards sélectionnent l'activité réelle ; `?simulation_scope=RCT1` sélectionne ce périmètre seul, libellé « Recette RCT1 — faits simulés ». Agrégats inter-commandes (produit, variance, pilotage marge) : commandes simulées exclues. `provenance` sur allocations et composants ; commission relais réelle = auteur **et** provenance (`updated_by` seul ne suffit plus) ; changer la valeur sans nouvelle provenance l'efface.
- **L1 (#2671, en revue)** — saisie manuelle traçable : `POST /api/admin/costing/orders/:id/manual-costs` `{cost_type, amount_kmf, provenance, reason, idempotency_key, event_date?}` ; correction : `POST …/manual-costs/:type/correct` ; périmètre : `POST /api/admin/costing/orders/:id/simulation-scope` `{scope:'RCT1', reason}`. Types : payment, sourcing, packaging, hub, local_distribution. Ventilation au prorata de la valeur de ligne, total conservé. Refus : coût non applicable (même règle que la complétude), réel automatique déjà présent (pas de double compte), saisie existante (passer par la correction), FICTIF sur commande réelle, non-FICTIF sur commande de recette.

## 2. Conventions

- **Préfixe et identifiants :** `RCT1-` sur toutes les références ; UUID déterministes `5eed1000-…` ; rejeu = 0 écriture.
- **Nature de chaque valeur :**
  - **T** : paramètre ou donnée de test ;
  - **E** : estimation du moteur, à consigner ;
  - **S** : fait simulé du scénario, enregistré comme coût réel avec provenance « FICTIF recette ».
- **Écritures :** services ou routes canoniques uniquement, dans l'ordre simulation, `--apply`, puis rejeu.
- **Exécution :** workflow `[staging-op] recette-install-*`, avec la garde de cible en première étape.
- **Périmètre :** chaque commande RCT1 est rattachée au périmètre `RCT1` (route L3) **avant** toute saisie de coût. Les vérifications sur écran se font avec `?simulation_scope=RCT1` dans l'URL de la page ; sans ce paramètre, les commandes RCT1 ne doivent **pas** apparaître (preuve d'exclusion de l'activité réelle).
- **Hypothèses et attendus :** toute modification légitime d'une hypothèse est écrite ici, puis l'attendu est recalculé indépendamment. Un attendu n'est jamais ajusté au seul résultat observé.

## 3. Acteurs et paramètres

**Comptes :**
- Admin : **l'admin staging existant**, sans création.
- À créer, avec le préfixe RCT1 : market_operator KM / CM / CG, agent_relais KM / CM / CG, agent_hub, agent_transitaire KM, client KM / CM / CG.
- Affectations via `market_operating_assignments` et memberships.
- Attendu : chaque opérateur ne voit que son marché, et un 403 est renvoyé hors périmètre.

**Paramètres :**

| Paramètre | KM | CM | CG | Nature |
|---|---|---|---|---|
| Parité EUR | 491,96775 | 655,957 | 655,957 | documentée, inchangée |
| AED/KMF | 140 | — | — | T |
| Commission relais | 600 KMF | 600 KMF | 600 KMF | T, saisie par l'admin existant via le composant canonique avec `provenance: "FICTIF recette"` (après le scénario F) |
| Relais | RCT1-REL-KM (à créer) | `5eed…0001` | `5eed…0002` | T |

## 4. Produits et prix

| Produit | Type | Classification | Prix | Attendu |
|---|---|---|---|---|
| P1 | importé, 1 kg | classé | **15 000 KMF** (saisie locale) | prix local affiché tel quel |
| P2 | importé, 1 kg | repli « autre » | 25 000 KMF | « Classement non validé », corrigeable |
| P3 | local (LOCAL_STOCK) | classé, sans traduction FR | 6 000 KMF | traduction manquante signalée ; hub variable non applicable pour une commande 100 % P3 sans opération Hub (L2) |
| P4 | importé | classé | sans prix KM ; 20 000 XAF au CM | KM : « non calculable » + conséquence |
| **P5 (conversion)** | importé | classé | **100,00 EUR**, prix calculé par le moteur pour KM et CM | voir ci-dessous |

**Attendus indépendants pour P5** (arrondi à l'unité mineure, demi supérieur) :
- KM : 100 × 491,96775 = 49 196,775 → **49 197 KMF**.
- CM : 100 × 655,957 = 65 595,7 → **65 596 XAF**.

Si l'écran affiche 49 196 KMF, le moteur applique 491,96 : c'est un **écart classé « arbitrage D4 »**, pas une validation.

Ces attendus portent sur la conversion seule. Si le moteur ajoute des marges ou des frais au prix de vente, comparer la **ligne de conversion** de l'explication de prix ; si elle n'est pas exposée, marquer la conversion « non vérifiable » (manque bloquant).

## 5. Scénarios (marché KM, montants en KMF)

**Phase 1, diagnostic : avant L1, L2 et L3**

Les commandes A à H (cash, sauf A, C et D en Stripe si B6 est vérifié) sont jouées aux stades confirmed → collected. Attendu : marge finale calculable pour **0** commande. Les manquants sont listés avec « mécanisme de collecte absent ».

Ce résultat est le **diagnostic de départ**, consigné, et non le livrable.

**Expéditions (S)**

| Expédition | Fret | Port / transitaire | Douane | Colis |
|---|---|---|---|---|
| RCT1-SH1 | 4 000 | 1 000 | **NULL** (déclarée, montant inconnu) | 2 colis de 1 kg |
| RCT1-SH2 | 4 000 | 1 000 | **0 confirmée** | 2 colis de 1 kg |

Chaque colis appartient à une commande différente, d'où une répartition 50/50.

**Phase 2, livrable : après L1, L2 et L3**

**E1 — commande à marge finale calculable**
- Cash relais, 1 × P1, collectée.
- Expédition SH2, aucun frais ni remise, `total_kmf` = 15 000.

| Coût (S) | Mécanisme | Montant |
|---|---|---|
| Achat produit | flux achats | 6 000 |
| Sourcing | L1 | 300 |
| Emballage | L1 | 200 |
| Hub variable | L1, applicable (P1 ligne IMPORT, L2) | 400 |
| Fret | ½ SH2 | 2 000 |
| Port / transitaire | ½ SH2 | 500 |
| Douane | confirmée | 0 |
| Distribution locale | L1 | 300 |
| Relais | L3 | 600 |
| Frais de paiement | — | non applicable (cash) |
| **Total** | | **10 300** |

Attendu E1 : **marge finale 15 000 − 10 300 = 4 700 KMF (31,33 %)**, statut « calculable », tous les coûts marqués « fait simulé (recette) ».

Si le checkout impose des frais ou une remise, le scénario ne remplit plus sa condition : corriger le scénario, ne pas ajuster l'attendu.

**E2 — Stripe** (seulement si B6 est vérifié)
- Mêmes coûts que E1, plus des frais de paiement saisis via L1 : 450.
- Total 10 750 ; attendu **4 250 KMF (28,33 %)**.
- Si B6 n'est pas vérifié : « Stripe non couvert ».

**F — relais sans provenance** (joué avant la saisie L3)
- Coûts identiques à E1, sauf le relais.
- Le relais est manquant, donc la marge n'est **pas** calculable, pour la raison `costs_missing`.

**C — douane inconnue**
- Commande de E1 passée par SH1.
- Douane inconnue : marge **non** calculable (`customs_unknown`), même si tous les autres coûts sont présents.

**G — local P3** (cash, collectée)
- Fret, port et douane : non applicables.
- Hub variable : non applicable (toutes les lignes `LOCAL_STOCK`, aucune opération Hub — L2). **Hypothèse modifiée depuis v2** (« estimé à 0 ») : l'attendu ne change pas, car le hub n'entrait pas dans le total de G. Si la commande G porte une opération Hub ou une ligne de provenance inconnue, le hub devient applicable : saisir un montant FICTIF et recalculer l'attendu avant observation.
- Les autres coûts sont saisis via L1 : achat 3 000, sourcing 150, emballage 100, distribution 300, relais 600, soit un total de 4 150.
- Attendu : **marge 6 000 − 4 150 = 1 850 KMF (30,83 %)**.

**Colis et marchés**
- I1 : colis simple.
- I2 : colis groupé de 2 commandes du même marché, sans double compte.
- I3 : envoi scindé, chaque ligne comptée une fois.
- J : ajout d'une ligne CM dans un colis KM → **409 `MARKET_MISMATCH`**.
- K : les commandes CM et CG sont invisibles pour l'opérateur KM, et leurs montants sont affichés en XAF.

## 6. Résultats attendus par écran (phase 2, périmètre KM, données RCT1)

| Écran | Attendu |
|---|---|
| Control Tower | `final_margin_ready` = 2 (E1, G), ou 3 avec E2 |
| Control Tower | F et C restent incomplètes, avec la raison exacte |
| Finance — tendance | `actual_orders` = 2 (3 avec E2) |
| Finance — marge consolidée | 4 700 + 1 850 = **6 550 KMF** (10 800 avec E2) |
| Finance — commandes récentes | E1 et G `actual` ; F et C `partial_real` ; manquants conformes |
| Commerce — P1 | marge réelle sur E1 uniquement : 4 700 (4 250 de plus avec E2) |
| Commerce — P3 | 1 850 |
| Tous les écrans (avec `?simulation_scope=RCT1`) | bandeau « Recette RCT1 — faits simulés » ; valeurs ci-dessus |
| Tous les écrans (sans paramètre) | **aucune** commande RCT1, aucun coût FICTIF dans les totaux (activité réelle seule) |
| Saisies L1 | refus attendus : hub sur G (`COST_NOT_APPLICABLE`), payment sur une commande cash, ressaisie (`MANUAL_COST_EXISTS`), saisie sans provenance |
| Catalogue | conforme à la §4 ; P5 : attendus indépendants ou écart D4 classé |
| Hub / Opérations | conformes à I1–I3 |
| Recalcul mensuel du mois RCT1 | aucune ligne `hub_structure` par commande ; provision risque `is_actual=false` |

## 7. Ordre d'exécution

1. Vérifier que L1 (#2671) est fusionné et déployé en staging (migration 303 appliquée).
2. Vérification B6 (mode test Stripe).
3. Comptes, sauf l'admin existant ; paramètres ; catalogue, P5 compris.
4. Phase 1 : diagnostic consigné.
5. Phase 2 : rattachement au périmètre RCT1, puis saisies L1 et commission relais (provenance « FICTIF recette »).
6. Rejeu complet : 0 écriture attendue.
7. Inventaire après installation.
8. Parcours sur les vrais écrans avec l'admin existant et les comptes RCT1.
9. Rapport.

## 8. Preuves à livrer

- Rapports d'installation et de rejeu.
- Inventaire après installation.
- Pour chaque ligne de la §6 : capture, valeur lue, valeur attendue, écart.
- Écarts classés en trois catégories : défaut, donnée ou arbitrage.

Sans ces preuves, la recette n'est pas effectuée.

## 9. Limites qui restent explicites

- G1 désactivé.
- Provenance du cash : chaîne de garde partielle ; allocations cash reconstituées et non confirmées.
- D4 (arrondi et taux appliqué) ouvert.
- Commissions relais datées par marché : ouvert.
- Distinction AED référence / appliqué : ouvert.
- Coûts réels de l'entreprise : aucun collecteur automatique. L1 est une saisie manuelle traçable, pas une intégration prestataire.
