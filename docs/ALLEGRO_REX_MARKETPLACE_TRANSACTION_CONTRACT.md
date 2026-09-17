# Allegro REX — Du connecteur catalogue au contrat transactionnel marketplace

**Statut : preuve live en cours — septembre 2026**  
**Périmètre : Allegro Sandbox, vendeur contrôlé, une offre Golden, achat fournisseur manuel uniquement**

## 1. Pourquoi ce document existe

Allegro est la première intégration Komerce poussée au-delà de la lecture d'un
catalogue fournisseur et de sa normalisation. Le chantier cherche à prouver la
chaîne réelle :

```text
marketplace authentifiée
→ produit publiable
→ offre vendeur active
→ Raffinerie / catalogue / SKU / Canonical Unit / SOI
→ commande client Komerce
→ Purchase Order
→ achat fournisseur manuel en Sandbox
→ réconciliation de la commande Allegro
→ Purchase Order confirmé
```

Cette chaîne n'est pas encore certifiée de bout en bout. En revanche, elle a
déjà atteint la frontière transactionnelle réelle d'Allegro : une demande de
publication live est contrôlée par les règles commerciales du compte, du mode
logistique, du produit et de l'offre. Ce REX conserve ce que cette étape a
révélé avant la première transaction fournisseur confirmée.

Le but n'est pas de documenter chaque particularité Allegro. Le but est de
fixer un modèle réutilisable pour toute future marketplace.

## 2. Découverte centrale : une API marketplace expose deux contrats

Une requête peut être syntaxiquement correcte et commercialement impossible.
Une intégration marketplace doit donc respecter simultanément deux contrats.

### 2.1 Contrat technique

Il couvre notamment :

- OAuth, scopes et rotation des jetons ;
- endpoint et méthode HTTP ;
- schéma JSON, types, formats et identifiants ;
- idempotence, pagination et limites ;
- codes d'erreur et états asynchrones ;
- lecture de confirmation après mutation.

### 2.2 Contrat business

Il couvre notamment :

- capacité réelle du compte vendeur ;
- marché et modèle de vente ;
- produit autorisé et suffisamment renseigné ;
- GPSR et paramètres réglementaires ;
- combinaison livraison / fulfillment ;
- politique de retour et conditions après-vente ;
- stock, TVA, prix et devise ;
- compatibilité de toutes ces ressources entre elles.

Le second contrat n'est pas une validation cosmétique. Il détermine si l'offre
peut réellement devenir achetable.

> **Principe : une ressource existante n'est pas nécessairement une ressource
> compatible avec la transaction visée.**

## 3. Ce que la Sandbox a déjà prouvé

Les faits suivants ont été observés contre Allegro Sandbox, sans mock :

- OAuth vendeur fonctionnel avec renouvellement durable du refresh token ;
- lecture des offres et des produits du catalogue Allegro ;
- recherche bornée de candidats ;
- inspection des images, informations de sécurité et paramètres produit requis ;
- création/réutilisation d'un `responsibleProducer` TEST ONLY ;
- lecture et création contrôlée de conditions après-vente ;
- création d'un draft vendeur ;
- tentative réelle de publication par
  `PATCH /sale/product-offers/{offerId}` avec `publication.status=ACTIVE` ;
- retour d'erreurs métier structurées par Allegro ;
- maintien de l'achat automatique et du paiement fournisseur fermés.

L'offre Golden observée est `7782182471`. Elle a servi à distinguer les défauts
du produit, du pipeline et de la combinaison commerciale de l'offre.

## 4. Trois heuristiques invalidées par le réel

### 4.1 Premier produit trouvé ≠ produit publiable

Le premier seed sélectionné avait :

- zéro image ;
- aucune information GPSR exploitable ;
- au moins deux paramètres produit obligatoires absents : `224017` et `237206`.

Ce produit était lisible mais impropre à une preuve de publication.

La sélection est devenue `publishability-first` :

```text
image présente
AND safetyInformation présente
AND paramètres produit obligatoires complets
```

Le `responsibleProducer` n'est pas exigé du catalogue lorsque le contrat
Allegro permet au vendeur de créer puis d'attacher sa propre entrée GPSR.

### 4.2 Première politique de retour ≠ politique compatible

Une politique peut exister, être lisible et sembler correcte isolément, sans
être acceptable pour le type d'offre effectivement construit.

Le scénario Golden vise explicitement une politique :

```text
availability = FULL
withdrawalPeriod = P14D
isFulfillment = false
```

La sélection doit vérifier les propriétés utiles et leur compatibilité avec le
mode logistique de l'offre. Un simple identifiant valide ne constitue pas une
preuve.

### 4.3 Premier tarif `PHYSICAL` ≠ livraison vendeur classique

Le Golden a sélectionné le premier tarif marqué `PHYSICAL`. Allegro a alors
évalué l'offre comme une offre One Fulfillment et a retourné, en substance :

- service One Fulfillment non actif ;
- adresse de retrait One Fulfillment absente ;
- TVA requise pour One Fulfillment ;
- stock devant être égal à zéro ;
- politique de retour non-Fulfillment incompatible.

Ces erreurs ne prouvaient ni un compte vendeur inactif, ni un produit malade.
Elles prouvaient une combinaison commerciale incohérente.

> **Nouvelle règle : `type = PHYSICAL` est une propriété de présentation, pas
> une capacité suffisante pour sélectionner un rail logistique.**

Le Golden doit choisir un tarif vendeur classique explicitement non-Fulfillment,
puis seulement lui associer stock et politique après-vente compatibles.

## 5. Le modèle de sélection à conserver

