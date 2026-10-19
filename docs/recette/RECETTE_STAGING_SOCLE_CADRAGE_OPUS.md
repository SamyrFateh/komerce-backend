# Socle intégré de recette staging — cadrage pour Opus

Statut : cadrage à produire par Opus ; installation ensuite par Sonnet via mécanismes canoniques. **Rien n'est installé, aucune recette effectuée.** Toutes les valeurs de test sont FICTIVES, marquées `is_test_data`, jamais transposables en production, jamais présentées comme validées ou réelles.

## Consignes à Opus (mode économie de tokens) — état au 19/10 12:28
- **Acquis, ne pas refaire** : #2667 fusionné par GPT ; cible staging confirmée par la garde d'identité ; inventaire exécuté : aucune ligne legacy suspecte, aucune violation inter-marchés. Les §1 et §2 ci-dessous sont donc de l'historique de contexte : ne pas les rouvrir.
- Relire ce cadrage sans recommencer l'audit. Produire **un seul cadrage exécutable par GPT**, sans récit de l'historique ni compte rendu intermédiaire.
- Concentrer l'effort sur : scénarios (§3.4), données liées (marchés, acteurs, produits, commandes, colis, douane), paramètres (§3.2) et **résultats attendus chiffrés** par écran.
- Distinguer explicitement trois natures pour chaque valeur : **donnée de test** (fictive, taguée), **estimation** (snapshot/imputation), **coût réel justifié** (allocation `is_actual` avec source). Aucune donnée fictive présentée comme réelle ; aucun inconnu présenté comme zéro.
- Ne signaler que les **manques bloquants** et les **arbitrages indispensables** (ex. D4 arrondi EUR/KMF, commissions relais par marché, jeton admin staging pour les écrans authentifiés).
- Objectif : installer un socle cohérent en staging, puis dérouler le parcours sur les vrais écrans. Aucun RESET ; aucune validation métier déduite d'une CI verte ; G1 reste désactivé.

## 0. Contraintes non négociables
- Pas de RESET, purge ni modification/requalification silencieuse de l'historique ; rejeu sans doublons (clés naturelles/identifiants déterministes).
- Écritures uniquement par les services canoniques (checkout, order-status-machine, payment-service, parcel-operations, customs-shipment-service, cost-allocation, pricing-rates, cost-component-admin-service, catalog pipeline). Jamais d'INSERT SQL direct sur des tables métier sauf s'il n'existe aucun service (à justifier par table).
- Un inconnu n'est jamais présenté comme zéro, une estimation jamais comme réel. G1 (`CANONICAL_MARGIN_WRITER_ENABLED`=0) reste désactivé.
- Aucun secret dans le chat ni dans les dépôts.

