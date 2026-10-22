# Certification fonctionnelle KM / CM / CG / DJ — matrice de preuve (phase 2, état partiel)

Date : 2026-10-22. Périmètre prouvé : PostgreSQL jetable + API réelle (spec E2E). Staging : non lu (voir BLOCKED).
Verdicts : PASS / FAIL / BLOCKED / NOT TESTED. « Validation métier » = en attente tant qu'un humain n'a pas validé.
Les marchés du spec sont des marchés SYNTHÉTIQUES ACTIVE (KMF, XAF, XAF, DJF), jamais les lignes réelles du staging.
L'observation EUR/USD utilisée pour DJ est une FIXTURE NON RÉELLE.

## 1. Préconditions
| # | Précondition | Observé | Preuve | Verdict |
|---|---|---|---|---|
| P1 | SHA déployé = main | `/health/version` = 2fddbc262 = `main` GitHub | curl + API GitHub, 2026-10-22 | PASS |
| P2 | Connectivité PostgreSQL staging | `/health` : db connected, komerce_env=staging | curl | PASS |
| P3 | Migrations 311–316 exécutées sur staging | Non lisible sans accès DB/admin ; un déploiement vert ne le prouve pas | — | BLOCKED |
| P4 | Pas d'identifiant PG obsolète dans le repo/scripts | Seuls des placeholders de fixtures (u:p, x:x) ; services auxiliaires hors repo non vérifiés | grep | PASS (repo) / NOT TESTED (hors repo) |
| P5 | Mutations sur base jetable uniquement | Oui (a2_test local / CI from-scratch) ; aucune écriture staging | — | PASS |

## 2. Marchés réels du staging (états rapportés : CM/CG SUSPENDED, DJ PROVISIONING)
| Marché | Lecture état/droits/relais/tarifs réels | Verdict |
|---|---|---|
| KM, CM, CG, DJ | Aucun accès admin au staging : lecture impossible | BLOCKED |
Le comportement d'un marché non ACTIVE est prouvé en E2E sur un marché synthétique (SUSPENDED → 409 `MARKET_SUSPENDED`, PROVISIONING → 409 `MARKET_NOT_ACTIVE`, autre marché non affecté) — NON rejoué sur les marchés réels (BLOCKED).

## 3. Scénarios prouvés (spec `multi-market.certification` : 29 tests ; `multi-market.cm-cg-isolation` : 7 tests)
| Marché | Processus | Règle | Attendu | Observé | Preuve | Écart | Verdict | Validation |
|---|---|---|---|---|---|---|---|---|
| KM/CM/CG/DJ | Encaissement | Moyen central non autorisé = refus | 409 PAYMENT_MODE_NOT_ALLOWED_FOR_MARKET | idem | certification.e2e | aucun | PASS | en attente |
| CM/CG/DJ | Transport | Hors tarif de vente du marché = refus | 409 MARKET_TRANSPORT_TARIFF_MISSING | idem | certification.e2e | aucun | PASS | en attente |
| KM | Isolation produit | Produit d'un autre marché non achetable (KM autorisé à encaisser) | 409 `market_product_not_exposed` | idem | certification.e2e | aucun | PASS | en attente |
| KM/CM/CG/DJ | Prix → checkout | Prix local actif, snapshot FX figé (origin KMF, market, EUR, jambes) | commande 201, snapshot cohérent | idem ; DJ porte observation + peg | certification.e2e | aucun | PASS | en attente |
| KM/CM/CG/DJ | Paiement | Montant ≠ EUR figé ne confirme pas ; exact confirme une fois ; rejeu sans effet | paid/ordered, 1 transition | idem (contrat intent/commande violé sur montant faux) | certification.e2e | aucun | PASS | en attente |
| KM/CM/CG/DJ | Réception → transport → remise | Écrivain de statut canonique | collected | idem | certification.e2e | réception physique = fixture (`seedPhysicalReceiptForTest`), pas le flux Hub réel | PASS (partiel) | en attente |
| KM/CM/CG/DJ | Réconciliation | EUR et montant marché = autorité FX ; snapshot immuable | égalité ; UPDATE refusé | idem | certification.e2e | aucun | PASS | en attente |
| DJ | FX | Sans observation valable à la date = refus | fx_rate_unavailable | idem (via autorité, `at` ancien) | certification.e2e | refus testé au niveau service, pas via checkout | PASS (partiel) | en attente |
| — | FX | Devise hors autorité (PLN) = refus typé | fx_currency_unsupported | idem | certification.e2e | PLN reste un arbitrage ouvert | PASS | en attente |
| CM | Remboursement | Wallet KMF-only : refus hors KMF | 409 REFUND_WALLET_CURRENCY_UNSUPPORTED | idem (transaction annulée, aucun remboursement appliqué) | certification.e2e + isolation | un remboursement réellement appliqué (Stripe XAF, wallet KM) n'est PAS rejoué : isolation des remboursements NOT TESTED | PASS (refus seul) | en attente |
| CM/CG | Isolation | Autorisation, tarif (+ évolution), prix (total CG identique avant/après changement CM), commandes, relais, snapshots, produit croisé (409 `market_product_not_exposed`) | aucune fuite | idem | cm-cg-isolation.e2e | aucun | PASS | en attente |
| CM/CG | Isolation dashboards | KPI Hub (CM=1, CG=2, cumul=3) et Relais Live filtrés par marché, valeurs non nulles | pas de fuite | idem | cm-cg-isolation.e2e | aucun | PASS | en attente |
| CM | Cycle de vie | SUSPENDED / PROVISIONING refusent le checkout, l'autre marché continue | 409 MARKET_SUSPENDED / MARKET_NOT_ACTIVE | idem | cm-cg-isolation.e2e | marchés synthétiques | PASS | en attente |
| DJ | Gel FX | Nouveau taux EUR/USD ne modifie pas le snapshot figé | snapshot inchangé, reconversion différente | idem | certification.e2e | aucun | PASS | en attente |
| KM/CM/CG/DJ | Coût/marge (parcours nominal) | Aucun prix fournisseur : coût et marge NULL | NULL | idem | certification.e2e | aucun | PASS | en attente |
| KM | Coût/marge | Coût fournisseur manquant = NULL, pas 0 | cost/margin NULL | AVANT correctif : coût 33 KMF (fret seul), marge 99,87 % | certification.e2e + unit | voir A1 | PASS après correctif | en attente |

