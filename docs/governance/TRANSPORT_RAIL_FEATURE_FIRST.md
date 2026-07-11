# Feature-First — Concept `transport rail`

**Objet :** utiliser `AIR_EXPRESS / DXB → ADD → HAH` comme test de robustesse de la gouvernance feature-first avant implémentation métier.

## Méthode

Le concept est introduit d'abord dans `DOCTRINE_TRANSPORT_RAILS.md`, sans créer de checkout Express, sans pricing fictif et sans migration DB.

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

Deux concepts doivent être séparés :

- **destination routing** : relais → île → transit inter-îles ;
- **transport routing** : hub source → rail → corridor → hub d'arrivée.

`AIR_EXPRESS DXB → ADD → HAH` prouve que ces deux décisions ne peuvent plus être confondues.

### `parcelOptimizationService.js` possède des contraintes universelles implicites

Le moteur fixe notamment `maxParcelWeightKg: 25`, `maxParcelVolumeCm3: 100_000`, `targetParcelValueKmf: 300_000` et une fonction de score unique indépendante du rail.

La doctrine AIR/SEA interdit désormais de considérer ces paramètres comme universels sans qualification. Le moteur devra recevoir un profil de contraintes dérivé du rail ou travailler explicitement en `UNASSIGNED`.

### Ownership sain entre logistics et economic-engine

`logistics.feature.js` place le coût du transport hors périmètre et l'attribue à `economic-engine`. La séparation doctrinale est correcte : `logistics` possède le rail ; `economic-engine` le valorise.

`orders` consomme déjà `logistics` et `economic-engine`, mais aucun contrat positif n'affirmait qu'une décision de rail exécutée devait être persistée sans défaut maritime implicite.

## Angle mort constaté

La gouvernance était robuste pour l'ownership des fichiers applicatifs, l'absence d'orphelins, la cohérence interne des manifests, les contrats positifs déjà connus et la remontée routes/tables depuis un fichier modifié.

Elle ne détectait pas l'introduction ou l'évolution d'un concept métier transverse avant matérialisation dans du code déjà cartographié.

`gate:touched-files` exclut volontairement `docs/**`, `*.md` et `*.feature.js`. Il répond correctement à « le code applicatif touché a-t-il un propriétaire ? », mais pas à « une capacité doctrinale transverse a-t-elle été reconnue par tous ses consommateurs ? ».

`feature-audit` orchestre des contrats positifs par feature, mais un concept nouveau reste invisible tant qu'aucun contrat ne sait l'exprimer.

`impact-check` construit un graphe technique fichier → feature → routes/tables. Il ne porte pas de blast radius sémantique.

## Renforcement livré

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

## Preuve de non-régression

`tests/unit/concept-impact-gate.test.js` rejoue trois scénarios :

- contrat modifié sans bump de révision → **BLOCK** ;
- nouvelle révision sans ACK consommateur exact → **BLOCK** ;
- bump de révision et ACK de tous les consommateurs → **PASS**.

Le cas `AIR_EXPRESS` a donc servi de sonde architecturale et a produit un gate générique. Aucun grep spécialisé AIR/SEA n'a été ajouté.

## Suite

La prochaine étape est la matérialisation technique minimale du concept `transport rail` en statut interne : identité de rail, corridor, statut de pricing et exposition commerciale. Elle devra passer par le nouveau gate et provoquer des ACKs adaptés dès qu'un contrat de concept évolue.

Aucun checkout Express ni prix aérien ne doit être exposé avant stabilisation de la valorisation.
