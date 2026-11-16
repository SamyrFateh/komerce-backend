# G6 — Audit des écrans staging : peut-on jouer M01–M06 / N01–N40 dans Chromium ?

**Nature : audit en LECTURE SEULE, pas une certification.** Date : 16/11/2026. Cible : staging Railway (`komerce-backend-production.up.railway.app`, boutique `komerce.co/KM|CM|CG`). SHA servi (début et fin) : `d64624c79d7525f461c52b2ea8a0b449ca4e2d8d`. Chromium 1440x900, `deviceScaleFactor` 1. Source de vérité des scénarios : `G6_PRE_STRESS_BUSINESS_SCENARIOS.md`.

## Méthode et garde-fous

- Connexion par `POST /api/auth/login` avec la cohorte CLAUDE-PAR (secrets jamais affichés), ouverture des pages, clic sur onglets et menus uniquement. Toute requête `/api/**` non GET était interceptée et **avortée** par le script (aucune écriture possible, compteur de blocages observé : 0).
- Clients : aucun OTP, arrêt au sélecteur d'indicatif (le bouton « Recevoir le code » n'est pas cliqué).
- Objets existants : M05 `K0JTEVQ` (CG) et M04 `K3II5QL` (CM) sont tous deux **déjà `collected`** ; `KYFOXNU` (CM) est `ordered` ; `KFBN9KL` et `KEL63X8` (CG) sont `pending`. Les agents Relais CG/CM/KM voient **0 commande** via `/api/relay/orders`, `/api/relay/dashboard`, et `GET /api/relay/returns/eligible?reference=...` répond 404 `RETURN_ORDER_NOT_FOUND` pour les commandes de la cohorte : aucun colis à mi-chaîne n'est présent côté Relais. Tout bouton conditionné à un état (réception, encaissement, remise, retour) est donc relevé par le **code source servi** (`public/dashboards/canonical/js/*`) et marqué `NON_VÉRIFIABLE_SANS_ÉTAT` quand le DOM ne l'a pas rendu.
- Le grep statique initial est **réfuté sur 3 indices sur 3** (voir « Corrections des indices »).

Légende : OK = présent et atteignable depuis la navigation du rôle ; PARTIEL = présent mais incomplet, ou réservé à un autre rôle que celui du scénario ; MANQUANT = aucun écran ; NVSE = NON_VÉRIFIABLE_SANS_ÉTAT (existe dans le code, non rendu faute d'objet dans l'état requis).

## Corrections des indices

| Indice | Constat réel |
|---|---|
| Pas de +237 / +242 | **Confirmé** en vrai : sur `/KM`, `/CM`, `/CG` le sélecteur propose `+269 +33 +262 +32 +41 +44 +1 +971 +966 +60 +212`. |
| Pas d'écran de réception stock local W3 | **Faux** : `market-autonomy.html` (Responsable marché) rend la section « Stock local » avec le bouton « Déclarer la réception » (`POST /api/markets/:m/local-stock/receipts`, champs quantité, relais, justificatif, note). |
| Pas de création KOM-BOX | **Faux** : `hub-live?view=execute` > « Détails physiques exhaustifs » rend « Cartons KOM-BOX » ; bouton « Créer une KOM-BOX » (`create-box`) conditionné à des sacs fermés (NVSE) ; « Rattacher à l'expédition choisie » existe aussi. |
| Pas d'écran « révéler le code » (`reveal-once`) | **Confirmé** : aucun appel à `/api/pickup/reveal-once` dans `public/` ; seule la régénération client existe (`b-tracking.js` : `customer-regenerate`). |

## Tableau par rôle

### Client (boutique)

