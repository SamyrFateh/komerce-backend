# G6 — Contrat partagé ChatGPT / Opus avant tests de stress

**État : spécification à exécuter, PAS une certification.** Version **G6-PRE-STRESS-2** (12/11/2026), intégrant les arbitrages propriétaire A1–A8, A2-bis, A2-ter (#3927, commentaire 6828953843). Source : G6 #3754, fournisseur central #3918/#3933, mode manuel #3900. Le protocole comporte **6 scénarios nominaux (M01–M06) et 40 cas limites (N01–N40)**, plus des configurations C01–C05 et des oracles transversaux. Aucun ID n'est renuméroté.

## Règles obligatoires

1. Les deux agents exécutent les **mêmes IDs, mêmes attendus** sur un **même SHA réellement servi** par Railway staging. Ils utilisent des commandes, RUN8, colis et référentiels distincts, jamais une même commande pour deux validations. Tous les résultats portent agent=ChatGPT ou Opus.
2. Sérialiser toute campagne modifiant l'affectation du compte Relais E2E partagé; restaurer la délégation même en cas d'échec. Pas de reset global de staging, pas de fausses attestations humaines.
3. Preuve par scénario : état avant SQL, vrai geste Chromium 1440x900 et rôle, POST/GET réellement observé sans interception métier, état après PostgreSQL indépendant, journal d'audit, effets financiers ou absence d'effets. Capturer SHA, marché, RUN8 et références de tous les objets.
4. Valeurs de verdict : PASS, FAIL, BLOCKED, NOT_PROVEN. Une CI verte pour un sous-geste n'établit pas le PASS d'une chaîne. Un refus attendu n'est PASS qu'avec UI/HTTP/SQL prouvant ZÉRO mutation illicite.
5. Interdits : route.fulfill de succès, écriture SQL de forçage de statut, prix/publication inventés, charges PSP/fournisseur, SMS ou WhatsApp réels. Seul le staging Railway jetable est autorisé.
6. Ordre : **M nominaux → N P0 → N P1 → recette guidée humaine → stress**. Toute chaîne import demeure BLOCKED si source réellement vendable, fournisseur central ou décisions humaines requises font défaut.

## M — Parcours positifs intégraux

| ID | Marché | Geste complet exigé | Oracle de sortie |
|---|---|---|---|
| M01 | KM | Fournisseur réel -> catalogue approuvé -> prix/exposition KM -> vrai panier/boutique/POST commande -> cash simulé -> engagement PO puis autorisation paiement -> réception Hub -> sac/KOM-BOX -> transitaire/douane -> Relais -> remise -> finance | Une filiation source→commande→colis→remise, quantités et coûts sans doubles |
| M02 | KM, CM, CG | Produit LOCAL_STOCK vendable -> vrai achat boutique -> cash test -> mise à disposition Relais -> code canonique saisi au clavier -> remise | Sans Hub, PO ou transport import ; commande, colis et lignes physiques collected |
| M03 | KM | Panier mixte stock local + import, deux branches de traitement, deux retraits possibles | Pas de statut collected tant que les lignes import n'ont pas été remises |
| M04 | CM | M01 avec responsable marché CM, caisse, fournisseur, transitaire et Relais CM | Prix XAF, clients et stocks CM, aucune fuite KM/CG |
| M05 | CG | M01 avec responsable marché CG, caisse, fournisseur, transitaire et Relais CG | Prix XAF, clients et stocks CG, aucune fuite KM/CM |
| M06 | KM | Produit manuel -> Fournisseur central Hub -> vrai achat client -> sourcing physique Hub -> PO deux autorisations -> Hub -> Relais -> remise -> SAV | Produit rattaché au Fournisseur central sans fournisseur inventé ; confirmation refusée sans justificatif (MANUAL_PURCHASE_PROOF_REQUIRED) ni prix (CONFIRMED_PRICE_REQUIRED) ; vendeur réel structuré par achat à la confirmation, jamais central_hub ; rapprochement achats <-> paiement autorisé ; aucun SOI, stock, dette ou paiement fabriqué ; même circuit Hub/Relais canonique |

## N — Comportements métier attendus avant stress

| ID | Cas | Oracle / invariant vérifié |
|---|---|---|
| N01 | Prix non actif | Achat impossible ; aucune commande |
| N02 | Exposition OFF | Produit non achetable, publication non implicite |
| N03 | Marché suspendu / route absente | Refus checkout, aucun paiement |
| N04 | Stock zéro / quantité trop grande | Pas de stock négatif ni réserve fictive |
| N05 | SKU / SOI incomplet | Refus publication ou achat |
| N06 | Prix change pendant checkout | Nouveau prix proposé et accepté explicitement |
| N07 | Double clic commande | Une commande maximum |
| N08 | Clé idempotence concurrente | Aucun doublon paiement, stock ou commande |
| N09 | Cash non encaissé puis tentative remise | Invariant non payé = aucune remise ; joué sur le flux où le cash peut rester impayé (M02, cash au Relais), pas sur l'import où le paiement précède le sourcing |
| N10 | Webhook PSP simulé dupliqué/non signé | Pas de double règlement, signature obligatoire ; Chromium NOT_APPLICABLE (webhook) |
| N11 | PO sans validation engagement | Aucun engagement fournisseur |
| N12 | Paiement fournisseur sans deuxième validation | Refus ; preuves d'autorisation distinctes |
| N13 | Rupture fournisseur / backorder | Reliquat enregistré, sans réception fictive |
| N14 | Réception partielle / excès / quantité négative | Quantités exactes, refus/incident si écart |
| N15 | Sac/carton incomplet | Pas de fermeture ni départ non conforme |
| N16 | Carton non DISPATCHED / composition figée | Refus de remise et de modification post-remise |
| N17 | Transitaire hors rôle/marché | HTTP 403 sans transition |
| N18 | Douane bloquée puis mainlevée | Pas de transit fictif avant autorisation |
| N19 | Retard/perte transport local | Incident, aucun faux retrait |
| N20 | Écart réception Relais | Quantité réellement constatée et incident |
| N21 | Agent du mauvais Relais | Agent d'un autre Relais : écriture refusée ET aucune donnée divulguée en lecture (table R) |
| N22 | Deux Relais A/B du même marché | Deux Relais A/B du même marché, deux profils : mêmes assertions que N21 dans les deux sens (table R) |
| N23 | Retrait sans code, last4, code erroné, brute-force | Refus vérifié ; pas de remise ; compteur sécurité |
| N24 | Deux remises simultanées | Une attestation de remise maximum |
| N25 | SAV retour et double reprise | Reprise physique unique, produit gelé, pas de revente ni compensation automatique à la simple reprise |
| N26 | Avoir/wallet/remboursement | N26a avant retrait : annulation/remboursement de ligne confirmé + avoir partiel. N26b après retrait : décision admin motivée, wallet prioritaire devise marché, payeur réel. Aucun PSP réel |
| N27 | Annulation après retrait partiel | Reliquat non remis annulable selon son palier F1/F2/F3 et son état fournisseur ; ligne déjà remise = SAV (N26b), jamais annulation ; articles évalués séparément |
| N28 | HTTP timeout/500 + réessai | Pas de faux succès ni double mutation |
| N29 | Session 401 / interdiction 403 | Aucune mutation, navigation sécurisée |
| N30 | Order 360 et tableaux de bord vs PG | Même vérité, fixtures exclues des KPI commerciaux |
| N31 | FX KMF/XAF et remboursement | Snapshot conservé, remboursement sur encaissement |
| N32 | Marché et rôles croisés | Pas de lecture ou d'écriture hors délégation ni hors marché (table R) ; physical-codes/confirm BLOCKED jusqu'à L-SEC |
| N33 | Même produit, 2 tailles/variantes dans un panier | Deux SKU distincts, quantités/total exacts, stock propre |
| N34 | Fournisseur central Hub pour produit manuel | N34a : Fournisseur central unique, immuable, non désactivable, sans dette fictive. N34b : un fournisseur réel choisi explicitement n'est jamais remplacé par le Hub |
| N35 | Coût rendu Relais, N1/N2/N3, plancher et contribution | Oracle O-ECO appliqué aux objets des M/C : fret non doublé, allocations causales, N3 séparé, total détail = plancher |
| N36 | Mode manuel physique sans scanner de bout en bout | Modalité d'exécution de M01/M06 entièrement en MANUAL (pas un second circuit) : provenance MANUAL relue en PostgreSQL à chaque geste, même writer et audit que le scan |
| N37 | Documents et information client | Cohérence O-DOC/O-NOTIF sur le même dossier et O-SEC-DOC : aucun document téléchargeable hors propriétaire/marché ; zéro envoi externe réel |
| N38 | Échec post-commit d'un document ou d'une notification puis reprise | Événement métier conservé, échec tracé, reprise idempotente sans doublon ni faux envoi |
| N39 | Annulation client après engagement ou paiement de la PO | F1 avant achat ou plancher 24 h : 100 % ; F2 achat engagé : demande admin, wallet uniquement si accordée ; F3 embarqué : fermée ; aucun remboursement ni engagement silencieux |
| N40 | Prix fournisseur confirmé différent du devis ou article indisponible | Écart motivé et validé séparément, backorder ou arbitrage, pas de substitution ni paiement silencieux ; impact O-ECO tracé |

## Version 2 — décisions intégrées (#3927)

### Verdicts
`PASS | FAIL | BLOCKED | NOT_PROVEN | NOT_APPLICABLE`. `NOT_APPLICABLE` exige un motif et la branche non concernée, au niveau de l'assertion ou du scénario. Il n'est jamais compté comme PASS et ne peut pas masquer un P0 obligatoire.

### Variantes d'ID (sans renumérotation)
- **N26a** : avant retrait, remboursement de ligne confirmé + avoir partiel (L-A6). **N26b** : après retrait, compensation SAV (L-A1).
- **N34a** : identité du Fournisseur central (unique, immuable, non désactivable ; test PostgreSQL existant `p0-central-hub-supplier-postgres.yml`, #3933). **N34b** : un fournisseur réel choisi explicitement n'est jamais remplacé par le Hub.
- **N21/N22** : mêmes assertions (écriture refusée **et** lecture non divulguée), N22 dans les deux sens entre deux Relais.
- **N35** : devient l'oracle **O-ECO** appliqué aux objets des M et C. **N36** : modalité MANUAL de M01/M06, pas un second circuit. **N37** : passe P0 pour la sécurité d'accès documentaire.

### Configurations C01–C05 (paramètres des M, nommage `ID-Cxx-MARCHÉ`)
| Config | S'applique à | Données |
|---|---|---|
| C01 | M01, M04, M05 | 1 produit, 1 variante, 1 fournisseur connu |
| C02 | M01, M04, M05 | 3 SKU chez un seul fournisseur, achat groupé, lignes préservées |
| C03 | M01, M04, M05 | 4 produits chez 3 fournisseurs contractuels ; PO mono-marché par fournisseur, arrivages asynchrones, consolidation Hub |
| C04 | M06 | Commande spéciale, achats physiques chez plusieurs petits vendeurs A/B/C sous coordination du Fournisseur central (L-A2) |
| C05 | M03 | Import multi-fournisseurs + stock local Relais ; branche locale `NOT_APPLICABLE` pour Hub/PO |

Variations à jouer quand elles s'appliquent : deux variantes du même produit et quantités multiples ; réception partielle, backorder ou excès ; consolidation multi-PO et carton multi-commandes ; écart de prix confirmé (N40) ; annulation ou remboursement partiel. Arbre de corrélation commun : `order_item → source/supplier → PO/purchase_line → achat physique (C04) → réception Hub → sac/KOM-BOX/expédition → réception Relais → parcel_item → scan de retrait → finance/document/notification`.

### Oracles transversaux
- **O-ECO** : N1/N2/N3 sur les objets réels ; fret non doublé, allocations causales, N3 séparé, snapshots prix/FX intacts.
- **O-DOC** : document officiel uniquement après événement confirmé, privé, immuable, idempotent, SHA-256.

| Événement | Attendu |
|---|---|
| Commande créée / non payée | **NONE** (devis éphémère éventuel, aucune facture) |
| Paiement confirmé | Facture |
| PO engagée ou payée | Enregistrement PO + `purchase_order_authorizations` ; `purchase_order_pdf` **NOT_PROVEN** (L-A8, P1) |
| Remise réelle | Preuve de retrait par `scans.id`, par colis (L-A5) |
| Remboursement confirmé | Avoir/reçu, partiel par ligne (L-A6) |
| Mouvement wallet confirmé | Reçu wallet |
| Douane | Document lorsqu'il est émis |
| Réception non attestée | **NONE** |

- **O-NOTIF** : in-app client `preparation`, `shipped`, `available`, une fois chacun ; `in_transit` **NONE** ; résolution au retrait, à l'annulation ou au remboursement ; `order.exception.*` seulement sur fait confirmé avec action. En staging : **zéro envoi réel**, seules des lignes `notification_logs` `skipped`/`blocked`. **O-NOTIF/DRIFT_DOCTRINE** : WhatsApp `order_created`, `payment_confirmed`, `shipped`, `delivered/collected` actifs dans le code ; écart consigné, **non corrigé** (décision séparée, production inchangée).
- **O-SEC-DOC** : téléchargement refusé hors session, propriétaire ou marché.

### Table de droits R
`rôle × geste × marché → 200 attendu, ou 403/404 avec zéro mutation prouvée en PostgreSQL`. Référencée par N17, N21, N22, N29 et N32. Écart connu : `/api/hub/physical-codes/confirm` sans garde marché → **BLOCKED** jusqu'à L-SEC.

### Lots correctifs (autorisation séparée du propriétaire requise)
| Lot | Contenu | Priorité | Débloque |
|---|---|---|---|
| L-A5 | Preuve de retrait par geste réel (par colis), ancrée `scans.id`, code 8 caractères et retrait nominatif exceptionnel, idempotente | P0 | M01–M06, N23, N24, C05 |
| L-A6 | Avoir/reçu partiel après remboursement de ligne confirmé, facture d'origine immuable | P0 | N26a, N27 |
| L-A2 | Vendeur réel structuré par achat physique et allocation ligne/variante/quantité/montant ; vendeur obligatoire à la confirmation (A2-bis), jamais `central_hub` ; rapprochement achats confirmés ↔ total justifié ↔ paiement autorisé par cumuls et plafonds, devises PO et client préservées (A2-ter) | P0 | M06, C04 |
| L-A1 | Compensation SAV après remise : décision admin motivée rattachée au retour, wallet prioritaire dans la devise du marché, payeur réel, produit gelé | P0 | N25, N26b |
| L-SEC | Garde marché sur `/api/hub/physical-codes/confirm` | P0 | N32, table R |
| L-A8 | PDF interne du bon fournisseur | P1 | O-DOC `purchase_order_pdf` |
| L-A3 | Alignement WhatsApp | Décision séparée | O-NOTIF/DRIFT_DOCTRINE |

### Double exécution indépendante (décision du propriétaire, 13/11)
| | Campagne GPT | Campagne Opus |
|---|---|---|
| Matrice | 46 scénarios | les mêmes 46 |
| Marchés | KM, CM, CG | KM, CM, CG |
| Multi-sourcing | CJ, AliExpress, Hub central | identique |
| Parcours | client → achat → Hub → transitaire → relais → client → SAV | identique |
| Validation | Chromium + HTTP + PostgreSQL | identique |
| Données | cohorte GPT-G6 | cohorte CLAUDE-PAR |
| Résultats | rapport indépendant | rapport indépendant |

Les deux campagnes utilisent la même version applicative (SHA identique, noté par run), les mêmes règles et les mêmes assertions. Les commandes, produits, comptes et preuves sont distincts. La comparaison se fait ligne par ligne, par ID et par marché : **un PASS chez l'un et un FAIL ou BLOCKED chez l'autre est une ANOMALIE à investiguer, jamais un PASS global**.

### Prérequis catalogue et critère multi-sourcing (décision du propriétaire, 13/11)
- Catalogue CM et CG peuplé **par le vrai parcours de sourcing**, sans insertion directe, avec de **vrais produits fournisseurs** et **quelques produits manuels** via le Fournisseur central Hub. Les objets de recette portent le marqueur CLAUDE-PAR.
- **Le multi-sourcing est un critère de test obligatoire** de chaque E2E import (M01, M03, M04, M05) : au moins 3 sources distinctes dans la même commande, PO mono-marché par fournisseur, consolidation Hub. C01 et C02 seuls ne suffisent pas à certifier.
- Minimum par marché (KM, CM, CG) :
  - au moins 4 produits vendables (`LOCAL_ACTIVE` + `ENABLED`) chez au moins 3 sources, dont au moins 1 produit manuel du Fournisseur central ;
  - du stock local vendable dans le relais CLAUDE-PAR du marché (M02, M03).
- État des lots : L-A1, L-A2, L-A5, L-A6, L-SEC, L3 et L7 sont fusionnés. **L-A8 est livré (#3951)** : `purchase_order_pdf` devient prouvable. W1 (dépense du wallet dans la devise du marché) et W2 (garde de non-envoi WhatsApp Meta) sont en cours.

### Gates
**G0** SHA servi = SHA cible, allowlist `AUTHKEY_ALLOWED_PHONES` vide ou sans numéro de recette, fixtures par agent → **G1** arbitrages (fait le 12/11) → **G2** lots P0 déployés avant les scénarios qu'ils débloquent, sinon BLOCKED explicite → **G3** M → **G4** N P0 → **G5** N P1 → **G6** comparatif ChatGPT ↔ Opus → `GO_PRE_STRESS` → recette humaine #3754 → stress. Rien ne s'exécute sans « GO tests métiers » explicite du propriétaire.

## Oracle transversal O-FIN — audit Fable #3987 (partagé GPT / Opus)

Le script SQL **lecture seule** [`G6_FINANCE_SQL_ORACLES.sql`](./G6_FINANCE_SQL_ORACLES.sql) regroupe les **15 invariants I1 à I15** de l'audit des flux d'argent : wallet, restitué ≤ encaissé, double encaissement PSP, idempotence de commande, SAV ≤ remis, fournisseur payé ≤ autorisé, documents. Il est obligatoire pour **M01–M06, N06–N12, N24–N27, N31 et N38–N40** et ne change aucun des 46 IDs.

- **Deux campagnes, un seul contrat** : même script, même SHA staging, cohortes distinctes. Pour chaque invariant, consigner l'horodatage, le filtre de cohorte, le nombre de lignes, les clés des anomalies et leur qualification.
- **Zéro ligne exigée** à état stabilisé sur les objets de la cohorte. Une requête qui échoue sur le schéma live est `NOT_PROVEN`, jamais `PASS`. Une violation historique hors cohorte est signalée, jamais masquée.
- Corrections déjà sur `main` : FA-01/02/03/06/07/12/13/14/15/24 ; FA-04/05/08/21 (#4020, PayPal) ; FA-10 (#4026) ; FA-22/25 (#4028) ; FA-23 (#4024). FA-09 et FA-11 sont encore ouvertes : leurs invariants (I14, et I4/I11 sur le prorata wallet) peuvent légitimement remonter des anomalies et sont qualifiés `FAIL` attendu, à tracer.

## Oracle transversal O-HUB — audit Fable #3998 (partagé GPT / Opus)

Le script SQL **lecture seule** [`G6_HUB_SQL_ORACLES.sql`](./G6_HUB_SQL_ORACLES.sql) regroupe les **9 invariants H1 à H9** à relever après stabilisation de chaque geste Hub (commande/réception, rupture, répartition, sac, KOM-BOX, expédition). Il est obligatoire pour **M01, M03, M04, M05, M06 et N13–N16** et ne change aucun des 46 IDs existants.

- **Deux campagnes, un seul contrat :** ChatGPT et Opus exécutent *exactement* le même script sur le **même SHA staging**, mais sur leurs cohortes distinctes. Enregistrer, pour chaque H1–H9, l'horodatage, les paramètres de sélection/identifiants de la cohorte, le nombre de lignes, les clés des anomalies, l'interprétation et la preuve SQL/Chromium/HTTP correspondante.
- **Zéro anomalie non justifiée** est exigé à état stabilisé pour H1 (commande reçue bloquée), H3 (préparation sans colis), H4 (répartition excédentaire), H5a (sur-réception), H6 (sur-engagement), H7 (mélange de marchés). Les états transitoires pendant une transaction ne sont pas un FAIL : vérifier au terme de la transition et après le balayage si nécessaire.
- **Rupture et allocations :** H2 (sous-couverture terminale) doit être rapproché de `supplier_shortage`, de l'alerte et de la décision administrative de remboursement ; une rupture légitime n'est pas automatiquement un FAIL. H5b (allocation figée vs quantité soldée) est une **investigation**, pas une assertion zéro aveugle : examiner les placements réellement reçus et exclure la quarantaine.
- **File directrice :** H8 (colis fournisseur non rapproché >24 h) et H9 (sac/carton en attente >48 h) doivent produire une visibilité opérationnelle, une ancienneté et une alerte au seuil de 48 h dans la vue tous marchés. L'existence d'une tâche âgée n'est pas un FAIL si le suivi et la reprise sont prouvés.
- **Preuve métier complémentaire obligatoire :** arrêt/redémarrage au dernier reçu, rejeu idempotent, réception partielle, refus confirmation sous le reçu, quarantaine, deux répartitions concurrentes sur PostgreSQL réel, commande manuelle M06 avec variante, rupture soldée → incident unique → réservation et exécution de remboursement validées par l'admin. Aucune autorisation de paiement ni mouvement financier n'est fabriqué par le script SQL.

La source Fable est [#3998](https://github.com/SamyrFateh/komerce-backend/issues/3998). **Aucun des contrôles SQL ci-dessus n'est déclaré exécuté ni PASS par l'ajout documentaire.** La campagne E2E reste sous le GO explicite du propriétaire.

## Coordination et paquet de preuve

- **Référentiel de vérité** : ce fichier plus #3754 ; pas de deuxième nomenclature propre à Opus.
- **Exécution double** : comparer le même ID joué par ChatGPT et Opus, pas nécessairement sur le même exemplaire ; noms de preuves GPT-M02-KM-RUN8 et OPUS-M02-KM-RUN8 par exemple.
- **Schéma d'enregistrement** : scenario_id, agent, market, staging_sha, run8, source_ref, sku, order_uuid, po_ref, parcel_ref, actor, chromium_before_after, request/response, sql_before_after, finance, audit, verdict, issue_bloquante.
- **Porte de sortie** : GO_PRE_STRESS seulement si les M applicables et tous les N P0 requis sont PASS sur la version cible ; un BLOCKED doit être explicitement arbitré, jamais maquillé. Ne pas confondre ce GO avec la validation humaine ou le GO V1.
- **Rejouabilité** : ne rejouer que les cas affectés par un correctif, puis une seule passe globale quand les coutures sont vertes.

## Preuves préexistantes à capitaliser

- Run #43197450181 : réception locale, retrait au clavier avec code canonique, négatifs courts, quantité PostgreSQL : **sous-étape** de M02 et N23 seulement, pas M02 complet depuis la boutique.
- Cash réel de recette #43182362145 / #43183465415 : paiement et contrôles uniques prouvés ; leur assertion de statut a été corrigée dans #3916. Pas de PASS G6 global.
- G4 preuves historiques CM/CG et KM : isolation de rôles/relais ponctuelle, à relier au SHA courant et à N22/N32.
- #3918 Fournisseur central Hub et #3900 mode manuel sur toute la chaîne restent des prérequis distincts selon le scénario.
- Recette humaine finale : docs/recette/G6_RECETTE_GUIDEE_PARTENAIRES.md, uniquement après cette campagne et non automatiquement validée par elle.

## Rôles de coordination

**ChatGPT** : lance les workflows déjà gouvernés et consigne le run + verdict sans forçage. **Opus** : lit ce contrat identique, mappe les mêmes IDs vers suites existantes, teste séparément sur fixtures OPUS, contre-expertise les divergences et ouvre une PR par cause si nécessaire. Chacun relit les preuves de l'autre ; aucun des deux ne peut s'auto-certifier en remplaçant une preuve humaine.
