# AliExpress Business Readiness — plan canonique

**Statut : chantier actif — staging**  
**Source : AliExpress Open Platform officielle**  
**Principe : données AliExpress réelles → Komerce staging ; aucun achat fournisseur réel tant que le gate Auto-Order n'est pas explicitement ouvert.**

## 1. Objectif

Faire d'AliExpress une source fournisseur réellement exploitable par Komerce, depuis la découverte produit jusqu'au fulfillment, sans court-circuiter la Raffinerie, le moteur économique, l'approbation catalogue, les règles Market et la gouvernance.

Le mot **vendable** est séparé en trois niveaux :

1. **Catalog Ready** : le produit AliExpress est correctement ingéré, raffiné, promu, enrichi, pricé, approuvé et visible dans la Boutique staging avec ses vrais SKU, médias et stocks.
2. **Fulfillment Ready** : une commande Komerce produit une Purchase Order fournisseur exploitable contenant la référence AliExpress exacte, le SKU exact, l'URL, le coût fournisseur et la quantité ; l'achat peut être exécuté manuellement sans ressaisie ambiguë.
3. **Auto-Order Ready** : Komerce sait créer réellement la commande AliExpress via l'API autorisée, conserver l'identifiant fournisseur, suivre l'état et le tracking, avec idempotence et reprise sur erreur.

Aucun niveau ne doit être déclaré atteint seulement parce qu'une carte est visible dans la Boutique.

---

## 2. Ce qui est déjà en place sur `main`

### 2.1 Connexion AliExpress officielle

Komerce possède :

- un connecteur AliExpress Open Platform ;
- la signature TOP SHA-256 ;
- une intégration OAuth admin ;
- le stockage de la connexion fournisseur ;
- le refresh des tokens ;
- un connecteur connecté capable d'utiliser une session statique ou la connexion OAuth chiffrée.

Il ne s'agit ni d'un mock, ni d'un agrégateur tiers, ni d'un scraper HTML.

### 2.2 Lecture catalogue live

Le connecteur utilise notamment :

- `aliexpress.ds.recommend.feed.get` pour le feed ;
- `aliexpress.ds.product.get` pour le détail produit ;
- `ship_to_country=KM` par défaut pour le premier flux Comores ;
- devise cible source USD ;
- langue source EN.

### 2.3 Contrat fournisseur riche V2

Les faits fournisseur suivants sont préservés :

- `supplier_product_id` ;
- titre et description source ;
- prix d'achat et devise ;
- URL AliExpress ;
- images produit ;
- axes d'options ;
- SKU fournisseur ;
- stock global et stock SKU ;
- prix SKU ;
- images liées aux options/SKU ;
- dimensions ;
- poids ;
- délai fournisseur ;
- propriétés/spécifications ;
- payload AliExpress brut pour audit et lignage.

### 2.4 Raffinerie canonique

AliExpress passe par `catalog-import-orchestrator` et les services propriétaires du domaine sourcing/catalogue.

La source n'écrit pas directement dans `products`.

La Raffinerie conserve :

- le snapshot brut ;
- le contrat normalisé V2 ;
- le candidat sourcing ;
- son scan et sa décision ;
- ses événements de lifecycle.

### 2.5 Promotion catalogue canonique

Le runtime existant sait déjà promouvoir un contrat V2 vers :

- `products` en brouillon inactif ;
- `catalog_media` ;
- `product_variants` ;
- `product_skus` ;
- `product_sku_media` ;
- contenu enrichi / préparation FR.

Le prix final n'est pas fabriqué silencieusement par le moteur économique : la promotion exige un prix choisi explicitement.

### 2.6 Pool AliExpress 500

Le worker `scripts/aliexpress-500-catalog-sync.js` est mergé sur `main`.

Il :

- est interdit en production ;
- exige un flag explicite staging ;
- utilise le feed `DS bestseller` par défaut ;
- pagine par lots de 50 ;
- reprend via checkpoint ;
- déduplique les références AliExpress ;
- impose un cap absolu de 500 ;
- refuse un produit sans nom, image HTTPS, prix positif ou stock positif ;
- exige au moins un SKU actif en stock lorsqu'un produit possède des unités vendables ;
- ingère exclusivement via la Raffinerie.

### 2.7 Purchasing Komerce

Komerce possède déjà :

- `suppliers` ;
- `product_suppliers` ;
- `purchase_orders` ;
- la création automatique d'une Purchase Order quand une commande passe à `ordered` ;
- un fallback de commande manuelle avec notification ;
- l'idempotence anti-duplication de Purchase Order.

En revanche, `aliexpressOrder()` est encore volontairement un stub : l'achat automatique AliExpress n'est pas ouvert.

---

## 3. Ce qui n'est PAS encore prouvé

