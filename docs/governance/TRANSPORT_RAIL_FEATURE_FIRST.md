# Feature-First — Concept `transport rail`

**Objet :** utiliser `AIR_EXPRESS / DXB → ADD → HAH` comme test de robustesse de la gouvernance feature-first avant exposition commerciale.

## Méthode

Le concept est introduit d'abord dans `DOCTRINE_TRANSPORT_RAILS.md`, puis matérialisé dans un registre runtime sans créer de checkout Express, sans pricing fictif et sans migration DB.

Le test compare le blast radius métier attendu, les relations visibles dans les cartes actuelles et la capacité réelle des gates à bloquer une évolution transverse non reconnue par ses consommateurs.

## Blast radius métier

| Feature | Impact du nouveau rail | Niveau |
|---|---|---|
| `logistics` | identité rail, corridor, éligibilité, routing, packing | propriétaire |
| `economic-engine` | coût air, poids volumétrique, surcharge, allocation | consommateur critique |
| `orders` | persistance du rail exécuté, split éventuel | consommateur critique |
| `catalog` | projection d'éligibilité produit | consommateur |
| `customs` | restrictions / exclusions transportables | consommateur critique |
| `notifications` | wording et ETA dépendants du rail | consommateur |
| `dashboard` | segmentation SEA/AIR et corridor | projection lecture |
| `shared-cart` | panier mixte et promesse avant paiement à terme | impact différé |
| `payments` | aucun impact tant qu'Express n'est pas commercialisé | hors scope initial |
| `documents` | facture / preuve si le rail devient contractuel | impact différé |

## Ce que le code réel révèle

### `services/routing.js` ne route pas un mode de transport

Le service se présente comme module central de routage logistique, mais sa décision porte sur la destination insulaire et le transit via Anjouan : `DIRECT`, `INTER_ISLAND`, `SPECIAL_ROUTE`.

Deux concepts doivent rester séparés :

- **destination routing** : relais → île → transit inter-îles ;
- **transport routing** : hub source → rail → corridor → hub d'arrivée.

`AIR_EXPRESS DXB → ADD → HAH` prouve que ces deux décisions ne peuvent plus être confondues.

### Le packing portait une contrainte universelle implicite

`parcelOptimizationService.js` possède un profil historique unique : 25 kg, 100 000 cm3 et 300 000 KMF de valeur cible.

Le runtime `transport-rails.js` porte maintenant un registre de profils de packing par rail :

- `SEA_STANDARD` reprend explicitement le profil historique ;
- `AIR_EXPRESS` a un profil `PENDING` sans valeurs inventées ;
- `UNASSIGNED` reste possible pour le legacy sans être converti silencieusement en `SEA_STANDARD`.

L'adaptateur `buildParcelsForTransportRail()` résout d'abord le profil du rail puis délègue au moteur de packing existant. `AIR_EXPRESS` échoue fermé avec `TRANSPORT_RAIL_PACKING_PROFILE_PENDING` tant que ses contraintes opérationnelles ne sont pas stabilisées.

### Ownership sain entre logistics et economic-engine

`logistics.feature.js` place le coût du transport hors périmètre et l'attribue à `economic-engine`. La séparation doctrinale reste correcte : `logistics` possède le rail et ses contraintes de packing ; `economic-engine` le valorise.

`orders` consomme déjà `logistics` et `economic-engine`, mais la persistance du rail exécuté reste le prochain contrat à matérialiser.

## Premier angle mort constaté : concepts transverses

Le mécanisme de **concept contracts** ajoute deux sources canoniques :

- `governance/concepts.json` : identité, version, révision, owner, chemins de contrat et consommateurs ;
- `governance/concept-impact-acks.json` : accusé de réception explicite de chaque consommateur pour une révision exacte.

Le gate `gate:concept-impact` impose désormais :

1. toute modification d'un chemin de contrat doit changer `revision` ;
2. chaque consommateur doit posséder exactement un ACK pour la nouvelle révision ;
3. un ACK doit être `compatible`, `adapted` ou `not-applicable` et porter une justification ;
4. un ACK vers un concept inconnu est bloqué ;
5. le gate est bloquant dans `map:check`.

Pour `transport-rail@1`, le propriétaire est `logistics`. Les consommateurs enregistrés sont `economic-engine`, `orders`, `catalog`, `customs`, `notifications` et `dashboard`.

La matérialisation du packing a bumpé le contrat vers `2026-07-11-air-express-packing-v1` et forcé un nouveau cycle complet d'ACKs.

## Deuxième angle mort constaté : faux blast radius manifest-wide

Le moteur historique `impact-check` résout un service vers son manifest de feature puis attribue au service toutes les routes et toutes les tables du manifest.

Pour `services/transport-rails.js`, qui déclare `@db-read none`, `@db-write none` et aucune route `@used-by`, le résultat est artificiellement projeté sur l'ensemble de `logistics` : 100 routes et 26 tables dans le replay observé.

La correction générique attendue est **header-first** :

1. `@db-read`, `@db-write`, `@used-by` du fichier priment lorsqu'ils existent ;
2. le manifest feature complet reste un fallback legacy pour les fichiers sans métadonnées fines ;
3. aucune suppression spécialisée AIR/SEA ne doit masquer le problème.

Ce point reste volontairement visible comme dette du moteur d'impact tant que sa correction générique n'est pas intégrée.

## Preuves de non-régression

`tests/unit/concept-impact-gate.test.js` rejoue :

- contrat modifié sans bump de révision → **BLOCK** ;
- nouvelle révision sans ACK consommateur exact → **BLOCK** ;
- bump de révision et ACK de tous les consommateurs → **PASS**.

`tests/unit/transport-rails.test.js` vérifie :

- le corridor `AIR_EXPRESS = DXB → ADD → HAH` ;
- l'absence de défaut implicite vers `SEA_STANDARD` ;
- le fail-closed des rails inconnus ;
- l'interdiction d'exposition commerciale d'AIR tant que pricing est `PENDING` ;
- le profil historique explicite de `SEA_STANDARD` ;
- le blocage du packing AIR tant que son profil est `PENDING` ;
- le chemin de packing `UNASSIGNED` et `SEA_STANDARD`.

## Suite

Le prochain lot métier est la persistance du rail exécuté dans `orders` ou l'objet logistique approprié, sans défaut maritime implicite. Ensuite seulement viennent l'éligibilité AIR et la calibration opérationnelle du profil aérien.

Aucun checkout Express ni prix aérien ne doit être exposé avant stabilisation de la valorisation.