| Geste | Écran / preuve | Verdict |
|---|---|---|
| Choisir le marché | Le marché est fixé par l'URL `komerce.co/KM`, `/CM`, `/CG` (devise KMF/XAF, textes pays vérifiés). Aucun sélecteur de marché dans la page. | PARTIEL |
| Ville puis relais | À jouer dans le checkout (voir section Reprise : relevé en cours). Page « Trouver un relais » = lien WhatsApp externe. | NVSE |
| Connexion téléphone | « Mon Komerce » > « M'identifier » : prénom, nom, indicatif, numéro, « Recevoir le code ». Indicatifs **sans +237 ni +242**. Un acheteur CM/CG ne peut pas saisir son numéro. | MANQUANT (CM, CG) / OK (KM) |
| Panier, variantes | « + » ouvre la modale produit : couleur, tailles S–2XL, « Ajouter », « ⚡ Acheter ». | OK |
| Checkout cash | Boutique « Paiement cash · Retrait relais » ; étapes finales non jouées (écriture). | NVSE |
| Suivi dans Mon Komerce | « Mes Commandes » ; contenu nécessite une session OTP. | NVSE |
| Révéler le code de retrait | Aucun appel `reveal-once` côté UI. | **MANQUANT** |
| Régénérer le code | `b-tracking.js` appelle `POST /api/pickup/customer-regenerate/:id` (visible selon l'état de la commande). | NVSE |
| Preuve de retrait PDF | Pas d'appel UI vers `/api/pickup/receipt/:id` hors admin-legacy. | NVSE (probable MANQUANT) |
| SAV / retour client | Côté Relais (« Retours & SAV »). Pas de demande initiée par le client dans `public/boutique/js`. | MANQUANT (côté client) |
| Annulation client | Pas de bouton d'annulation relevé dans `b-tracking.js` sans état. | NVSE |

### Responsable marché (`market_operator`)

Navigation : Tour de contrôle, Hub, **Autonomie marché**, Catalogue pays. Page `market-autonomy.html`.

| Geste | Preuve | Verdict |
|---|---|---|
| Décision de prix local | Section « Prix des produits », bouton « Gérer le prix » (32 produits KM). | OK |
| Exposition par marché | `PUT /market-delegation/markets/:m/catalog/exposure/:id` ; section Offre locale, bouton « Masquer ». | OK |
| Déclaration de stock local W3 | Section « Stock local », « Déclarer la réception ». | OK |
| Politique de caisse | « Protection des encaissements », « Enregistrer la politique ». | OK |
| Caisse / garde des espèces (destinations, remise) | Routes `cash-custody` existantes, **aucun appel dans `public/`**. Côté Relais : onglet « Cash & dépôts » (lecture : rapprochement, garde des espèces). | MANQUANT (écran de garde marché) |
| Remboursement local F1/F2 (remise espèces, mobile money) | « Litiges clients » : « le montant du remboursement reste sous autorité centrale et n'apparaît jamais ici ». Aucun écran de décaissement local. | MANQUANT |
| Invendus | Aucune occurrence « invendu/unsold » dans `public/`. | MANQUANT |
| Règlements | Bouton « Enregistrer la réception » (settlement.receive) côté comptabilité. | OK |

### Achats et finance

Accès réel : `/admin/workspaces/purchasing` est **réservé au rôle `admin`** (`navigation-policy-v4.js`). Le rôle `finance` est redirigé vers Comptabilité. Les décisions d'engagement et de paiement sont dans le Kanban Hub (`/admin/hub`) via le menu de cellule pour l'agent Hub porteur de grants (`purchase_commitment`, `supplier_payment`).

| Geste | Preuve | Verdict |
|---|---|---|
| Lignes ouvertes / préparer | Achats fournisseurs : « Lignes à préparer », « Préparer la commande » ; aussi `hub-context-actions` (`po/prepare`). | OK (admin) |
| Soumettre | « Soumettre au fournisseur ». | OK |
| Autoriser l'engagement (2e validation) | « Valider l'engagement d'achat » (pièce, montant, devise) pour qui détient le grant ; message explicite sinon. | OK (agent Hub avec grant) / PARTIEL (admin) |
| Envoyer | « Attester l'envoi fournisseur » (canal, référence, justificatif). | OK |
| Confirmer la PO | « Enregistrer la confirmation » (ligne par ligne) dans Achats. | OK (admin) |
| Autoriser le paiement | « Autoriser le paiement fournisseur ». | OK |
| **Régler** le paiement fournisseur | Routes `supplier-payments/:id/settlements` et `lines/:id/settle` : **aucun appel UI** ; l'écran Finance ne liste que « Paiements fournisseurs à revoir ». | **MANQUANT** |
| Décision d'écart de prix / produit indisponible (N40) | Route `po/:id/variance-decision` : **aucun appel UI**. | **MANQUANT** |
| Octroi des grants d'autorisation | Route `authorizations/grants` : aucun appel UI. | MANQUANT |
| Clôturer une ligne (rupture) | « Annuler » (`cancel-line`), « Changer fournisseur ». | PARTIEL |
| Fournisseur central Hub, produit manuel | `sourcing-workspace.js` mentionne « Fournisseur central » / `central_hub`. | NVSE |
| Achat manuel (vendeur + justificatif) | `hub-live` : « Résoudre le sourcing / créer un achat manuel », « Créer la ligne d'achat ». | OK |

### Agent Hub et directrice Hub

Navigation : À traiter, Expéditions & Douane, Hub · Tous les marchés (Administration / Opérations), `hub-live?view=execute&market=KM|CM|CG`.

| Geste | Preuve | Verdict |
|---|---|---|
| Dossier Hub | `/admin/hub`, `hub-live` onglet « Dossiers » (E2E-HUB-V1-*). | OK |
| Réception MANUAL avec justificatif | `operations-workspace.js` : bascule « Saisie manuelle : provenance MANUAL avec justification obligatoire », « Enregistrer la réception ». | OK (formulaire NVSE) |
| Arrivée sans manifeste | Onglet « Réceptions » : « Attester l'arrivée sans manifeste » (zone, tracking). | OK |
| Quarantaine | Résultat `quarantined` géré après réception. | NVSE |
| Répartition | Onglet « Actions Hub » : « Répartir ce marché », « Répartir ». | OK |
| Affecter l'inventaire | Onglet « Stock à affecter » : « Affecter ». | OK |
| Sac client | « Préparer les sacs clients », « Créer le sac client », « Déposer dans le sac » (mode SCAN ou MANUAL), « Fermer le sac ». | OK |
| KOM-BOX | « Cartons KOM-BOX », « Placer le sac », « Créer une KOM-BOX ». | OK (NVSE sans sac fermé) |
| DISPATCHED / ouverture d'expédition | « Ouvrir le dossier » (`create-shipment-from-boxes`), « Rattacher à l'expédition choisie ». | OK |
| Vue directrice | `/admin/hub` : « Direction Hub · Tous marchés · 9 tâche(s) · 0 alerte(s) ≥ 48 h », ancienneté en heures, « Colis … arrivé à rapprocher » (CG), « Rapprocher le débit ». Le compte « hub-director » a le rôle `agent_hub` (la direction est portée par les grants). | OK |

### Transitaire (`agent_transitaire`)

Navigation : À traiter, Expéditions & Douane seulement (toutes les autres routes redirigent).

| Geste | Preuve | Verdict |
|---|---|---|
| Transit | « Mettre en transit » (`confirm-transit`) ; étapes du journal international (remis, réceptionné, expédié/en transit, arrivé). | OK (NVSE sans expédition) |
| Douane : déclarer / corriger | « Nouvelle expédition douane », « Déclarer », « Corriger », « Désactiver ». | OK |
| Douane bloquée | Aucun statut « bloqué » : seul le refus `JOURNEY_CUSTOMS_PENDING` à la tentative de mainlevée. | **MANQUANT** (état bloqué) |
| Mainlevée | Étape `customs_released` réservée au rôle **admin** (`international-shipment-journey.js`), pas au transitaire. | PARTIEL (rôle) |

### Agent Relais

Navigation : À traiter, Hub, Relais live (Flux, Remises, Incidents & SAV, Historique) ; onglets Opérations, Cash & dépôts, Retours & SAV.

| Geste | Preuve | Verdict |
|---|---|---|
| Réception de l'expédition (quantités) | « Attester la réception » (`relay-shipment-receive`), « Identifier le sac ». | NVSE (0 arrivage) |
| Écart de réception | Panneau « Incidents & SAV » ; saisie des quantités dans le formulaire de réception. | NVSE |
| Encaissement cash | « Encaisser les paiements » (`confirm-cash`) ; KPI `cash_a_encaisser` = 0 pour KFBN9KL (non rattaché au relais de l'agent). | NVSE |
| Remise par code | « Remettre au client » : « demandez le code complet au client et saisissez-le au clavier » ; bouton « Vérifier et remettre ». | OK (champ NVSE sans colis) |
| Retrait partiel | Message « autres lots à retirer » après remise partielle. | NVSE |
| Reprise SAV | Onglet « Retours & SAV » : recherche par référence, « attester séparément la reprise physique ». Réponse « Commande introuvable dans ce relais » pour K0JTEVQ et K3II5QL. | PARTIEL |
| Réception locale (stock local) | « Attester la réception » (`local-relay-receipt`). | NVSE |
| Régénérer le code (agent) | Seulement `admin-legacy` (`/api/pickup/regenerate`). | MANQUANT (canonique) |

### Admin

| Geste | Preuve | Verdict |
|---|---|---|
| Order 360 | `/admin/orders/K0JTEVQ` (par référence ; l'UUID donne « Commande introuvable »). Parcours, articles, coûts, achats, colis, scans, notifications, documents. Lecture seule. **Observation : total d'une commande CG affiché en « KMF » (4 991 KMF)**, à rapprocher de l'attendu « prix XAF » de M05. | OK / à vérifier (devise) |
| Tableaux de bord | Pilotage, À traiter, Commerce, Opérations, Finance, Hub, Relais live, Responsables pays, Catalogue pays, Utilisateurs, Providers, Paramètres : tous rendus. | OK |
| Rôles croisés | Finance : toute route hors Comptabilité redirige vers Comptabilité ; transitaire : tout redirige vers Expéditions & Douane ; sourcing : hors Sourcing live redirige vers la boutique `/` ; Relais KM : `/admin/hub-live` accessible en plus du Relais. Le responsable marché est redirigé de `purchasing`, `import-runtime`, `relais-live`. | OK |
| Remboursement / avoir / wallet admin (N26) | Aucun écran d'octroi trouvé dans `canonical/js` hors lecture `wallet` ; non rejoué. | NVSE |

## Manques priorisés (bloquants Chromium)

1. **P0 — Indicatifs +237 (CM) et +242 (CG)** absents de la connexion boutique : M04, M05, M02 (CM/CG), N23, N33 impossibles avec de vrais acheteurs.
2. **P0 — Révéler le code de retrait** (client) : aucun écran `reveal-once` ; M01–M06 (remise par code), N23, N24.
3. **P0 — Régler le paiement fournisseur** et clôturer le règlement : aucun écran (`supplier-payments/settlements`, `lines/:id/settle`) ; M01, M04, M05, M06, N12, N40.
4. **P0 — Décision d'écart fournisseur** (`variance-decision`) : N40, N13, N39.
5. **P1 — Remboursements locaux F1/F2** (remise espèces, mobile money) et chaîne de garde cash côté responsable marché : N26a/b, N27, N31, N39, M04, M05.
6. **P1 — Douane bloquée / mainlevée par le transitaire** : état « bloqué » inexistant, mainlevée réservée admin : N17, N18, M01.
7. **P1 — Écran Achats réservé à `admin`** : le rôle `finance` ne peut pas jouer les gestes Achats/Finance : M01, M06, N11, N12.
8. **P1 — SAV et annulation initiés par le client** (boutique) : N25, N26, N27, N39.
9. **P2 — Invendus** : aucun écran.
10. **P2 — Devise KMF affichée sur une commande CG** dans Order 360 : N30, N31, M05.

Scénarios : tous les M et N nécessitant un client CM/CG (M02, M04, M05) sont bloqués par le manque 1 ; tous ceux qui exigent la remise (M01–M06, N09, N16, N21–N24, N27) par le manque 2 ; M01, M04, M05, M06, N12, N40 par 3 et 4. N10 est NOT_APPLICABLE (webhook). N01–N08, N28–N29, N33, N35, N37–N38 restent NVSE ou relèvent de l'API : leur rejeu Chromium exige un checkout complet (écriture), hors périmètre de cet audit.

## Reprise

Rôles audités : responsable marché, achats et finance, Hub (agent et directrice), transitaire, relais, admin. Restant : relevé détaillé du checkout client (ville, relais, étapes) et de « Mon Komerce » (limité par l'absence d'OTP). Scripts de relevé : Playwright maison dans le scratchpad (non versionnés).