Les points suivants restent à fermer avant d'utiliser le terme **business ready** :

- appel live staging réussi avec les credentials/app AliExpress réellement configurés ;
- constitution effective de 500 candidats propres depuis l'API live ;
- promotion effective des 500 produits vers le catalogue staging ;
- exposition Boutique vérifiée ;
- mapping canonique Produit/SKU Komerce → fournisseur AliExpress ;
- refresh périodique prix/stock des produits déjà importés ;
- gestion du produit/SKU devenu indisponible ;
- preuve d'une commande client générant une PO AliExpress totalement exploitable ;
- permissions AliExpress réelles pour freight / place order / order detail / tracking ;
- implémentation de l'achat automatique ;
- preuve E2E d'une commande fournisseur réelle et de son tracking.

---

## 4. Point d'architecture à corriger avant fulfillment

`product_suppliers` porte historiquement `supplier_price_aed`.

AliExpress remonte aujourd'hui une devise fournisseur explicite, généralement USD dans notre flux.

**Interdiction de convertir silencieusement un prix AliExpress en AED simplement pour satisfaire le schéma historique.**

Le modèle fournisseur devra porter une valeur et une devise source explicites, puis laisser le moteur économique convertir vers les monnaies de calcul/Market nécessaires.

Compatibilité possible : conserver `supplier_price_aed` temporairement pour les fournisseurs historiques Dubai, mais le chemin AliExpress doit utiliser un couple canonique du type :

- `supplier_price` ;
- `supplier_currency` ;
- `last_checked_at` ;
- référence produit fournisseur ;
- référence SKU fournisseur.

Cette correction fait partie du gate **Fulfillment Ready**.

---

## 5. Séquence d'exécution

### LOT AE-1 — Live Source Proof

But : prouver que le staging Komerce parle réellement à l'application AliExpress configurée.

Actions :

- vérifier le statut OAuth / session ;
- appeler le feed live ;
- charger plusieurs détails produit ;
- vérifier SKU, médias, stocks, prix, poids/dimensions lorsque fournis ;
- journaliser un verdict sans secret ;
- lancer le pool borné jusqu'à 500 ou jusqu'à épuisement explicite du feed.

Gate AE-1 :

- source live répond ;
- aucune donnée mock ;
- aucune erreur de signature/token ;
- compte réel de candidats propres connu ;
- aucune écriture directe dans `products`.

### LOT AE-2 — 500 Catalog Ready

But : transformer le pool propre en catalogue staging réellement testable.

Actions :

- sélectionner uniquement les candidats du pool AliExpress contrôlé ;
- appliquer le pricing décidé explicitement ;
- promouvoir via les services canoniques ;
- conserver variantes/SKU/médias/stock ;
- préparer/enrichir le contenu FR ;
- faire passer les contrôles d'approbation ;
- créer les expositions Market de test ;
- auditer Boutique desktop/mobile.

Gate AE-2 :

- 500 produits ou un écart explicitement justifié par le stock/source ;
- aucun SKU incohérent ;
- aucun produit visible avec stock source nul ;
- aucune carte sans média principal ;
- aucune publication contournant `catalog-approval` ;
- Boutique staging navigable avec vraies données AliExpress.

**Les anciennes cartes ne sont désactivées qu'après réussite du nouveau catalogue, jamais avant.**

### LOT AE-3 — Supplier Mapping canonique

But : rendre chaque produit/SKU commandable côté achats.

Actions :

- créer/résoudre le fournisseur AliExpress canonique ;
- relier chaque produit promu au `supplier_product_id` ;
- relier les unités vendables au `supplier_sku` exact ;
- conserver l'URL fournisseur ;
- conserver prix + devise fournisseur sans conversion silencieuse ;
- assurer idempotence et mise à jour ;
- exposer un audit de couverture fournisseur.

Gate AE-3 :

- 100 % des produits destinés à être vendus possèdent un chemin fournisseur ;
- chaque SKU riche vendu est résolvable vers un SKU AliExpress ;
- prix source et devise sont traçables ;
- aucune commande client ne tombe dans `no_supplier` pour le catalogue AliExpress validé.

À ce stade : **Fulfillment manuel business-vendable possible**.

### LOT AE-4 — Refresh prix / stock

But : ne jamais traiter le snapshot initial comme une vérité permanente.

Actions :

- worker de refresh AliExpress ;
- refresh par produit/SKU ;
- mise à jour `last_checked_at` ;
- détection prix modifié ;
- détection stock nul ;
- désactivation/quarantaine commerciale quand la fraîcheur dépasse le TTL défini ;
- interdiction checkout si disponibilité fournisseur non suffisamment fraîche selon la politique retenue ;
- journalisation des écarts.

Gate AE-4 :

