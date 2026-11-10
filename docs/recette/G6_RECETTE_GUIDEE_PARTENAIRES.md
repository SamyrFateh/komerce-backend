# Komerce G6 — Recette guidée partenaires, après Full E2E et cas limites

> **Statut : guide préparatoire — NON CERTIFIÉ.** Ce document sert à exécuter la recette humaine **après** la preuve transverse G6 #3754. Le vert de G2/G3/G4 ne constitue ni un achat client depuis la boutique, ni une validation humaine. Une étape non jouée reste `NOT_PROVEN`.

## 0. Préparer une session vérifiable

- **Marché :** KM / CM / CG (une session et des références distinctes par marché).
- **Environnement :** `https://komerce-backend-production.up.railway.app` (nom contenant “production”, environnement réel = staging Railway jetable). Aucun PSP, fournisseur, SMS ou WhatsApp réel.
- **Navigateur :** Chromium desktop **1440 × 900**. Le mobile est hors campagne.
- **Responsable partenaire, date et rôle :** _________________________.
- **SHA observé à `/health/version` :** _________________________.
- **Empreinte de base / run GitHub :** _________________________.
- **RUN8 et provenance article :** _________________________.
- **Produit commercial réel (source → KSC → KPR → SKU/SOI → prix LOCAL_ACTIVE → exposition ENABLED) :** _________________________.
- **Références de suivi :** commande / PO / sac / carton / expédition / colis / preuve retrait _________________________.

**Gate d'entrée P1 :** au moins une offre réellement validée, publiée, tarifée et exposée sur ce marché par les **writers officiels**. Au 10/11/2026, la cohorte CJ `KIR-000014` est 4/4 intègre mais **non vendable** (`#42864808339`), et l'audit boutique `#42866624141` retourne `CATALOG_NO_SELLABLE_PRODUCTS`. Ne pas deviner prix, autorisation douanière ni stock. Si la boutique n'a aucune offre vendable : **BLOCKED P1**, ne pas simuler un succès client.

## 1. Parcours nominal à suivre dans cet ordre

