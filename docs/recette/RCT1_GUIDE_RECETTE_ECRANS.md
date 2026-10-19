# RCT1 — guide de recette sur écrans réels (desktop + mobile)

Cible : staging Komerce, `https://komerce-backend-production.up.railway.app`. Compte : **admin staging existant** (identifiants fournis hors chat, jamais ici). Toutes les données RCT1 sont des **faits simulés** : ne jamais les présenter comme activité réelle.

**Preuves automatiques vs actions humaines.** Les colonnes *Preuve auto* renvoient à une phase du moteur (issue `[staging-op] rct1-verify` → étape `check.*`) : elles valent preuve technique. Les colonnes *Observé* et les **captures** sont des actions humaines : lire la valeur à l'écran (jamais recopier l'attendu), capturer, puis **GO** ou **NO GO**. Une observation n'est pas une validation métier.

## URLs exactes (vérifiées : HTTP 200, sans captcha)
| Écran | URL |
|---|---|
| Connexion | `/admin/login` |
| Finance, vue recette | `/admin/finance?simulation_scope=RCT1` (sans le paramètre : activité réelle seule) |
| Commerce, vue recette | `/admin/commerce?simulation_scope=RCT1` |
| Opérations (cash, colis) | `/admin/workspaces/operations` |
| Expéditions & Douane | `/admin/workspaces/shipping-customs` |
| Catalogue | `/admin/workspaces/catalog` (rechercher `RCT1`) ; fiche produit `/admin/products/<id>` |
| Hub / Relais | `/admin/hub-live`, `/admin/relais-live` |
| Commande 360 | `/admin/orders/<id>` (`/admin/orders` redirige vers Opérations) |
| Boutique publique | `/boutique/` : **les produits RCT1 n'y sont pas listés** (`/api/products?search=RCT1` → 0, constat) ; leur contrôle se fait côté admin |

## A. Isolation (desktop)
| # | Action | Attendu | Preuve auto | Observé | GO/NO GO |
|---|---|---|---|---|---|
| A1 | Finance **sans** scope | 0 commande RCT1 ; 1 commande réelle payée, 25 000 KMF | `finance-probe` : `rct1_orders_visible = 0` | | |
| A2 | Finance **avec** `?simulation_scope=RCT1` | 5 commandes payées (E1, F, C, C2, I3), 100 390 KMF de ventes, marge consolidée **4 765**, 1 commande « actual » | `finance-probe` | | |
| A3 | Commerce sans scope | aucune ligne RCT1 | idem | | |

## B. Marges (desktop, scope RCT1)
| # | Commande | Attendu | Observé | GO/NO GO |
|---|---|---|---|---|
| B1 | RCT1-E1 | vente 15 065 ; coût réel 10 300 ; marge **4 765** (31,63 %) ; *actual* ; coûts « fait simulé » | | |
| B2 | RCT1-F | **relais manquant** ; marge non calculable | | |
| B3 | RCT1-C | douane inconnue (SH1 sans montant) ; marge non calculable | | |
| B4 | RCT1-C2 | achat, sourcing, emballage, hub manquants : *estimé* seulement | | |
| B5 | RCT1-I3 | 40 130 ; fret réel 5 000 (2 000 + 3 000) ; **partielle** (pas un scénario de marge) | | |
| B6 | RCT1-G | **non installée** (arbitrage P3, §F). Prête : voir §G | | |

## C. Catalogue (desktop + mobile)
| # | Action | Attendu | Preuve auto | Observé | GO/NO GO |
|---|---|---|---|---|---|
| C1 | Fiche P1 (`/admin/products/<id>`) | prix local KM 15 000 KMF ; catégorie Komerce `mariage` (classée) | `check.classification` | | |
| C2 | P2 | prix KM 25 000 ; catégorie `autre` = repli (« non classé ») | idem | | |
| C3 | P3 | catégorie `mariage` ; **pas de prix KM actif** (§F) | idem | | |
| C4 | P4 | **aucun prix KM**, non achetable | `check.P4.no-km-price` | | |
| C5 | P5 : 100,00 EUR | KMF **49 197**, XAF **65 596** ; 49 196 = « arbitrage D4 ». Côté moteur conforme ; **lire la ligne de conversion à l'écran**, sinon « non vérifiable » (manque bloquant) | `check.P5.conversion` | | |

