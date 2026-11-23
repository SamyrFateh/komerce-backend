# Proposition de doctrine — Transit alphabétique et rangement virtuel Hub / Relais

**Statut : PROPOSITION SOUMISE À CONTRE-REVUE — NON CANONIQUE, NON ACTIVÉE.**
**Propriétaire de proposition : GPT ; contradicteur souhaité : Opus (ou Grok).**
**Domaines concernés :** logistics (placement/custody), orders (référence commerciale), purchasing (PO), market (isolation), relay (remise), dashboard (projections).
**Dépendances normatives :** `AGENTS.md`, `docs/doctrine/DOCTRINE_HUB_PHYSICAL_IDENTITY.md`, invariant PO mono-marché (#3247), mode sans scanner (#3900), scénario G6 (#3754).
**Portée :** doctrine et architecture à arbitrer, sans migration, changement de numéro, étiquette réelle ni modification d'API.

## 0. Arbitrage propriétaire du 23/11/2026 — autonomie terrain d'abord (prioritaire)

**Le Hub et chaque relais choisissent librement leur organisation réelle.** Au démarrage, Komerce **n'impose aucun bac, aucune lettre, aucun seuil, aucun plan ni aucune règle de classement**. Avec quelques unités qui transitent vite, l'agent peut tout garder dans une zone de transit unique **non lettrée** et retrouver directement au scan ou à la recherche : le système n'a même pas besoin d'aller jusqu'à « A ».

Si l'équipe estime qu'un tri devient utile, **elle décide elle-même** de créer une ou quelques zones (`A`, `B`, etc., ou des noms locaux), de choisir les unités à placer, de valider le placement et d'ajuster l'organisation. Le système peut **proposer** une zone, afficher la présence réelle et suggérer une répartition équilibrée, **jamais imposer la suggestion ou déplacer/réaffecter seul**. Un agent habilité peut choisir une autre zone compatible et en confirmer la réalité ; seule la confirmation explicite, jamais le calcul, fait foi.

La sophistication est **progressive et facultative** : niveau 0 sans classement, niveau 1 bacs choisis manuellement, niveau 2 suggestions d'équilibrage si l'équipe le souhaite, niveau 3 subdivisions seulement si constatées utiles. **Ni l'alphabet complet ni l'équilibrage automatique ne sont des prérequis à l'ouverture d'un site.** La simplicité du geste prime sur les optimisations numériques.

Ce principe doit gouverner toute comparaison avec Grok ou Opus, et toute future implémentation.

## 0 bis. Clarification propriétaire — **cohorte éphémère de commandes en cours**, pas identité client permanente (23/11/2026)

**Règle métier clarifiée par le propriétaire :** une racine commune aléatoire peut relier les commandes **actives d'un même destinataire dans une même vague de distribution**. Elle doit permettre au Hub de séparer les articles et au relais de regrouper rapidement les unités à remettre, mais elle **n'est jamais un numéro permanent de client**. Dès la **première remise/livraison effective au destinataire** d'une unité de cette cohorte, la cohorte est **fermée à toute nouvelle commande** : si ce destinataire commande de nouveau, une **nouvelle racine indépendante, générée aléatoirement**, lui est attribuée. Les commandes déjà rattachées à la première cohorte conservent **sans renumérotation** leur référence et leur traçabilité, même si leur livraison reste partielle ou en cours. Les deux cohortes peuvent coexister temporairement.

**Exemple purement illustratif, non adopté :**
- Avant première remise, même destinataire, même marché et même relais : `KM-B-7Q42-X8` (commande A) et `KM-B-7Q42-N5` (commande B).
- Première remise réelle d'une unité de A → cohorte `KM-B-7Q42` fermée **aux nouvelles commandes**, sans annulation ni changement des commandes A/B encore actives.
- Nouvelle commande C ensuite : `KM-F-9L61-Q2`, racine `9L61` tirée indépendamment. Ce nouveau radical **ne doit pas permettre de relier publiquement** C à A/B. `B` et `F` ne sont que de possibles groupes **logiques** de classement ; ils ne désignent **aucun bac imposé**.
- Le code du marché `KM` est permanent et lisible pour identifier l'origine commerciale ; si l'unité entrante fournisseur est réellement multi-marché, elle ne reçoit pas artificiellement un marché unique.

**Invariants de confidentialité et d'autorité :**
- Seul Komerce, via des lectures **autorisées et scoppées par rôle/marché/site**, associe racine/commandes à l'identité du destinataire. **Ni nom, ni téléphone, ni identifiant utilisateur permanent** ne doivent être déductibles du code en lui-même.
- Le radical est **opaque, aléatoire, suffisamment imprévisible** et sans structure personnelle. Les suffixes de commandes sont uniques, idéalement opaques pour ne pas exposer publiquement nombre/fréquence/ordre des achats ; collision/transactions gérées en base. Les exemples ci-dessus sont trop courts pour servir de spécification de sécurité.
- Un observateur qui voit **deux commandes avec la même racine peut comprendre qu'elles appartiennent au même groupe de distribution** : cette corrélation intra-cohorte est nécessaire au tri voulu et ne doit pas être niée. L'objectif de discrétion est surtout **l'absence de liaison publique entre les cohortes successives**, et l'absence de nom intrinsèque au code ; pas une confidentialité cryptographique fondée sur la seule discrétion du format. Aucun radical/code ne sert à authentifier une remise.
- La racine dépend d'une **identité destinataire autoritative résolue**, du marché et, pour la commodité physique du tri, du relais/destination. Ne jamais regrouper sur une simple égalité de nom, téléphone ou acheteur diaspora. Un même acheteur peut créer plusieurs cohortes pour plusieurs bénéficiaires. La décision de traiter un changement de relais/destinataire doit être explicite et fail-closed.
- L'événement clôturant l'admission est **la première remise client réellement prouvée**, pas le départ Hub, la réception du relais, un statut de commande « available » ou une impression d'étiquette. Un checkout concurrent à cette remise doit voir atomiquement soit l'ancienne cohorte encore admissible, soit une nouvelle cohorte ; aucun rattachement rétroactif non traçable.
- Si une cohorte se termine sans remise (annulation, expiration, abandon), éviter qu'elle reste réutilisable indéfiniment ; préciser sa clôture sans prétendre qu'une livraison a eu lieu.

**Séparation des objets :**
- Chaque **commande** demeure unique et immuable, avec son propre paiement, articles, statut et retrait.
- Le **destinataire** n'est pas identifié publiquement et ne porte **pas** cette racine à vie.
- Les **articles/quantités** restent reliés à la commande, la PO et aux allocations canoniques, et les COMBOX conservent leur identité propre, mono-marché/destination. Une PO ou une COMBOX **multi-clients** ne prend **jamais** la racine d'un seul destinataire.
- Le **rangement local** (aucun bac, ou bac librement déclaré) est distinct de la racine logique. **Aucun sac numérique** n'est introduit.

**Contre-revue obligatoire avant choix technique :** comparer (A) identité de commande `K...` conservée + cohortes privées recherchables sur écrans/manifestes ; (B) repère de cohorte éphémère ajouté à l'étiquette autorisée, sans remplacer la référence ; (C) nouvelle référence canonique hiérarchique. Tester retours/échanges et remises partielles, deux commandes simultanées, plusieurs relais, clients invités, usages diaspora, identités non résolues, changements de destinataire, effet de la première remise sur de nouvelles commandes, confidentialité/publication d'étiquettes, collision/concurrence, et compatibilité checkout/PSP/SAV/QR/G6.

**Attention à la compatibilité :** le code existant `services/order-service.js` émet une référence `K` + 6 caractères alphanumériques. **Aucune renumérotation d'anciennes commandes** ni changement immédiat des identifiants canoniques n'est autorisé par la présente hypothèse. L'objectif est un **regroupement de livraison limité dans le temps**, non un identifiant client pérenne. Verdict `REVIEW_PENDING` ; ni code ni migration avant arbitrage.

## 1. Problème et objectif métier

Komerce organise un **transit temporaire**, pas un stock commercial résident : le Hub reçoit/contrôle/constitue et expédie ; les relais réceptionnent puis remettent. Les volumes futurs, les surfaces, les bacs et l'organisation des sites sont inconnus. Chaque site doit pouvoir étiqueter librement ses zones physiques (`A` à `Z`, puis subdivisions), tout en utilisant un langage commun et des écrans synchronisés.

Objectif terrain, *seulement si un classement est utile au site* : « je vois A sur l'unité, je vais en A ; je scanne, Komerce sait où elle est ; quand elle sort la place est libérée ». À faible volume, « je reçois, je pose, je retrouve et je remets » peut suffire, **sans aucune lettre**. On cherche une **orientation intuitive** puis une localisation autoritative, pas une numérotation du client ni une gestion de stock long terme.

L'équilibrage porte sur le **nombre d'unités physiques actuellement en transit**, jamais sur le nombre de clients ou de commandes commerciales. Une COMBOX fermée = une unité physique, même si elle porte plusieurs commandes ; si elle est déconditionnée, les nouvelles unités manipulées sont comptées chacune à leur emplacement. L'âge en transit est suivi et les anomalies prolongées sont signalées.

## 2. Trois identités qui ne doivent pas se confondre

1. **Commande commerciale** (orders) : référence permanente et liens vers paiement, client, marché, destination, SAV, documents. La référence actuelle est utilisée largement ; ne jamais la renommer en place sans plan de compatibilité.
2. **Unité physique** (hub_physical_units / parcels selon étape) : `KOM-RCV`, `KOM-ITEM`, `KOM-BOX`, colis remis au relais, identifiant de scan et chaîne de custody. Une commande peut alimenter plusieurs unités ; une unité peut agréger plusieurs commandes.
3. **Placement temporaire par site** : code de tri lisible, zone/emplacement réel, entrée, déplacement, sortie et durée de séjour ; propre à un lieu et à un épisode de transit, sans réécrire les allocations Purchasing ni l'identité physique.

Le libellé commercial **envisagé** est `COM-A-KM-<suffixe_non_séquentiel_unique>` : `COM` famille visible, `A` groupe alphabétique, `KM` marché, suffixe opaque avec contrainte d'unicité DB et nouvelle tentative en collision. Ceci est un **alias/logistic display reference** à discuter ; il **ne remplace pas** à ce stade les références `K...`, `KOM-...`, `KOM-P...`, `KOM-IN...` ou `KOM-BOX...`. Ne jamais traiter la lettre ni un suffixe peu prévisible comme une preuve d'autorisation, de paiement ou de remise.

**Attention :** un `COM-A-...` rattaché à la commande ne démontre PAS qu'une COMBOX multi-commandes doive être rangée en A. L'unité physique porte sa propre localisation, déterminée à l'endroit où elle est réellement manipulée.

## 3. Une lettre ou deux ?

**Hypothèse uniquement si le site choisit un classement : une lettre de premier niveau (`A`–`Z`)**, intuitive à lire et signaler, indépendamment du nombre de commandes. **Zéro lettre est également un fonctionnement normal et complet.** Une même lettre est réutilisée indéfiniment ; l'unicité vient de l'identité canonique, pas du nombre de lettres.

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

**Uniquement si le site a activé un classement local et que l'unité doit effectivement être posée dans un bac :**
1. Identifier l'unité par son code canonique ; résoudre son marché/destination autoritativement, lorsque connus ; appliquer scopes de rôle, site et relais.
2. Déterminer les zones admissibles (plan du lieu, capacité déclarée, encombrement si connu, partitions marché/destination/état). Les zones fermées ou incompatibles sont exclues.
3. **Proposer, sans décider à la place de l'agent**, la zone compatible la moins occupée en unités physiquement présentes (rotation possible à égalité) ; jamais le nombre historique de commandes créées. Capacités et ratios sont facultatifs ; l'agent peut ignorer la suggestion et choisir une autre zone compatible.
4. **L'agent choisit et confirme** le bac réel (scan de l'unité et de la zone ou saisie contrôlée si nécessaire). **Seulement cette confirmation** crée le séjour de placement atomique (verrou/contrainte de concurrence, idempotence, pas deux emplacements actifs pour la même unité et le même lieu). Une suggestion non acceptée ne crée ni réservation ni présence.
5. Enregistrer événement de mouvement et custody ; propager les projections Hub, Relais, Order 360 en temps réel/quasi réel sans état UI local devenu autorité.
6. À départ/remise/repack/split/merge : fermer le placement précédent exactement une fois ; créer les placements des nouvelles unités si besoin. Un scan répété ne crée ni seconde présence ni double sortie.