Chaque ressource marketplace doit être sélectionnée par capacité et non par
position dans une liste :

```text
intention Komerce
→ capacités du compte
→ profil commercial cible
→ ressources compatibles entre elles
→ construction du draft
→ validation/publication fournisseur
→ relecture de l'état fournisseur
→ import canonique
```

Pour une offre vendeur classique Allegro, le profil doit au minimum exprimer :

| Dimension | Exigence Golden |
|---|---|
| Environnement | Sandbox |
| Mode de vente | vendeur classique |
| Fulfillment | non-Fulfillment |
| Produit | image + sécurité + paramètres requis |
| GPSR | catalogue ou entrée vendeur attachée |
| Livraison | tarif compatible non-Fulfillment |
| Retours | `FULL`, `P14D`, non-Fulfillment |
| Stock | positif et accepté pour ce mode |
| Publication | état fournisseur relu `ACTIVE` |

Une décision ne doit jamais être déduite de `rows[0]`, d'un label vague ou de
l'absence d'erreur lors d'une lecture.

## 6. Conséquence architecturale pour Komerce

Le core Komerce reste provider-agnostic. Il porte les concepts stables :

- Source et offre fournisseur ;
- Normalized Supplier Product V2 ;
- Canonical Product, Unit et SKU ;
- `supplier_order_identity` ;
- Purchase Order ;
- readiness et `HARD_STOP` ;
- confirmation par preuve fournisseur.

L'adapter marketplace porte la traduction du contrat business externe :

- découvrir les capacités du compte ;
- sélectionner un profil commercial cohérent ;
- traduire ce profil dans le payload fournisseur ;
- interpréter les validations du fournisseur ;
- refuser toute capacité non prouvée.

Le core ne doit connaître ni One Fulfillment, ni les identifiants de politiques
Allegro. L'adapter ne doit pas inventer une capacité d'achat ou contourner une
validation commerciale.

## 7. Transaction, readiness et vérité des mots

Les niveaux suivants doivent rester distincts :

| Niveau | Preuve requise | État actuel |
|---|---|---|
| Source connected | authentification + lectures live | prouvé |
| Draft constructible | produit et réglages attachés | prouvé |
| Seller offer active | relecture Allegro `ACTIVE` | à prouver |
| Import canonique | offre active → Unit/SKU/SOI | à prouver sur ce Golden |
| Purchasing ready | stock/prix live + payload manuel exact | à prouver sur ce Golden |
| Supplier transaction | achat acheteur Sandbox réel | à prouver |
| Reconciliation | `checkoutForm.id` exact → PO confirmé | à prouver |
| Auto-order | API acheteur `placeOrder()` supportée | non supporté / fermé |

`MANUAL_PROCUREMENT_READY` ne signifie pas `AUTO_ORDER_READY`.
Un draft ne signifie pas une offre active. Une offre active ne signifie pas une
commande fournisseur. Une commande fournisseur ne signifie pas une
réconciliation réussie.

## 8. Règles de preuve pour la première transaction

La première transaction Allegro ne sera déclarée réussie que si toutes les
preuves suivantes sont réunies :

1. l'offre Golden est relue `ACTIVE` depuis Allegro ;
2. l'offre traverse la Raffinerie et produit la chaîne canonique attendue ;
3. le SOI conserve l'identité Allegro exacte ;
4. Purchasing reconstruit l'offre, le prix, le stock et la quantité attendus ;
5. le système s'arrête avant toute commande automatique ;
6. un acheteur Sandbox distinct effectue manuellement l'achat exact ;
7. Allegro retourne un `checkoutForm.id` et un état admissible ;
8. produit, offre, quantité et prix correspondent au Purchase Order ;
9. la réconciliation persiste cet identifiant et confirme le PO de façon
   idempotente.

Aucune étape ne peut être remplacée par une fixture ou par une déduction issue
d'une étape précédente.

## 9. Checklist réutilisable pour une nouvelle marketplace

Avant de déclarer un adapter transactionnel :

- [ ] distinguer API catalogue, API vendeur et API acheteur ;
- [ ] inventorier scopes et capacités réelles du compte ;
- [ ] formaliser les profils commerciaux/logistiques supportés ;
- [ ] sélectionner produits et réglages par capacités explicites ;
- [ ] vérifier les compatibilités croisées avant mutation ;
- [ ] conserver les erreurs fournisseur structurées (`code`, `path`) ;
- [ ] relire l'état fournisseur après chaque mutation importante ;
- [ ] préserver l'identité source exacte dans le SOI ;
- [ ] séparer sourcing, publication, Purchasing et réconciliation ;
- [ ] garder auto-order fermé sans endpoint officiel prouvé ;
- [ ] effectuer une transaction Sandbox réelle ;
- [ ] réconcilier la transaction avec le PO canonique ;
- [ ] documenter explicitement ce qui reste non prouvé.

## 10. Références internes

- `docs/allegro-sandbox.md` — contrat opérationnel et runners Allegro ;
- `docs/ALIEXPRESS_REX_SUPPLIER_BLUEPRINT.md` — blueprint d'ingestion fournisseur ;
- `docs/SUPPLIERS_CONNECTORS.md` — inventaire des connecteurs ;
- `docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md` — frontière catalogue ;
- `docs/doctrine/DOCTRINE_SOURCE_RESOLUTION.md` — identité et résolution source.

## 11. Formule à retenir

> **Intégrer une marketplace, ce n'est pas seulement envoyer un JSON valide.
> C'est traduire une intention Komerce en une transaction compatible avec les
> capacités du compte, les règles du produit, la logistique et les conditions
> commerciales du fournisseur — puis en rapporter la preuve sans l'exagérer.**
