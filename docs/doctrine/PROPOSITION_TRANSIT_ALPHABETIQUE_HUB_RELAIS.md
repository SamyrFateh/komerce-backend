# Proposition de doctrine — Transit alphabétique et rangement virtuel Hub / Relais

**Statut : PROPOSITION SOUMISE À CONTRE-REVUE — NON CANONIQUE, NON ACTIVÉE.**
**Propriétaire de proposition : GPT ; contradicteur souhaité : Opus (ou Grok).**
**Domaines concernés :** logistics (placement/custody), orders (référence commerciale), purchasing (PO), market (isolation), relay (remise), dashboard (projections).
**Dépendances normatives :** `AGENTS.md`, `docs/doctrine/DOCTRINE_HUB_PHYSICAL_IDENTITY.md`, invariant PO mono-marché (#3247), mode sans scanner (#3900), scénario G6 (#3754).
**Portée :** doctrine et architecture à arbitrer, sans migration, changement de numéro, étiquette réelle ni modification d'API.

## 1. Problème et objectif métier

Komerce organise un **transit temporaire**, pas un stock commercial résident : le Hub reçoit/contrôle/constitue et expédie ; les relais réceptionnent puis remettent. Les volumes futurs, les surfaces, les bacs et l'organisation des sites sont inconnus. Chaque site doit pouvoir étiqueter librement ses zones physiques (`A` à `Z`, puis subdivisions), tout en utilisant un langage commun et des écrans synchronisés.

Objectif terrain : « je vois A sur l'unité, je vais en A ; je scanne, Komerce sait où elle est ; quand elle sort la place est libérée ». On cherche une **orientation intuitive** puis une localisation autoritative, pas une numérotation du client ni une gestion de stock long terme.

L'équilibrage porte sur le **nombre d'unités physiques actuellement en transit**, jamais sur le nombre de clients ou de commandes commerciales. Une COMBOX fermée = une unité physique, même si elle porte plusieurs commandes ; si elle est déconditionnée, les nouvelles unités manipulées sont comptées chacune à leur emplacement. L'âge en transit est suivi et les anomalies prolongées sont signalées.

## 2. Trois identités qui ne doivent pas se confondre

1. **Commande commerciale** (orders) : référence permanente et liens vers paiement, client, marché, destination, SAV, documents. La référence actuelle est utilisée largement ; ne jamais la renommer en place sans plan de compatibilité.
2. **Unité physique** (hub_physical_units / parcels selon étape) : `KOM-RCV`, `KOM-ITEM`, `KOM-BOX`, colis remis au relais, identifiant de scan et chaîne de custody. Une commande peut alimenter plusieurs unités ; une unité peut agréger plusieurs commandes.
3. **Placement temporaire par site** : code de tri lisible, zone/emplacement réel, entrée, déplacement, sortie et durée de séjour ; propre à un lieu et à un épisode de transit, sans réécrire les allocations Purchasing ni l'identité physique.

Le libellé commercial **envisagé** est `COM-A-KM-<suffixe_non_séquentiel_unique>` : `COM` famille visible, `A` groupe alphabétique, `KM` marché, suffixe opaque avec contrainte d'unicité DB et nouvelle tentative en collision. Ceci est un **alias/logistic display reference** à discuter ; il **ne remplace pas** à ce stade les références `K...`, `KOM-...`, `KOM-P...`, `KOM-IN...` ou `KOM-BOX...`. Ne jamais traiter la lettre ni un suffixe peu prévisible comme une preuve d'autorisation, de paiement ou de remise.

**Attention :** un `COM-A-...` rattaché à la commande ne démontre PAS qu'une COMBOX multi-commandes doive être rangée en A. L'unité physique porte sa propre localisation, déterminée à l'endroit où elle est réellement manipulée.

## 3. Une lettre ou deux ?

**Hypothèse de départ : une lettre de premier niveau (`A`–`Z`)**, intuitive à lire et signaler, indépendamment du nombre de commandes : une même lettre est réutilisée indéfiniment ; l'unicité vient du suffixe technique, pas du nombre de lettres.

Un lieu peut définir une subdivision interne : `A/AA`, `A/AB`, ou `A/01`, sans modifier les identités des commandes déjà émises. Deux lettres dans **toutes** les références dès le jour 1 ne sont pas nécessaires pour le volume : elles ne se justifient que si le besoin réel de guidage à deux niveaux est établi. Le nombre maximal de bacs n'est pas déduit de la combinatoire des identifiants.

## 4. Conflit à arbitrer AVANT développement : code permanent versus répartition locale dynamique

Ces deux promesses, prises absolument, sont **incompatibles** :
- « Le `A` est gravé dans la référence commerciale dès la commande ; Hub et tous les relais rangent toujours dans A » ;
- « Chacun des sites attribue toujours la lettre actuellement la moins occupée, à sa réception ».

Les volumes, moments d'arrivée, plans et départs diffèrent par site. Il est impossible de garantir les deux simultanément. Il est tout aussi impossible de garantir à la création d'une commande combien d'unités physiques elle produira après fractionnement et COMBOX.

**Architecture candidate recommandée pour arbitrage (modèle hybride) :**
- **Groupe A–Z permanent côté commande**, décidé une fois, sert de repère humain et de partition de flux *prévisionnelle* ; choix équilibré selon un comptage de travail à définir, avec anti-concurrence. Sa stabilité prime sur la promesse d'équilibre exact à chaque site. Ne pas appeler ce groupe un « emplacement confirmé ».
- **Emplacement réel de l'unité** décidé/confirmé à la réception ou au reconditionnement, par site et par unité. Le moteur privilégie une zone compatible moins chargée et suit les unités entrées/sorties. Si l'on veut strictement ranger une commande en A, toute la capacité locale et les subdivisions A doivent absorber cette contrainte ; le moteur n'a pas le droit de silently envoyer une commande A vers B.
- Pour les unités **multi-commandes ou multi-destinations en réception** : pas de lettre commerciale unique héritée ; leur emplacement suit leur **propre référence physique**. Le contenu est rapproché/ventilé explicitement au Hub avant outbound.

**Décision ouverte :** choisir (A) lettre commerciale A–Z rigide avec équilibre approximatif inter-sites et débordement uniquement intra-A, ou (B) lettre sur **étiquette logistique d'unité/site**, réattribuable à chaque site, avec exactitude supérieure de l'équilibrage local mais moins de continuité dans le numéro de commande. Ne pas programmer implicitement un compromis contradictoire.

## 5. Répartition, concurrence et vérité d'occupation

À l'entrée physique dans un lieu :
1. Identifier l'unité par son code canonique ; résoudre son marché/destination autoritativement, lorsque connus ; appliquer scopes de rôle, site et relais.
2. Déterminer les zones admissibles (plan du lieu, capacité déclarée, encombrement si connu, partitions marché/destination/état). Les zones fermées ou incompatibles sont exclues.
3. Parmi les zones admissibles, choisir la **charge active** minimale en unités physiquement présentes, avec rotation équitable à égalité ; jamais le nombre historique de commandes créées. Si les capacités diffèrent, préférer le ratio occupation/capacité ; si inconnues, utiliser le nombre d'unités et rendre cette limite visible.
4. Réserver/placer **atomiquement** (verrou/contrainte de concurrence, idempotence, pas deux emplacements actifs pour la même unité et le même lieu). L'agent valide par scan de l'unité et de la zone ; procédure clavier contrôlée si scanner absent.
5. Enregistrer événement de mouvement et custody ; propager les projections Hub, Relais, Order 360 en temps réel/quasi réel sans état UI local devenu autorité.
6. À départ/remise/repack/split/merge : fermer le placement précédent exactement une fois ; créer les placements des nouvelles unités si besoin. Un scan répété ne crée ni seconde présence ni double sortie.

Le moteur **n'invente pas** une présence à partir de la commande payée, de la PO, de la préparation ou du tracking. Réservation provisoire éventuelle distincte et expirante ; occupation = faits physiques confirmés. En cas de capacité saturée, perte de scan, zone incompatible ou emplacement inconnu : proposer un débordement explicite/incident, **jamais** un placement silencieux contraire à la lettre annoncée. FIFO = traitement/alertes par ancienneté lorsque le geste est éligible, **pas** refus d'un retrait client légitime au profit d'une autre commande.

## 6. Hub, PO, COMBOX, marché, relais

**Hub amont :** PO ≠ commande cliente ≠ contenant. Une PO peut agréger plusieurs commandes et lettres de tri ; on conserve la PO et `KOM-IN` autonomes, et on projette les lignes, commandes et codes de tri liés. Pas de « renommer la PO avec la lettre A » si elle contient A et B. Les colis fournisseurs sont identifiés `KOM-RCV` ; un colis entrant peut réunir plusieurs PO ou marchés et ne reçoit aucune fausse destination unique. Les réconciliations et quarantaines restent celles de HUB-001.

**Hub outbound :** une `KOM-BOX` contient éventuellement plusieurs commandes du **même marché ET de la même destination** ; elle est une unité physique rangée une seule fois ; son étiquette expose son code physique, marché/destination et zone réelle, ainsi que le manifeste traçable. La fermeture/expédition libère la zone Hub une fois la sortie physique avérée.

**Relais :** réception attestée des unités réellement arrivées, attribution/confirmation d'emplacement dans le plan local, retrait autorisé, preuve et libération. Le relais peut choisir 3 bacs, 26 zones ou des subdivisions. La livraison locale contourne totalement le Hub mais utilise le même moteur de placement au relais. Plusieurs relais d'un même marché n'ont pas de compteur d'occupation commun.

**Marchés :** `KM`, `CM`, `CG`, etc. sont des attributs métier immuables dérivés de l'ordre et des allocations, non déduits d'une lettre. Au Hub central, une zone A peut être mixte uniquement si le plan local l'autorise ; les restrictions d'accès et l'interdiction de COMBOX outbound cross-market/cross-destination ne changent pas. L'identifiant visible incluant `KM` aide à lire, ne remplace jamais la vérification serveur.

## 7. Écrans et exploitation

- Plan virtuel de chaque lieu : zones actives, sous-zones, capacité facultative, occupation **réelle**, temps de présence, anomalies et possibilité de fermer une zone (sans effacer les unités).
- Réception/rangement : « Unité KOM-BOX-… → Zone A / bac A-02 », scan zone ou saisie contrôlée, confirmation et affichage du refus si divergence.
- Recherche et remise : scan **ou** référence **ou** dossier client (selon rôle), afficher l'emplacement actuel réel avec dernière preuve, distinguer suggestion et confirmation ; aucune donnée sensible inutile sur étiquette.
- Sortie : preuve de custody/retrait puis décrément automatique des présences, y compris en cas de reclassement et retour.
- Alertes de séjour anormal calculées selon SLA par étape (Hub attente fournisseur vs Hub prêt départ vs Relais prêt retrait), sans supposer une date fixe unique ; un transit durablement bloqué ouvre une exception gouvernée.

## 8. Contre-revue demandée à Opus / Grok — questions de réfutation

1. Peut-on vraiment mettre A dans la référence **permanente de la commande** tout en promettant « zone A partout » et un équilibrage fiable des **unités physiques** locales ? Proposer une alternative sans contradiction avec un exemple Hub 5 unités / Relais 50 unités.
2. Quel événement attribue la lettre : checkout, création du premier colis, conditionnement de COMBOX ou réception au site ? Tester retard, multi-PO, fractionnement, SAV, retour et reconditionnement.
3. Une PO avec commandes A et B, ou un colis fournisseur multi-marché, porte-t-il une lettre ? Démontrer qu'on n'invente jamais une identité physique/commerciale.
4. Une lettre ou deux : mesurer les bénéfices terrain par rapport aux capacités et à la lisibilité ; définir un mécanisme d'extension sans renumérotation.
5. Comparer **équilibre des présences actuelles** vs équilibrage circulaire des références vs ratio capacités vs délais de séjour, avec scénarios d'arrivées/sorties désynchronisées.
6. Préciser writer canonique, table de placements de transit, contrôles PostgreSQL de concurrence/idempotence, provenance des compteurs et compatibilité avec `hub_physical_unit_placements` (qui suit les allocations économiques à l'intérieur des unités et ne désigne pas nécessairement une étagère).
7. Tester 2 agents recevant simultanément, scan dupliqué, sortie oubliée, zone saturée, rupture réseau, scanner absent, faux code, mauvaise destination, deux relais isolés.
8. Vérifier changement de référence et répercussions checkout, documents, Stripe/PSP, SMS, QR, suivi, recherches, G6/M03/M06, et risque d'alias devinable. Les anciens identifiants doivent rester résolubles.
9. Définir métriques d'acceptation : localisation retrouvée, zéro double emplacement, zéro fuite marché/relais, zéro changement d'allocation, cohérence dashboard/SQL, FIFO d'alerte, absence de faux PASS.
10. Rendre un verdict **ACCEPTER / AMENDER / REJETER**, avec contre-exemples et proposition de décision finale.

## 9. Conditions de passage en canonique

**HOLD** tant que la question de la lettre permanente n'est pas arbitrée et que la contre-revue indépendante n'a pas été intégrée. Ensuite seulement : impact carte-first (`logistics`, `orders`, `purchasing`, `relay`, `market`), surfaces de lecture/écriture, migration additive éventuelle, prototypes d'étiquette, tests unitaires + PG16 + négatifs, préflight, PR de code, certification par vrais gestes Chromium sur Railway staging avec API/PG, sans mock ni modification de production.

La doctrine présente est une **proposition à challenger**, et ne change aucune règle canonique avant validation explicite et fusion contrôlée.