- le stock Boutique ne repose plus uniquement sur le jour d'import ;
- un SKU AliExpress à zéro ne reste pas silencieusement vendable ;
- les changements de coûts alimentent le moteur économique sans modifier arbitrairement le prix Market.

### LOT AE-5 — Fulfillment manuel E2E

But : prouver la première vraie vente exploitable sans auto-order.

Scénario :

1. produit AliExpress visible ;
2. checkout Komerce ;
3. paiement/test staging ;
4. commande `ordered` ;
5. génération de `purchase_order` ;
6. PO contenant produit, SKU, quantité, coût, devise et URL AliExpress ;
7. opérateur peut commander manuellement sans rechercher de nouveau le produit ;
8. retour statut fournisseur/logistique dans Komerce.

Gate AE-5 : **AliExpress Fulfillment Ready**.

C'est le premier niveau où l'on peut dire :

> « Ce catalogue peut être vendu avec fulfillment fournisseur manuel contrôlé. »

### LOT AE-6 — Permission Matrix Auto-Order

But : ne jamais coder contre des APIs supposées disponibles.

Actions :

- établir les permissions réellement accordées à l'AppKey connectée ;
- tester sans achat les capacités disponibles ;
- documenter freight, place-order, order-detail, tracking et éventuelles contraintes Dropshipping ;
- distinguer API documentée, API accessible et API effectivement autorisée au compte.

Gate AE-6 : matrice de capacités prouvée contre notre intégration réelle.

### LOT AE-7 — Auto-Order

Uniquement après AE-6.

Actions :

- calcul/validation freight ;
- création réelle de commande fournisseur ;
- clé d'idempotence liée à la Purchase Order Komerce ;
- stockage du `supplier_order_id` ;
- reprise sur timeout/réponse ambiguë sans double commande ;
- récupération statut ;
- tracking ;
- annulation/exception si disponible ;
- alerting et fallback manuel.

Gate AE-7 : commande fournisseur réelle prouvée E2E sur un scénario contrôlé.

### LOT AE-8 — Production Readiness

Avant production :

- séparation explicite staging/production ;
- limites de dépenses ;
- permissions minimales ;
- secrets distincts ;
- audit logs ;
- retry/idempotence ;
- monitoring ;
- alertes stock/prix/order ;
- kill switch Auto-Order ;
- procédure manuelle de secours ;
- validation métier Market par Market.

Gate AE-8 : **AliExpress Business Ready Production**.

---

## 6. États de maturité officiels

| Niveau | Signification | État au démarrage du chantier |
|---|---|---|
| Source Connected | Connecteur + OAuth + API catalogue | **Construit** |
| Refinery Ready | Contrat V2 + ingestion canonique | **Construit** |
| Pool Ready | Worker propre borné 500 | **Construit / exécution live à prouver** |
| Catalog Ready | 500 cartes staging approuvées et visibles | **À exécuter** |
| Supplier-Mapped | produit/SKU → AliExpress commandable | **À fermer** |
| Stock Fresh | refresh et garde fraîcheur | **À fermer** |
| Fulfillment Ready | PO fournisseur exploitable manuellement | **À prouver** |
| Auto-Order Ready | commande API + tracking | **Non implémenté** |
| Production Ready | garde-fous production complets | **Non ouvert** |

---

## 7. Doctrine de sécurité et de gouvernance

1. **Catalogue live ne signifie pas achat live.**
2. Aucun worker catalogue ne peut appeler une API de commande fournisseur.
3. Aucun achat réel n'est déclenché depuis staging tant qu'un gate dédié n'est pas explicitement ouvert.
4. Toute mutation catalogue passe par les services owners existants.
5. Le moteur économique recommande ; le Market décide du prix.
6. Un fournisseur ne décide pas de la visibilité Market.
7. Un stock inconnu ou trop ancien n'est pas assimilé à un stock positif.
8. Toute automatisation achat doit être idempotente.
9. En cas d'ambiguïté fournisseur, fallback manuel + alerte ; jamais double achat.
10. Les cartes historiques restent en place jusqu'à la preuve du remplacement.

---

## 8. Prochaine exécution immédiate

Ordre retenu :

**AE-1 Live Source Proof → AE-2 Catalog Ready → AE-3 Supplier Mapping → AE-4 Refresh → AE-5 E2E manuel → AE-6 Permission Matrix → AE-7 Auto-Order.**

Le chantier est considéré réussi à court terme lorsque le staging possède un catalogue AliExpress réaliste et stable de 500 produits, réellement alimenté par la Raffinerie, et qu'une commande Komerce peut générer une Purchase Order AliExpress sans ambiguïté.

L'auto-order est un objectif suivant, pas une condition préalable pour éprouver la Boutique et le moteur économique avec de vraies données fournisseur.