| N° | Profil / lieu de travail | Geste réel (pas une simulation d'écran) | Ce qu'il faut constater | Contrôle indépendant / preuve |
|---|---|---|---|---|
| 01 | Catalogue / responsable marché | Vérifier provenance fournisseur, traduction FR, SKU, douane, prix actif et exposition du **même produit** | Fiche vendable uniquement sur le marché autorisé | Product ID + source/SKU/SOI + décision + API/SQL + capture |
| 02 | **Client**, `/boutique/` | Choisir le marché, rechercher et ouvrir la fiche | Photo, désignation, prix/devise, options et disponibilité vrais | Capture + GET catalogue / produit, même KPR |
| 03 | Client | Ajouter au panier, changer la quantité, ouvrir le checkout | Total, ligne, relais et bénéficiaire cohérents | Écran + panier serveur + aucun prix inventé |
| 04 | Client identifié | Se connecter par le chemin OTP réservé à la recette ; sélectionner bénéficiaire/relais | Session réelle, bon marché, téléphone du bénéficiaire distinct si exigé | Cookie de session valide, rôle client, relais destination |
| 05 | Client | Cliquer une fois « Confirmer la commande » | **Vrai** POST `/api/orders` sans `route.fulfill()` / stub ; numéro affiché | HTTP 2xx, UUID/ref de commande en PostgreSQL, snapshot paiement et FX |
| 06 | Responsable marché / caisse | Constater paiement de test selon mode autorisé ; aucun débit externe | Statut commandé seulement après vraie autorité de paiement | Journal paiement, 0 débit réel, aucune double confirmation |
| 07 | Agent Hub | Constituer la proposition PO par fournisseur et marché, préparer le dossier | Bonne quantité, pas de mélange des marchés, dossier lisible | PO + order_item + référence source / SQL |
| 08 | Directrice Hub | Valider **engagement** PO puis, séparément, autoriser **paiement fournisseur** | Deux décisions et deux traces distinctes | Audit des autorisations + rôle acteur + horodatages |
| 09 | Agent Hub | Réceptionner fournisseur, compter, identifier et scanner | Réception partielle ou totale fidèle, pas de surplus inexpliqué | Quantités reçues et événements + capture |
| 10 | Agent Hub | Constituer sac client, fermer, mettre en KOM-BOX, expédier | Filiation conservée du colis jusqu'au client | IDs sac/carton/allocations + statuts + capture |
| 11 | Transitaire, `/admin/workspaces/shipping-customs?market=XX` | Accepter la remise Hub, suivre, déclarer transport/arrivée | Bons marchés, références, étape courante visible, pas de page orpheline | Transition HTTP + événements de transport + capture |
| 12 | Admin douane | Déclarer / lier douane puis attester mainlevée | La suite reste bloquée tant que douane non libérée | Documents, événements douane + statut + capture |
| 13 | Hub | Engager transport local vers le bon relais | Unité expédiée, colis traçables | Transition et destination/relai corrects |
| 14 | Agent Relais, `/admin/relais-live?view=execute` | Attester **l'expédition importée** reçue en quantités | Quantités reçues, écarts enregistrés ; aucune réception import par le bouton « Réception locale » | Reçu d'expédition immuable + incident éventuel |
| 15 | Agent Relais | Sélectionner **Remise client**, identifier le colis et attester la remise | Un seul retrait, statut final et preuve, pas de stock automatique | HTTP collect + SQL parcel/order + événement scan |
| 16 | Client | Consulter ses commandes et le suivi | Le même numéro affiche retrait effectué et historique cohérent | Page client + API commande + SQL source |
| 17 | Responsable marché / finance | Vérifier cash dû/encaissé, wallet, marges N1/N2 et justificatifs | Totaux convergents ; aucune simulation dans les KPI réels | Journal financier + rapprochement + capture |
| 18 | Testeur partenaire | Relire l'intégralité des preuves et enregistrer son verdict | Aucun trou de filiation, aucune page sans sortie | Run + SHA + capture + SQL + verdict + signature |

**Commande purement LOCAL_STOCK :** utiliser le circuit client → marché/relais → disponibilité/réception locale (si applicable) → remise. **Aucun achat fournisseur, PO ou Hub** ne doit être créé. **Commande mixte :** deux branches visibles, avec retrait local et import indépendants ; l'état agrégé ne doit pas annoncer une complétude fictive.

## 2. Cas limites partenaires (après nominal)

Pour chaque ligne : une fixture propre, acteur, action, **refus ou effet attendu**, capture, HTTP, readback PostgreSQL et statut `PASS | FAIL | BLOCKED | NOT_PROVEN`.

| ID | Scénario | Résultat attendu |
|---|---|---|
| N01 | Produit non publié / prix absent / exposition OFF / marché suspendu | Aucun achat possible, raison visible, aucune commande |
| N02 | Stock insuffisant, SKU invalide, prix modifié entre panier et checkout | Refus ou nouveau consentement au prix, aucune quantité négative |
| N03 | Double clic client et deux requêtes concurrentes identiques | Au plus une commande et une réservation / paiement |
| N04 | Paiement cash non confirmé ; retrait demandé trop tôt | Refus canonique ; aucun colis remis |
| N05 | Engagement PO sans autorisation ; paiement fournisseur sans second accord | Deux refus distincts, aucune écriture de paiement fournisseur |
| N06 | Réception partielle, rupture, colis manquant, écart de livraison | Reliquat/incident exacts, aucune attestation écrasée |
| N07 | Transitaire avant dispatch / douane bloquée / mauvais rôle | HTTP 403/409 attendu, état physique inchangé |
| N08 | Relais A tente de voir/retirer un colis Relais B du même pays | 403 + aucune fuite ; test A/B réel (G4 acquis séparément) |
| N09 | Code retrait invalide, double retrait, 2 agents simultanés | Refus et exactly-once dans les événements/quantités |
| N10 | Annulation partielle, retour SAV, reprise physique répétée | Retour unique, produit gelé si requis, pas de restock implicite |
| N11 | Wallet/avoir/remboursement cash ou PSP de test | Un seul débit/crédit, montants basés sur encaissé, preuve financière |
| N12 | Timeout/500, session expirée, reprise ou refresh au milieu d'un geste | Aucune double mutation ; navigation récupérable et statut persistant |

La matrice complète des **32 scénarios adverses** et les cas de chaque feature sont tenus dans [G6 #3754](https://github.com/SamyrFateh/komerce-backend/issues/3754). Seules les preuves réellement exécutées sur le même objet/SHA peuvent être marquées PASS.

## 3. Fiche d'observation (une par étape et anomalie)

Copier ce formulaire dans le compte rendu de la session :

```text
Session / marché / date :
Étape / ID :
Profil connecté / relais :
SHA runtime / DB fingerprint / run Actions :
Produit KPR / SKU / commande UUID & référence :
État AVANT (API/SQL + capture) :
Geste exact Chromium / sélecteur / écran :
Requête HTTP et statut observés :
État APRÈS (API/SQL + référence événement) :
Attendu / Observé :
Verdict : PASS | FAIL | BLOCKED | NOT_PROVEN
Capture / trace / artefact :
Ticket anomalie (si présent) :
Commentaire figé / responsable :
Validation partenaire / date :
```

**Verdict final :** un PASS de navigateur sans readback SQL sur le même objet est **NOT_PROVEN** ; un test absent, ignoré ou une API mockée n'est **jamais PASS**. Les refus 403/409 attendus ne sont PASS que si la non-mutation est également démontrée. Reporter à **#3754** tout blocage client P1/P2, SAV financier, paiement externe hors portée ou information client non prouvée. Aucun GO commercial automatique.

## 4. Sources à ne pas confondre

- [G6 transversal et 32 adverses](https://github.com/SamyrFateh/komerce-backend/issues/3754)
- [G2 Chromium KM (10/10)](https://github.com/SamyrFateh/komerce-backend/actions/runs/42861354752) et [G2 Chromium CM](https://github.com/SamyrFateh/komerce-backend/actions/runs/42866029832) : gestes internes, pas une commande boutique.
- [G2 13 étapes CM](https://github.com/SamyrFateh/komerce-backend/actions/runs/42863425136) et [CG](https://github.com/SamyrFateh/komerce-backend/actions/runs/42863687845) : services/SQL, pas une session client Chromium.
- [G4 isolation](https://github.com/SamyrFateh/komerce-backend/issues/3619) : scopes entre deux vrais relais, distinct du SAV financier.
- [G5 CJ](https://github.com/SamyrFateh/komerce-backend/actions/runs/42864808339) : quatre candidats identifiés, prix et activation restant soumis aux validations.
- [Audit boutique staging bloqué](https://github.com/SamyrFateh/komerce-backend/actions/runs/42866624141) : `CATALOG_NO_SELLABLE_PRODUCTS`.
- [Cockpit existant](../../public/golden-e2e-cockpit.html) : accompagnement humain, pas une preuve métier autonome.
