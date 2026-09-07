# Doctrine — autonomie du responsable pays

> Version 1.0 — 2026-09-07  
> Statut : doctrine cible du chantier Market Operator / délégation pays

## Phrase de vérité

> **Le responsable pays décide et exploite son marché. Komerce central définit les frontières du système, pas la stratégie commerciale locale.**

`MARKET` est l'unité de délégation business. Un responsable pays doit pouvoir travailler sans solliciter l'autorité centrale pour une décision qui ne produit d'effet que dans ses marchés explicitement autorisés.

L'autonomie n'est pas un rôle décoratif. Elle est prouvée capacité par capacité :

```text
Droit accordé
+ périmètre serveur
+ outil disponible
+ mutation réellement autorisée
+ audit
= autonomie effective
```

Un droit affiché sans outil utilisable est un manque fonctionnel.

## 1. Deux niveaux de délégation

### Viewer

Le viewer peut lire toutes les informations nécessaires à la compréhension de son marché et simuler sans écriture. Il ne peut pas créer de décision persistée ni modifier un paramètre métier.

### Manager

Le manager est le **responsable opérationnel et commercial du marché**. Dans son scope serveur, il peut décider, configurer et déléguer les fonctions locales prévues par cette doctrine.

Un `manager` satisfait aussi toutes les capacités `viewer`.

## 2. Autorité locale du manager

Le manager pays possède, dans son marché :

- Pilotage : dashboards, détails, alertes, exports et objectifs locaux.
- Commerce : offre locale, stratégie commerciale, concurrence, promotions et prix locaux.
- Pricing : atelier des coûts, simulation d'impact, hypothèses locales et décisions tarifaires.
- Opérations : commandes, exceptions, incidents, SLA, douane, hub, relais et livraison selon les features réellement disponibles.
- Réseau : création/configuration/suspension des relais et partenaires locaux dans les limites contractuelles du système.
- Équipe : rattachement et retrait d'utilisateurs locaux, avec délégation de droits qu'il possède lui-même.
- Client/SAV : consultation des dossiers et traitement des demandes locales sans falsifier les historiques immuables.
- Finance pays : lecture des recettes, coûts, marges, rapprochements et justificatifs ; actions financières uniquement lorsqu'une feature métier les rend explicitement sûres et auditables.
- Configuration locale : contacts, horaires, informations publiques et paramètres d'exploitation du marché.

Les fonctions terrain (`scan`, `encaissement`, `expédition`, etc.) restent des capacités explicites. Être manager ne transforme pas automatiquement le compte en agent terrain.

## 3. Prix local : décision du marché

Le prix commercial d'un produit peut diverger par marché sans dupliquer le catalogue produit.

Le catalogue reste unique. `products.price_kmf` demeure la base/catalogue globale et ne doit jamais être écrasée pour satisfaire une décision locale.

La vérité commerciale locale suit ce modèle :

```text
produit global
+ market_id résolu côté serveur
+ décision de prix local
+ devise issue de markets.currency
+ gates économiques
= prix commercial effectif du marché
```

Le navigateur ne fournit jamais `market_id` comme autorité et ne choisit jamais la devise faisant foi. Le serveur résout le marché et sa devise.

Le manager décide le prix. **Komerce central n'approuve pas la stratégie locale.** Le moteur peut en revanche refuser techniquement l'activation d'une décision qui viole un gate économique ou une règle de sécurité.

La distinction est fondamentale :

```text
humain pays = décide la stratégie
moteur       = vérifie les invariants économiques
central      = gouverne les règles communes et le hors-périmètre
```

## 4. Prix local et Currency Boundary

La devise du marché provient exclusivement de `markets.currency`.

- Cameroun / Congo : le manager manipule le prix local dans la devise du marché (actuellement XAF pour les marchés concernés).
- Comores : KMF.
- Mayotte : EUR.

Une projection de `price_kmf` via `currency_parities` est un **affichage/proxy de base**, pas une décision commerciale locale.

Le système doit donc distinguer explicitement :