## D. Opérations (desktop)
| # | Action | Attendu | Preuve auto | Observé | GO/NO GO |
|---|---|---|---|---|---|
| D1 | SH2 | E1 + F groupées ; fret 4 000 = 2 000 + 2 000 ; douane 0 confirmée ; frais transitaire | `check.I1-I2.parcels` | | |
| D2 | SH1 | C + C2 ; douane **inconnue** (jamais 0) | | | |
| D3 | I3 : SH3 + SH4 | 2 colis pour RCT1-I3 (1 ligne chacun) ; fret 2 000 (P1) et 3 000 (P2), 1 allocation par ligne, 0 doublon | `check.I3.split` | | |
| D4 | J, K | **non jouables** : CM et CG absents (marchés actifs : KM, WM, YT, ZZ) | `check.JK.markets` | | |

## E. Mobile (même compte)
| # | Action | Attendu | Observé | GO/NO GO |
|---|---|---|---|---|
| E1 | Finance `?simulation_scope=RCT1` | cartes lisibles, marge E1 4 765 visible, pas de défilement horizontal | | |
| E2 | Catalogue `RCT1` : liste + fiche P1 | prix et catégorie lisibles | | |

## F. Arbitrages métier (bloquent le GO global)
1. **P3 à 6 000 KMF — refus du moteur, analyse.** Après reclassement douane (P3 → `mariage`), le moteur donne : coût variable estimé 6 439 KMF > prix 6 000 → `PRICE_BELOW_VARIABLE_COST` (contribution −439). Balayage : 6 500 à 7 500 = « contributive à faible marge » (exige une couverture marché : 0 commande réelle mature, N3 non décisionnel, aucune politique → impossible à démontrer, et les commandes simulées sont désormais exclues du calcul) ; **8 000 = contributive** (plancher sûr 7 990).
   **Origine : ni couverture, ni coût justifié.** L'estimation applique à P3 (LOCAL_STOCK) la chaîne import : fret 1 628 + port 290 + douane 25 = 1 943 KMF, alors que la règle d'applicabilité L2 (utilisée par la finance réelle) les déclare non applicables pour une ligne LOCAL_STOCK. Le moteur de prix ne modélise pas l'origine du stock. Corriger l'estimation = changement du moteur économique : décision explicite requise. Aucune politique de complaisance n'a été créée, le prix canonique n'a pas été modifié.
   Options : (a) arbitrer P3 à ≥ 8 000 (`P3_PRICE=8000`) ; (b) faire modéliser l'origine locale dans l'estimation ; (c) politique de décision KM avec couverture réelle.
2. **CM/CG absents** : J/K non jouables ; substituer WM = décision explicite.
3. **Flag `ORDER_COST_SNAPSHOT_ACTIVE` = `false` sur le service déployé** (lu via `/health/version`). Le moteur RCT1 l'active dans son propre processus (E1 est « actual »), mais toute commande passée par l'interface sur ce service n'aura pas de snapshot de coût estimé et ne sera jamais « actual ». **Action Railway (hors de ma portée) : `ORDER_COST_SNAPSHOT_ACTIVE=true` sur le service staging**, puis relancer `rct1-verify` (`check.deployed-flags`).
4. **E2 (Stripe)** : mode **test** prouvé (`/health/version` → `stripe_mode: test`). Non exécuté : le moteur n'a pas de clé Stripe, et une commande payée par l'interface serait une commande hors périmètre RCT1 (pollue l'activité réelle). Si vous voulez E2 : décision sur le périmètre de l'ordre + action humaine (carte de test).
5. Classification : commandes E1/F/C/C2/I3 passées **avant** la correction gardent des lignes figées « repli » (immuable, doctrine I-DOUANE-1) ; seules les nouvelles lignes sont classées. D4, commission relais globale 600 (FICTIF), provenance du cash : ouverts.

## G. Exécuter G dès l'arbitrage
Ouvrir l'issue `[staging-op] rct1-apply` avec, dans le corps, la ligne `P3_PRICE=<prix arbitré>` (entier), puis `rct1-replay` (0 écriture attendue) et `rct1-verify`. Attendu : vente = prix arbitré, coûts réels 4 150, marge = prix − 4 150, *actual* ; consolidé = 4 765 + cette marge. Prouvé en réplique : prix 7 500 → G 7 500, marge 3 350, consolidé 8 115, rejeu 0 écriture.

**Verdict global : GO uniquement si A, B1–B5, C1–C5, D1–D3, E sont GO et si §F est tranché ; sinon NO GO, avec la liste des lignes en écart.**
