# G6 — Contrat partagé ChatGPT / Opus avant tests de stress

**État : spécification à exécuter, PAS une certification.** Source : G6 #3754, fournisseur central #3918, mode manuel #3900, recette guidée existante. Le protocole comporte 5 scénarios nominaux et 37 cas limites (32 de G6 plus 5 compléments).

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
| M02 | KM | Produit LOCAL_STOCK vendable -> vrai achat boutique -> cash test -> mise à disposition Relais -> code canonique saisi au clavier -> remise | Sans Hub, PO ou transport import ; commande, colis et lignes physiques collected |
| M03 | KM | Panier mixte stock local + import, deux branches de traitement, deux retraits possibles | Pas de statut collected tant que les lignes import n'ont pas été remises |
| M04 | CM | M01 avec responsable marché CM, caisse, fournisseur, transitaire et Relais CM | Prix XAF, clients et stocks CM, aucune fuite KM/CG |
| M05 | CG | M01 avec responsable marché CG, caisse, fournisseur, transitaire et Relais CG | Prix XAF, clients et stocks CG, aucune fuite KM/CM |

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
| N09 | Cash non encaissé puis tentative remise | Aucun collected sans paid |
| N10 | Webhook PSP simulé dupliqué/non signé | Pas de double règlement, signature obligatoire |
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
| N21 | Agent du mauvais Relais | Refus et aucune fuite de données |
| N22 | Deux Relais A/B du même marché | Isolation inter-relais démontrée en deux profils |
| N23 | Retrait sans code, last4, code erroné, brute-force | Refus vérifié ; pas de remise ; compteur sécurité |
| N24 | Deux remises simultanées | Une attestation de remise maximum |
| N25 | SAV retour et double reprise | Reprise unique, produit gelé, pas de revente automatique |
| N26 | Avoir/wallet/remboursement | Rapprochement exact, aucun PSP réel |
| N27 | Annulation après retrait partiel | Seul le non remis peut être annulé et remboursé |
| N28 | HTTP timeout/500 + réessai | Pas de faux succès ni double mutation |
| N29 | Session 401 / interdiction 403 | Aucune mutation, navigation sécurisée |
| N30 | Order 360 et tableaux de bord vs PG | Même vérité, fixtures exclues des KPI commerciaux |
| N31 | FX KMF/XAF et remboursement | Snapshot conservé, remboursement sur encaissement |
| N32 | Marché et rôles croisés | Pas de lecture ou écriture hors délégation |
| N33 | Même produit, 2 tailles/variantes dans un panier | Deux SKU distincts, quantités/total exacts, stock propre |
| N34 | Fournisseur central Hub pour produit manuel | Une source Hub stable si vendeur inconnu, pas de fausse dette fournisseur |
| N35 | Coût rendu Relais, N1/N2/N3, plancher et contribution | Fret non doublé, allocations causales, N3 séparé, total détail=plancher |
| N36 | Mode manuel physique sans scanner de bout en bout | Réception Hub, sac, KOM-BOX, transitaire, Relais, SAV avec mode MANUAL, même writer et audit |
| N37 | Documents et information client | Devis, commande, reçu, suivi, remise et avoir rattachés au même dossier ; pas de notification externe réelle |

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