- `GLOBAL_BASE_NO_LOCAL_DECISION` : aucune décision pays ; la base globale reste la référence.
- `LOCAL_DRAFT_PENDING_GATE` : décision pays enregistrée, pas encore autorisée dans les flux acheteur.
- `LOCAL_ACTIVE` : décision pays passée par les gates et réellement consommée par catalogue/panier/commande.

Aucun fallback ne doit faire croire qu'un brouillon est déjà actif.

## 5. Gates économiques : pas de validation centrale déguisée

Une décision locale ne requiert pas l'accord du central. Son activation dépend uniquement de règles communes, explicites, versionnées et auditables.

Le gate de couverture marché conserve ses états canoniques :

- `COVERED`
- `UNCOVERED`
- `NOT_DECISIONAL`

Le manager peut toujours simuler. Une nouvelle position sous CDR n'est activable que si le gate l'autorise ou si une exception stratégique gouvernée et financée existe selon la doctrine pricing.

Un refus du moteur doit dire **pourquoi** et ce qu'il manque ; il ne renvoie jamais vers « demander à l'admin » comme mécanisme normal de stratégie pays.

## 6. Ce qui reste central

Komerce central conserve uniquement les décisions qui dépassent un marché :

- création et activation d'un nouveau marché ;
- nomination/révocation du responsable pays et attribution de ses markets ;
- règles communes du moteur et invariants de sécurité ;
- modèle structurel global des composants de coût ;
- allocation et consolidation cross-market ;
- autorités globales ;
- engagements juridiques/financiers qui dépassent le périmètre délégué ;
- capacité d'accorder un droit que le délégant ne possède pas lui-même.

Le central peut observer et auditer un marché. L'observation globale ne lui attribue pas implicitement la propriété de la stratégie commerciale locale.

## 7. Fail closed

- `market_operator` sans scope actif : 403.
- scope vide : aucune donnée, jamais global.
- market demandé hors scope : 403 explicite.
- viewer : simulation possible, aucune mutation persistée.
- manager : mutations locales uniquement dans le marché résolu.
- aucune mutation locale ne peut modifier silencieusement une vérité globale.

## 8. Dashboard de délégation

La surface « Marchés & délégations » doit présenter pour chaque responsable et chaque marché :

```text
Identité
Marché
Niveau viewer | manager
Capacité
Périmètre
État: disponible | manquante | bloquée
Outil / URL
Dernière preuve d'accès
Dernière mutation auditée
```

Le dashboard doit répondre immédiatement à deux questions :

1. **A-t-il le droit ?**
2. **Peut-il réellement faire le travail avec l'UI et les APIs présentes ?**

## 9. Séquence d'exécution

Le chantier se ferme par tranches verticales testables :

1. Atelier pays : lecture + simulation + coûts, viewer/manager correctement séparés.
2. Prix local : décision en devise du marché + audit.
3. Activation prix : branchement du gate économique puis consommation par catalogue/panier/commande.
4. Stratégie locale : comparables, promotions et actions commerciales market-scoped.
5. Réseau/opérations/équipe/finance : matrice d'autonomie vérifiée endpoint par endpoint.
6. E2E staging manager/viewer CM/CG : connexion, navigation, mutation autorisée, mutation interdite, isolation inter-marchés et preuve du prix réellement consommé.

## 10. Gate de sortie du chantier

Le chantier n'est terminé que lorsqu'un manager pays de staging peut, sans compte central :

- se connecter sans fallback boutique ;
- voir uniquement ses marchés ;
- accéder aux quatre dashboards ;
- ouvrir l'Atelier des coûts ;
- simuler sans écriture ;
- modifier ses hypothèses locales ;
- décider un prix dans la monnaie locale ;
- voir l'impact économique avant activation ;
- activer un prix autorisé par les gates ;
- constater ce prix dans le parcours acheteur de son marché ;
- administrer les fonctions locales livrées par les workspaces ;
- déléguer à son équipe sans pouvoir dépasser ses propres droits ;
- obtenir un 403 sur un marché étranger et sur toute autorité globale.

> **La stratégie pays appartient au pays ; la sécurité et la vérité économique appartiennent au système.**
