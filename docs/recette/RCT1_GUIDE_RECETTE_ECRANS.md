# RCT1 — guide de recette sur écrans réels (desktop + mobile)

Cible : staging Komerce (`komerce-backend-production.up.railway.app`). Compte : **admin staging existant** (identifiants fournis hors chat, jamais ici). Données : toutes préfixées `RCT1`, faits **simulés** ; ne jamais les présenter comme activité réelle.
Vue recette : ouvrir le dashboard canonique avec `?simulation_scope=RCT1` (ex. `/dashboards/canonical/index.html?simulation_scope=RCT1`). **Sans** ce paramètre, aucune commande RCT1 ne doit apparaître.

Chaque ligne : cocher *Observé* (valeur lue à l'écran, jamais recopiée de l'attendu) puis **GO** ou **NO GO**. Un écart reste un écart classé ; une observation n'est pas une validation métier.

## A. Isolation (desktop)
| # | Action | Attendu | Observé | GO/NO GO |
|---|---|---|---|---|
| A1 | Finance, sans `simulation_scope` | 0 commande RCT1 ; activité réelle : 1 commande payée, 25 000 KMF | | |
| A2 | Finance, avec `?simulation_scope=RCT1` | 4 commandes payées (E1, F, C, C2), 60 260 KMF de ventes, marge consolidée **4 765** sur 1 commande « actual » | | |
| A3 | Commerce / dashboards sans scope | aucune ligne RCT1 | | |

## B. Marges (desktop, scope RCT1)
| # | Commande | Attendu | Observé | GO/NO GO |
|---|---|---|---|---|
| B1 | RCT1-E1 | vente 15 065 ; coût réel 10 300 ; marge **4 765** (31,63 %) ; statut *actual* ; coûts marqués « fait simulé » | | |
| B2 | RCT1-F | coûts incomplets : **relais manquant** ; marge non calculable | | |
| B3 | RCT1-C | douane inconnue (SH1 sans montant) : marge non calculable | | |
| B4 | RCT1-C2 | achat, sourcing, emballage, hub manquants : *estimé* seulement | | |
| B5 | RCT1-G | **non installée** tant que la décision P3 (cf. §F) n'est pas prise → marquer « non couvert » | | |

## C. Catalogue (desktop + mobile)
| # | Action | Attendu | Observé | GO/NO GO |
|---|---|---|---|---|
| C1 | P1 en boutique KM | prix local 15 000 KMF affiché tel quel | | |
| C2 | P4 en boutique KM | **pas de prix KM**, non achetable | | |
| C3 | P5 : conversion 100,00 EUR | KMF **49 197** ; XAF **65 596** (49 196 = écart « arbitrage D4 », à classer, pas à valider). Moteur vérifié côté serveur ; l'affichage écran reste à lire. Si la ligne de conversion n'est pas exposée : « non vérifiable » (manque bloquant) | | |
| C4 | P1/P2 classification douane | **Constat** : P1, P2, P3 sont en repli (catégorie « Maison » sans clé douane, catégorie `default` absente) ; le cadrage attendait P1 « classé » → NO GO tant que la correspondance catégorie ↔ clé douane n'est pas décidée par le métier | | |

## D. Opérations (desktop)
| # | Action | Attendu | Observé | GO/NO GO |
|---|---|---|---|---|
| D1 | Expédition RCT1-SH2 | E1 + F groupées ; fret 4 000 réparti 2 000 + 2 000 sans double compte ; douane 0 confirmée ; frais transitaire visibles | | |
| D2 | Expédition RCT1-SH1 | C + C2 ; douane **inconnue** (jamais 0) | | |
| D3 | Colis E1 / F | 1 colis par commande, lignes de colis = lignes de commande | | |
| D4 | I3 (envoi scindé), J, K | **non installés** (J/K exigent CM/CG absents) → « non couvert » | | |

## E. Mobile (même compte, navigateur mobile)
| # | Action | Attendu | Observé | GO/NO GO |
|---|---|---|---|---|
| E1 | Boutique KM : liste + fiche P1 | prix 15 000 KMF lisible, pas de débordement horizontal | | |
| E2 | Dashboard Finance (scope RCT1) | cartes lisibles, marge E1 4 765 visible, navigation utilisable | | |

## F. Décisions métier en attente (bloquent GO global)
1. **P3 à 6 000 KMF** : refusé par le garde marché KM (position « contributive à faible marge de sécurité ») ; aucune couverture démontrable (0 commande réelle mature sur KM, N3 non décisionnel, aucune politique) ; une politique seule ne suffirait pas. Le moteur autorise P3 à partir de **7 000 KMF** (balayage) : G passerait alors à 7 000 de vente et 2 850 de marge (4 150 de coûts). Décision : prix 7 000, ou politique de décision KM avec couverture réelle.
2. **CM/CG absents** : J/K non jouables ; substituer WM = décision métier explicite.
3. **Classification douane** P1 : correspondance catégorie « Maison » ↔ clé douane.
4. **E2** : Stripe test non confirmé → « Stripe non couvert ».
5. D4 (arrondi), commission relais globale 600 (FICTIF), provenance du cash : ouverts.

**Verdict global : GO uniquement si toutes les lignes A, B1–B4, C1–C3, D1–D3, E sont GO et si §F est tranché ; sinon NO GO, avec la liste des lignes en écart.**