Le moteur **n'invente pas** une présence à partir de la commande payée, de la PO, de la préparation ou du tracking. Réservation provisoire éventuelle distincte et expirante ; occupation = faits physiques confirmés. En cas de capacité saturée, perte de scan, zone incompatible ou emplacement inconnu : proposer un débordement explicite/incident, **jamais** un placement silencieux contraire à la lettre annoncée. FIFO = traitement/alertes par ancienneté lorsque le geste est éligible, **pas** refus d'un retrait client légitime au profit d'une autre commande.

## 6. Hub, PO, COMBOX, marché, relais

**Invariant opérationnel confirmé le 23/11 — AUCUNE ENTITÉ SAC :** Le flux Hub normal est **direct vers la COMBOX** (PR [#5127](https://github.com/SamyrFateh/komerce-backend/pull/5127), fusionnée le 22/11). Les sacs ne sont **pas** des identités logistiques : pas de référence, scan, statut, cycle de vie, writer ou rattachement client obligatoire pour un sac. Un sac matériel librement utilisé par un agent est seulement un accessoire de protection/anti-perte. Il ne sert ni d'unité de tri persistée ni de prérequis à la création/remplissage/fermeture des COMBOX. La traçabilité est **article / allocation / commande → KOM-BOX**, puis unité(s) réellement remises au relais/client. Le code historique relatif aux sacs, s'il reste nécessaire à la consultation rétrocompatible, ne constitue pas la doctrine cible. L'audit Sonnet sur une PR #5127 « ouverte » reflète une branche antérieure : ne pas réintroduire le sac numérique en s'appuyant sur ses anciens états ou sur son ancienne interface.


**Hub amont :** PO ≠ commande cliente ≠ contenant. Une PO peut agréger plusieurs commandes et lettres de tri ; on conserve la PO et `KOM-IN` autonomes, et on projette les lignes, commandes et codes de tri liés. Pas de « renommer la PO avec la lettre A » si elle contient A et B. Les colis fournisseurs sont identifiés `KOM-RCV` ; un colis entrant peut réunir plusieurs PO ou marchés et ne reçoit aucune fausse destination unique. Les réconciliations et quarantaines restent celles de HUB-001.

**Hub outbound :** une `KOM-BOX` contient éventuellement plusieurs commandes du **même marché ET de la même destination** ; elle est une unité physique rangée une seule fois ; son étiquette expose son code physique, marché/destination et zone réelle, ainsi que le manifeste traçable. La fermeture/expédition libère la zone Hub une fois la sortie physique avérée.

**Relais :** réception attestée des unités réellement arrivées ; **rangement libre** sans bac obligatoire, ou placement confirmé dans un bac choisi par l'agent si le site s'organise ainsi ; retrait autorisé, preuve et libération. Le relais peut choisir zéro bac lettré, 1 bac, 3 bacs, 26 zones ou des subdivisions. La livraison locale contourne totalement le Hub mais utilise le même moteur de placement au relais. Plusieurs relais d'un même marché n'ont pas de compteur d'occupation commun.

**Marchés :** `KM`, `CM`, `CG`, etc. sont des attributs métier immuables dérivés de l'ordre et des allocations, non déduits d'une lettre. Au Hub central, une zone A peut être mixte uniquement si le plan local l'autorise ; les restrictions d'accès et l'interdiction de COMBOX outbound cross-market/cross-destination ne changent pas. L'identifiant visible incluant `KM` aide à lire, ne remplace jamais la vérification serveur.

## 7. Écrans et exploitation

- **Mode de base sans paramétrage** : consultation des unités présentes, recherche/scans et sorties ; aucune gestion de bacs exigée. **Seulement sur décision locale**, plan facultatif du lieu : zones choisies, sous-zones facultatives, capacité facultative, occupation **réelle**, ancienneté et fermeture possible d'une zone (sans effacer les unités).
- Réception/rangement : d'abord réceptionner et tracer l'unité. **Si l'agent a choisi un bac**, proposer « Unité KOM-BOX-… → Zone A » sans l'imposer ; l'agent confirme A ou un autre bac compatible via scan/saisie. Sans bac configuré, aucune étape supplémentaire.
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
11. **Contrainte de simplicité prioritaire** : prouver que l'exploitation sans aucune lettre ni bac déclaré reste possible, que l'agent décide de son organisation et que le système n'impose jamais une zone suggérée, même si l'algorithme préfère un équilibrage différent.

## 9. Conditions de passage en canonique

**HOLD** tant que la question de la lettre permanente n'est pas arbitrée et que la contre-revue indépendante n'a pas été intégrée. Ensuite seulement : impact carte-first (`logistics`, `orders`, `purchasing`, `relay`, `market`), surfaces de lecture/écriture, migration additive éventuelle, prototypes d'étiquette, tests unitaires + PG16 + négatifs, préflight, PR de code, certification par vrais gestes Chromium sur Railway staging avec API/PG, sans mock ni modification de production.

La doctrine présente est une **proposition à challenger**, et ne change aucune règle canonique avant validation explicite et fusion contrôlée.