## 4. Non prouvé
| Sujet | Verdict |
|---|---|
| Parcours amont Sourcing → Raffinerie → Décision de prix (activation via gate économique réel ; ici LOCAL_ACTIVE inséré) | NOT TESTED |
| Douane et clôture financière dans ce parcours | NOT TESTED |
| Coûts réels / estimés / manquants / non applicables (qualification fine) ; marge « réelle » | NOT TESTED (seul NULL vs 0 prouvé) |
| Playwright 1440 / 390 sur écrans déployés et sur instance isolée, captures | NOT TESTED (accès navigateur/staging indisponible ; campagne à produire en PR séparée) |
| Isolation CM/CG : plafonds, habilitations `market_operator` CM→CG, données financières, paiements Stripe/remboursements appliqués | NOT TESTED |
| DJ sans observation au niveau checkout (refus testé au niveau service) ; coût/marge sur marché non-KMF ; snapshot transport KM | NOT TESTED |
| Marchés réels CM/CG SUSPENDED, DJ PROVISIONING | BLOCKED |

## 5. Anomalies
| # | Gravité | Description | Statut |
|---|---|---|---|
| A1 | Haute | Checkout : produit sans `price_aed` ⇒ coût estimé = fret seul (33 KMF) et marge 99,87 %, donnée manquante représentée par zéro | Corrigée dans cette PR (`order-checkout-item-resolution`), test unit + E2E (échoue sans le correctif) |
| A2 | Moyenne | `weight_kg` absent ⇒ poids inventé 0,5 kg dans l'estimation de fret | Ouverte (à arbitrer : coût inconnu) |
| A3 | Moyenne | `orders.cost_estimated_kmf` a `DEFAULT 0` (migration 006) : une commande hors checkout porte 0 au lieu de NULL | Ouverte |
| A4 | Info | Base locale de dev : le registre `schema_migrations` ne liste pas 312–316 alors que le schéma les contient ; relancer le serveur y échoue sur 312. Sans effet en CI from-scratch ni en ordre normal sur staging | Documentée |
| A6 | Moyenne | Coût inconnu affiché 0 : `routes/admin-dashboard.js:520,536` (`COALESCE(...,0)`), `services/pricing-output.js:54,83` (`|| 0`) | Ouverte |
| A7 | Info | Avec A1, tout produit sans coût d'achat AED (offre locale de marché) a un coût estimé NULL : la source du coût doit être qualifiée | Ouverte |
| A5 | Moyenne | Hub C2 : unité perdue après split/merge ; fiche produit à passer par `resolveEffectiveTransportRates` avant tout tarif non-KMF en prod | Ouverte (héritée) |

## 6. Décisions métier requises
Tarifs de vente transport par marché (CM, CG, DJ) avec preuve, procédure tracée de saisie ; première observation EUR/USD à deux personnes (source publiée) ; parité BCD pour DJ ; sort de PLN ; second remboursement de reliquat (contrainte `refunds(order_id, refund_type)`) ; poids manquant et défaut 0 du coût estimé.

## 7. Verdicts (aucun GO commercial)
- Technique : GO conditionnel pour le cœur multi-marché (preuves ci-dessus, revue Opus intégrée), hors éléments NOT TESTED/BLOCKED.
- Staging fonctionnel : NO GO tant que P3 et l'état réel des marchés sont BLOCKED.
- Commercial : NO GO (tarifs, observation FX, validation humaine absents).
