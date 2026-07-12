# Doctrine Transport Rails — Komerce

> **Version** : 0.1 — 2026-07-11
> **Statut** : doctrine active, capacité interne non commercialisée
> **Feature propriétaire** : `logistics`
> **Features consommatrices** : `orders`, `economic-engine`, `catalog`, `notifications`, `dashboard`, `customs`

---

## 1. Décision métier

Komerce reconnaît plusieurs **rails d'acheminement** depuis ses hubs de consolidation.

Un rail de transport est une capacité logistique connue du système. Son existence métier et architecturale ne dépend pas de l'existence d'un prix client stabilisé.

> **Rail connu ≠ rail commercialisé.**

L'absence temporaire d'une valorisation tarifaire stabilisée limite l'exposition commerciale d'un rail ; elle ne l'efface ni du modèle logistique ni de la cartographie d'impact.

---

## 2. Rails initiaux

| Code canonique | Rôle | Statut capacité | Pricing | Exposition commerciale |
|---|---|---|---|---|
| `SEA_STANDARD` | volume / coût / consolidation maritime | `ACTIVE` | `ACTIVE` | `PUBLIC` |
| `AIR_EXPRESS` | rapidité / urgence / faible délai | `INTERNAL` | `PENDING` | `DISABLED` |

Le corridor aérien initial reconnu par Komerce est :

`DXB → ADD → HAH`

soit **Dubaï → Addis-Abeba → Moroni**.

Cette route est enregistrée comme corridor métier à étudier et exploiter. La fréquence réelle, les cut-offs, capacités cargo, exclusions marchandises, délais et engagements de service restent des paramètres d'exploitation à confirmer avant exposition client.

---

## 3. Séparation des responsabilités

La chaîne de décision est :

`CAPACITÉ LOGISTIQUE → ÉLIGIBILITÉ → ROUTING → PACKING → VALORISATION → EXPOSITION COMMERCIALE`

### `logistics` — autorité sur le rail

Possède :

- identité canonique du rail ;
- corridor et hubs de transit ;
- statut opérationnel ;
- contraintes d'éligibilité transport ;
- décision de routing logistique ;
- compatibilité du packing avec le rail.

### `economic-engine` — autorité sur la valorisation

Possède :

- coût estimé et réel du rail ;
- poids volumétrique et règles de coût ;
- surcharge express ;
- allocation du coût aux commandes / colis ;
- stratégie de marge et exposition d'un prix client.

Le moteur économique **ne crée pas un rail**. Il valorise un rail connu de `logistics`.

### `orders` — persistance du choix exécuté

La commande doit pouvoir conserver le rail retenu ou l'absence de décision. `orders` ne décide pas seul du rail et ne doit pas déduire `SEA_STANDARD` par défaut implicite.

### `catalog` — projection d'éligibilité

Le catalogue peut exposer qu'un produit est potentiellement éligible à un rail. Il ne promet ni prix ni délai sans décision consolidée des moteurs logistique et économique.

### `notifications` — projection de la promesse

Les messages doivent dériver du rail réellement retenu. Aucun wording ne doit supposer implicitement un transport maritime.

### `dashboard` — pilotage

Le pilotage doit pouvoir segmenter les flux par rail et corridor. Le dashboard reste une projection en lecture ; il ne décide pas du routing.

### `customs` — contraintes réglementaires

Les contraintes de transport ou de déclaration qui rendent un produit non éligible à un rail doivent être consommables par `logistics`.

---

## 4. Invariants

1. **Aucun rail implicite.** L'absence de `transport_rail` n'est jamais interprétée silencieusement comme `SEA_STANDARD` dans une nouvelle logique.
2. **Rail connu avant pricing.** Un rail peut être `INTERNAL/PENDING/DISABLED` et rester un concept métier valide.
3. **Pas d'exposition sans valorisation.** `pricing_status != ACTIVE` interdit l'affichage d'un prix ou d'une promesse Express au client.
4. **Le routing précède le packing.** Le packing doit connaître le rail ou travailler explicitement en mode `UNASSIGNED` ; ses contraintes ne sont pas universelles.
5. **Le rail est persisté.** Une décision de transport exécutée doit être traçable sur l'objet logistique ou la commande concernée.
6. **Le split est autorisé par doctrine.** Un panier ou une commande peut produire plusieurs flux si les rails retenus diffèrent ; le split doit être explicite et traçable.
7. **Le frontend ne décide jamais du rail.** Il affiche une option éligible et valorisée fournie par le backend.
8. **Les délais sont propres au corridor.** Aucun délai générique « livraison » ne doit être codé comme vérité universelle.

---

## 5. État initial `AIR_EXPRESS`

```text
code                AIR_EXPRESS
corridor            DXB > ADD > HAH
capacity_status     INTERNAL
pricing_status      PENDING
commercial_exposure DISABLED
```

Conséquence immédiate :

- le rail entre dans la doctrine et la carte d'impact ;
- il ne doit pas encore apparaître au checkout ;
- aucun prix Express ne doit être inventé ;
- aucune promesse de délai ferme ne doit être affichée ;
- les hypothèses maritimes existantes deviennent des hypothèses à auditer.

---

## 6. Règle d'évolution

Toute création ou modification d'un rail doit déclencher une revue au minimum des features suivantes :

`logistics → economic-engine → orders → catalog → customs → notifications → dashboard`

Si la gouvernance automatique ne remonte pas cette chaîne d'impact, l'écart est une **dette de gouvernance** à corriger avant commercialisation du rail.
