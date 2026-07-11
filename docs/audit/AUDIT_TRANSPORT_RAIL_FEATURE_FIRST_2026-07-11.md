# Audit Feature-First — Introduction du concept `transport rail`

**Date :** 2026-07-11  
**Objet :** utiliser `AIR_EXPRESS / DXB → ADD → HAH` comme test de robustesse de la gouvernance feature-first avant implémentation métier.

---

## 1. Méthode

Le concept est introduit d'abord dans `DOCTRINE_TRANSPORT_RAILS.md`, sans créer de checkout Express, sans pricing fictif et sans migration DB.

L'audit compare :

1. le blast radius métier attendu ;
2. ce que les manifests et cartes actuels savent relier ;
3. ce que les gates bloquantes détecteraient réellement si seule la doctrine change ;
4. les angles morts à fermer avant l'implémentation de `AIR_EXPRESS`.

---

## 2. Blast radius métier attendu

| Feature | Impact attendu du nouveau rail | Niveau |
|---|---|---|
| `logistics` | identité rail, corridor, éligibilité, routing, packing | propriétaire |
| `economic-engine` | coût air, poids volumétrique, surcharge, allocation | consommateur critique |
| `orders` | persistance du rail exécuté, split éventuel | consommateur critique |
| `catalog` | projection d'éligibilité produit | consommateur |
| `customs` | restrictions / exclusions transportables | fournisseur de contraintes |
| `notifications` | wording et ETA dépendants du rail | consommateur |
| `dashboard` | segmentation SEA/AIR et corridor | projection lecture |
| `shared-cart` | panier mixte et promesse avant paiement à terme | impact différé |
| `payments` | aucun impact tant qu'Express n'est pas commercialisé | hors scope initial |
| `documents` | facture / preuve si le rail devient contractuel | impact différé |

---

## 3. Ce que le code réel révèle déjà

### 3.1 `services/routing.js` ne route pas un mode de transport

Le service se présente comme « module central de routage logistique », mais sa décision porte uniquement sur la destination insulaire et le transit via Anjouan : `DIRECT`, `INTER_ISLAND`, `SPECIAL_ROUTE`.

Il encode aussi l'hypothèse : **« Hub principal : ANJOUAN (tout transite par Anjouan) »**.

Conclusion : le mot `routing` masque actuellement deux concepts distincts :

- **destination routing** : relais → île → transit inter-îles ;
- **transport routing** : hub source → rail → corridor → hub d'arrivée.

`AIR_EXPRESS DXB → ADD → HAH` prouve que ces deux décisions ne peuvent plus être confondues.

### 3.2 `parcelOptimizationService.js` possède des contraintes universelles implicites

Le moteur fixe notamment :

- `maxParcelWeightKg: 25` ;
- `maxParcelVolumeCm3: 100_000` ;
- `targetParcelValueKmf: 300_000` ;
- une fonction de score unique indépendante du rail.

Ces paramètres peuvent être cohérents pour un mode d'exploitation donné, mais la doctrine AIR/SEA interdit désormais de les considérer comme universels sans qualification.

Le moteur doit à terme recevoir un **profil de contraintes dérivé du rail** ou travailler explicitement en `UNASSIGNED`.

### 3.3 La feature `logistics` exclut explicitement le coût transport

Le manifest `logistics.feature.js` place « coût du transport » hors périmètre et l'attribue à `economic-engine`.

C'est sain et confirme la séparation doctrinale : `logistics` possède le rail ; `economic-engine` le valorise.

### 3.4 `orders` consomme déjà `logistics` et `economic-engine`

Le manifest `orders.feature.js` déclare les deux dépendances. La couture existe donc conceptuellement, mais aucun contrat positif n'affirme aujourd'hui :

> « une décision de rail exécutée est persistée et ne peut pas être remplacée par un défaut maritime implicite ».

---

## 4. Résultat du test de gouvernance

### Gate 1 — `gate:touched-files`

**Résultat conceptuel : angle mort confirmé.**

Le gate exclut explicitement :

- `docs/**` ;
- `*.md` ;
- `*.feature.js`.

Donc l'introduction d'une doctrine métier transverse et même la modification d'un manifest de feature sont classées « hors périmètre de gouvernance » par le gate de fichiers touchés.

