# Plan de certification Hub H1 à H9 (S7, #3998)

Statut : **préparé, non exécuté.** Aucune requête staging tant que #4014 n'est pas fusionnée et déployée.

## Barrière d'exécution
1. `gh api repos/SamyrFateh/komerce-backend/pulls/4014 --jq .merged` doit renvoyer `true`.
2. `GET /health/version` du staging renvoie le SHA de `main` contenant #4014.
3. Ce SHA est écrit dans `scripts/recette/hub-h1-h9-expected-sha.txt` (vide = rien ne s'exécute, verdict NOT_PROVEN).
4. Le workflow `hub-h1-h9-staging-readonly-oracles.yml` (push limité à la branche dédiée) lance `scripts/recette/hub-h1-h9-readonly-oracles.js` : lecture seule (`default_transaction_read_only=on` + `BEGIN READ ONLY`), identité de cible vérifiée, SHA vivant comparé au SHA attendu.

## Oracles SQL (`scripts/recette/sql/hub-h1-h9-readonly.sql`)
Texte identique aux oracles O-HUB de #3944. H1, H3, H4, H5a, H6, H7 : 0 ligne = PASS, sinon FAIL. H2, H5b, H8, H9 : lignes = FAIL_TO_RECONCILE (état légitime possible : rupture avec incident, attente datée). Erreur SQL = NOT_PROVEN, jamais PASS. Le résultat est global staging : une violation historique est rapportée, jamais masquée ; l'attribution à la cohorte Sonnet se fait par les identifiants renvoyés (échantillon borné à 50 lignes).

Exécution : avant le geste (état de référence), après chaque scénario, après le redémarrage (T5).

## Cohorte Sonnet isolée
Fixtures marquées (préfixe de référence `SONNET-H-`, `simulation_scope` du dispositif E2E-HUB-V1), acheteur, produits et relais dédiés. Ne jamais toucher les objets de GPT ni de CLAUDE-PAR. PSP et E7 inactifs, G6 non lancé. Nettoyage sélectif sur les seuls identifiants créés.

## Contention (PostgreSQL réel, deux opérateurs)
| # | Scénario | Constat visé | Attendu | Oracle |
|---|---|---|---|---|
| C1 | Deux répartitions simultanées de la même commande (lot + unitaire, deux sessions) | HB-04 | Un seul jeu de lignes de colis, la seconde attend le verrou puis constate l'existant | H4 |
| C2 | Deux réceptions simultanées, même PO, même variante | HB-07 | Aucune erreur brute, la seconde va sur la ligne suivante ou reçoit un message traduit | H5a, H6 |
| C3 | Confirmation de ligne en parallèle d'une réception | HB-05 | Confirmation sous le reçu refusée ; pas de reliquat fantôme | H5a, H5b |
| C4 | Deux scans identiques de dépôt en sac | placement | Un seul placement actif | H7 |
| C5 | Deux mises en KOM-BOX du même sac | garde `hub_box_bag_link_guard` | Un seul lien, refus lisible | H9 |
Méthode : deux clients `pg` ouverts sur transactions distinctes, barrière de synchronisation (`pg_sleep` interdit côté oracle ; coordination côté test), collecte des codes d'erreur, puis oracles. Le test lui-même n'écrit que dans la cohorte.

## Parcours métier (Chromium réel, staging, SHA confirmé)
| # | Parcours | Preuves exigées |
|---|---|---|
| T1 | Réception complète d'une commande IMPORT : la commande passe `preparation` sans geste manuel et les lignes de colis existent (HB-01, HB-03) | capture, requête HTTP, H1, H3 |
| T2 | Rejeu de la même référence de réception (HB-01) | pas de double effet, H1 |
| T3 | Rupture fournisseur sans reliquat : alerte, traitement de la ligne, reçu réparti (HB-02) | incident visible, H2 |
| T4 | Quarantaine : unité hors reçu pour la complétude, règle de service unique (HB-06) | H5a, H5b |
| T5 | Redémarrage du service entre enregistrement et complétude, puis balayage cron (HB-01) | commande rattrapée, H1 ; redémarrage uniquement si autorisé par le propriétaire |
| T6 | PO manuelle avec et sans variante SKU (HB-11) | refus lisible sans variante, H5a |
| T7 | Sac puis KOM-BOX avec scans, colis déduit de la commande du sac | pas de `HUB_BOX_BAG_PARCEL_ITEMS_MISMATCH`, H9 |
| T8 | Colis fournisseur arrivé sans contenu : tâche « colis à rapprocher » datée sur `/admin/hub` (HB-08) | capture, H8 |
| T9 | Attente de 48 h : surlignage et alerte directrice sans masquer l'attente | capture, H9 (l'ancienneté se prouve par données datées ou horloge de la cohorte, jamais par UPDATE de dates) |
| T10 | File d'attente colis > 3 vers une destination (HB-12) | tâche visible |

Chaque scénario : console navigateur, requêtes réseau, ligne d'audit, état PostgreSQL. Verdict par scénario PASS / FAIL / NOT_PROVEN. Un scénario non joué reste NOT_PROVEN ; aucun PASS global sans les trois pistes (Chromium, SQL, audit).

## Ce qui reste à décider (propriétaire)
Redémarrage staging pour T5 ; ancienneté exacte pour T9 (horloge réelle de 48 h ou jeu de données antérieur légitime) ; fenêtre staging libre (#3900).