## 1. Cible et identification (prérequis de toute écriture)
- Le nom de base ne suffit pas. Preuve exigée : empreinte de la base atteinte par `DATABASE_URL` = empreinte publiée par le service déployé (`GET /health`, champ `target`, PR #2665) ET service déclaré `komerce_env=staging`. Script `scripts/recette/target-guard.js`, refus fail-closed.
- Mémoire projet : le service Railway nommé « komerce-backend-production » est en réalité le staging fonctionnel. Le nom ne fait donc pas foi ; seule l'empreinte + `komerce_env` + (optionnel) `EXPECTED_RAILWAY_ENVIRONMENT` font foi.
- Marquage des données de test : tag déterministe (ex. préfixe `RCT-`/champ `is_test_data` ou référence dédiée) permettant de les lister, de les rejouer sans doublon et de les distinguer de toute donnée réelle. Opus fixe la convention.

## 2. Moyen d'exécution
- Seul moyen disposant des accès staging : GitHub Actions (`secrets.RAILWAY_DATABASE_URL`). Déclenchement : issue ouverte par le propriétaire avec titre `[staging-op] <opération>` ou `workflow_dispatch`. Cette session (cloud) n'a ni base, ni jeton admin.
- Workflow lecture seule livré : `staging-recette-readonly.yml` (cible + inventaire). L'installation aura son propre workflow à titre fixe, avec garde de cible en première étape, mode simulation puis `apply`, rapport d'exécution dans les logs.
- Accès minimal manquant éventuel : un jeton/compte admin staging pour les vérifications authentifiées sur les vrais écrans (à fournir comme secret GitHub ou via session navigateur de l'utilisateur), jamais dans le chat.

## 3. Périmètre à cadrer par Opus (livrables du cadrage)
### 3.1 Acteurs, droits, affectations
Rôles existants : client, admin, agent_relais, agent_hub, agent_transitaire, market_operator ; modèle d'affectation : `market_operating_assignments`, `assignment_memberships`, `membership_capabilities`, `assignment_capability_ceiling`, `capability_registry`. Fournir : un compte par rôle utile et par marché (admin central, opérateur KM, CM, CG, agent relais par marché, agent hub, transitaire), capacités attribuées, plafonds, et la matrice « qui voit quel écran » à vérifier. Mots de passe/jetons : jamais dans le dépôt (génération à l'installation, remise hors chat).
### 3.2 Marchés KM / CM / CG et paramètres économiques
Marchés KM (KMF), CM et CG (XAF) ; relais de test existants : `scripts/seed-staging-market-relays.js` (CM, CG), `seed-reference-data.js`. Par marché : devise, parité (XAF 655,957 ; KMF 491,96775 documentées — non modifiées), AED (valeur de test 140, sourcée « fictive »), commission relais par marché (valeur de test, bénéficiaire/unité/événement à expliciter ; défaut global 600 fictif), tarifs de moyens de paiement (estimés vs réels), configuration de paiement par marché. Chaque paramètre : nom, fonction, marché, provenance, statut (documenté / test / manquant) tel qu'affiché par le bandeau C2.
### 3.3 Produits, traductions, classifications, prix
Jeu minimal par marché : ≥ 1 produit classé, 1 produit au repli « autre » non validé (C4 visible et corrigeable), 1 produit sans prix marché (« non calculable »), 1 produit avec traduction FR et un sans, 1 produit local (LOCAL_STOCK, sans douane). Passer par le pipeline canonique catalogue (candidats → publication) ou, à défaut, justifier. Prix : estimation vs publié, devise du marché, conversion et arrondi (D4 reste à arbitrer : ne pas inventer de règle).
### 3.4 Scénarios cohérents à différents stades
Chaque scénario = commande(s) + colis + événements douane + coûts, chiffrés. Matrice minimale (une ligne par cas ; Opus complète) :
| Id | Cas | Stade | Attendu D1 (complétude) | Marge finale |
|---|---|---|---|---|
| A | stripe, importé, 1 ligne | confirmed | paiement manquant ; rien d'autre attendu | non finale (stade) |
| B | cash_relais, importé | preparation | pas de frais prestataire ; packaging/hub manquants | non finale |
| C | importé, événement douane déclaré montant NULL | in_transit | douane inconnue visible | non calculable (douane inconnue) |
| D | importé, douane 0 confirmée | available | douane = zéro confirmé ; relais pas encore attendu | non finale |
| E | collecté, tous coûts attendus présents | collected | complet à son stade | calculable |
| F | collecté, relais sans bénéficiaire/tarif validé | collected | relais non réel | non calculable |
| G | local (LOCAL_STOCK) | collected | pas de douane/fret attendus | selon coûts |
| H | commande avec anciennes lignes `monthly_recalc` | any | lignes exclues, jamais zéro | jamais « complète » à cause d'elles |
| I | colis simple / groupé 2 commandes même marché / scindé | preparation | aucun double compte | — |
| J | tentative de groupage inter-marchés | — | refus `MARKET_MISMATCH` (garde #2660) | — |
Pour chaque cas : montants de vente (KMF/XAF), coûts présents et absents, résultat attendu par écran (Control Tower, Finance, Commerce, Hub, Opérations, Catalogue), chiffré à l'unité.
### 3.5 Parcours neuf sur les vrais écrans
Script de recette pas à pas (opérateur humain + captures) : catalogue (statut prix/coût/devise/marché, bandeau paramètres, classification), mise en vente, commande client (stripe test / cash relais), logistique (colis simple/groupé/scindé, scan), douane (événement, montant, zéro confirmé), Hub/Relais, Finance (tendance, commandes récentes, relais), Control Tower (taux de complétude « coûts attendus présents à leur stade », `final_margin_ready`), Commerce (rentabilité produit). Chaque étape : écran, action, résultat attendu chiffré, preuve (capture, valeur lue, requête).
### 3.6 Preuves à recueillir
Rapport d'installation (créé / déjà en place / ignoré, compteurs), inventaire avant/après (script `inventaire-historique.js`), violations de marché (`findParcelMarketViolations`), captures d'écran authentifiées, valeurs lues vs attendues, journal de rejeu (second run = 0 écriture).

## 4. Limites fonctionnelles à conserver explicites dans le socle
- **G1** désactivé : aucune marge « réelle » écrite par le writer canonique ; la recette ne la présente pas comme validée.
- **Provenance du cash** : la chaîne de garde (destinataires habilités, réception finale vérifiée, allocation reconstituée vs confirmée) est partiellement livrée (P0) ; le socle ne simule pas de clôture financière complète et marque toute allocation cash comme reconstituée/non confirmée.
- Frais de paiement réels, coûts sourcing/packaging réels : pas de producteur → rester « manquants/inconnus ».
- D4 (précision EUR/KMF), commissions relais datées par marché, AED référence vs appliqué : décisions métier ouvertes ; valeurs de test uniquement.
- Groupage inter-marchés refusé par code (#2660), historique existant seulement signalé.

## 5. Découpage proposé de l'installation (Sonnet)
1. Garde de cible + inventaire (livré).
2. Acteurs/droits/affectations (service canonique ou procédure admin existante).
3. Paramètres par marché (initialiseur existant étendu aux commissions par marché et aux moyens de paiement, valeurs de test).
4. Catalogue minimal + classifications + prix.
5. Commandes/colis/douane/coûts par scénario via services canoniques, tag de test, rejeu idempotent.
6. Rapport d'installation + inventaire final + parcours de recette.