Ce gate répond correctement à :

> « le code applicatif touché a-t-il un propriétaire ? »

Il ne répond pas à :

> « une nouvelle capacité doctrinale traverse-t-elle plusieurs features qui doivent accuser réception ? »

### `feature-audit`

**Résultat conceptuel : détection conditionnelle, insuffisante ici.**

Le runner exécute des **contrats positifs déclarés par chaque feature**. C'est une bonne architecture, mais un nouveau concept n'est détectable que si les manifests possèdent déjà un contrat capable de l'exprimer.

Aujourd'hui aucun contrat positif `transport-rail` n'existe. La doctrine peut donc introduire `AIR_EXPRESS` sans faire tomber un contrat de `orders`, `economic-engine`, `notifications` ou `dashboard`.

### `impact-check`

**Résultat conceptuel : graphe technique, pas blast radius sémantique.**

Le moteur construit un index `fichier → feature → routes/tables`. Lorsqu'un service est touché, il remonte les routes et tables déclarées de sa feature.

Il ne lit pas les concepts métier introduits dans une doctrine et ne sait pas imposer une chaîne d'accusé de réception inter-features.

### `feature-registry`

Le registre sait que :

- `logistics` gère transporteurs et transit ;
- `economic-engine` gère pricing/coûts ;
- `orders` consomme les deux.

Mais le schéma d'interfaces est descriptif. Il ne porte pas encore de **concept partagé versionné** dont les consommateurs doivent reconnaître l'évolution.

---

## 5. Verdict

La gouvernance Komerce est robuste pour :

- l'ownership des fichiers applicatifs ;
- l'absence d'orphelins ;
- la cohérence interne des manifests ;
- les contrats positifs déjà connus ;
- la remontée technique routes/tables à partir d'un fichier modifié.

Elle possède un angle mort précis :

> **elle ne détecte pas encore l'introduction ou l'évolution d'un concept métier transverse avant que ce concept se matérialise dans du code déjà cartographié.**

`transport rail` est le premier cas de test explicite de cette classe d'impact.

---

## 6. Correction de gouvernance recommandée

Créer un mécanisme de **concept contracts**.

Exemple cible :

```js
concepts: {
  provides: ['transport-rail@1'],
  consumes: []
}
```

pour `logistics`, et :

```js
concepts: {
  consumes: ['transport-rail@1']
}
```

pour `orders`, `economic-engine`, `catalog`, `customs`, `notifications`, `dashboard`.

Une évolution vers `transport-rail@2` ou une modification du contrat canonique doit forcer :

1. l'identification des consommateurs ;
2. un `ack` explicite dans la PR (`compatible`, `adapted`, `not-applicable`) ;
3. le blocage CI si un consommateur critique n'a pas accusé réception.

### Gate proposé

`gate:concept-impact`

Entrées :

- manifests `features/*.feature.js` ;
- registre des concepts versionnés ;
- diff Git.

Sortie attendue pour le cas présent :

```text
CONCEPT CHANGED: transport-rail@1
OWNER: logistics
REQUIRED ACK:
  economic-engine  MISSING
  orders           MISSING
  catalog          MISSING
  customs          MISSING
  notifications    MISSING
  dashboard        MISSING
BLOCK
```

---

## 7. Ordre de chantier

1. Doctrine `transport rail` — fait dans cette PR.
2. Ajouter `concepts.provides/consumes` aux manifests concernés.
3. Créer le registre canonique des concepts métier versionnés.
4. Implémenter `gate:concept-impact` avec tests de non-régression.
5. Rejouer le test `AIR_EXPRESS` et vérifier que le gate bloque sans ACK.
6. Seulement ensuite créer le modèle technique `transport rail` en statut interne.
7. Lancer l'implémentation métier et laisser la gouvernance produire la carte d'impact réelle.

---

## Conclusion

L'introduction de `AIR_EXPRESS` valide l'intuition initiale : le sujet traverse suffisamment de features pour tester la vérité de la gouvernance.

Le système actuel voit très bien **les fichiers que l'on touche**. Il ne voit pas encore assez tôt **le concept métier que l'on vient d'introduire**.

Le prochain renforcement doit donc porter sur la gouvernance des **concepts inter-features versionnés**, pas sur un nouveau grep spécialisé « AIR/SEA ».
