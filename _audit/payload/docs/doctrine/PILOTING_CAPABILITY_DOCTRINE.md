# Doctrine des Piloting Capabilities — Komerce

> **Version** : 1.0 — 2026-07-12
> **Statut** : doctrine active, créée en prérequis du Lot O1 (Business Feature
> Ontology Refactor). Référencée par `AGENTS.md` et par
> `docs/doctrine/FEATURE_DOCTRINE.md`, mais gouvernée ici, séparément.
> **Pourquoi un document séparé et pas une extension de `FEATURE_DOCTRINE.md`** :
> une piloting capability ne rend pas un service métier au sens de la doctrine
> feature (pas de client, pas de cycle de vie métier propre, pas d'"authority"
> produit). La confondre avec un `kind` de feature (même via un nouveau kind
> `piloting-capability` dans `ALLOWED_KINDS`) inviterait à terme à lui donner un
> `perimeter.in` orienté client, ce qui est précisément l'erreur que ce lot
> corrige pour `decision-signals`. Une gouvernance distincte, avec son propre
> schéma minimal, rend cette confusion structurellement impossible.

---

## 1. Qu'est-ce qu'une piloting capability ?

Une **piloting capability** est un mécanisme transverse d'observation, de
détection ou d'aide à la décision, consommé par des humains qui pilotent la
plateforme (admin, ops, finance) ou par des projections (`dashboard`), mais qui :

- ne rend **aucun service directement perceptible par un client final** ;
- ne possède **aucun cycle de vie métier** (pas de state machine produit,
  pas de statut de commande, pas de solde) ;
- n'est l'**autorité** d'aucune règle métier — elle observe des données produites
  par des features, elle ne les *décide* pas ;
- peut écrire ses propres tables techniques (ex. `signals`) sans que cela en
  fasse une feature : ces tables stockent des *constats*, pas des *décisions
  métier engageantes*.

**Différence avec une feature** : une feature répond à *"quel service rend ce
code à un client ou à une opération engageante ?"*. Une piloting capability
répond à *"qu'est-ce que ce code permet de voir ou de détecter que personne ne
verrait sinon ?"*.

**Différence avec une projection (`dashboard`)** : une projection agrège et
affiche des données déjà possédées par des features. Une piloting capability
**produit** de la donnée dérivée nouvelle (un signal, un score, une alerte) à
partir de données métier — elle a un moteur de calcul propre, une projection
n'en a pas.

---

## 2. Ce qu'une piloting capability n'est jamais

- Elle n'est **jamais** un `kind` de `features/*.feature.js` (voir
  `FEATURE_DOCTRINE.md` — les `kind` assignables restent
  `business-feature | business-transversal | technical-transversal |
  aggregation-readonly | integration-adapter | deprecated`).
- Elle ne doit **jamais** être créée sous forme de `<nom>.feature.js`.
- Elle ne doit **jamais** s'auto-déclarer `authority` sur une règle métier :
  elle peut recommander, jamais trancher à la place d'une feature.
- Elle ne doit **jamais** posséder de table appartenant déjà à une feature en
  écriture (`@db-write` d'une piloting capability ne peut porter que sur ses
  propres tables de constat).

---

## 3. Emplacement et format du manifest

Les piloting capabilities vivent dans `capabilities/<nom>.capability.js`
(jamais dans `features/`). Schéma minimal obligatoire :

```js
module.exports = {
  name:        'decision-signals',
  governedBy:  'docs/doctrine/PILOTING_CAPABILITY_DOCTRINE.md',
  registry:    'docs/doctrine/PILOTING_CAPABILITY_REGISTRY.md',
  status:      'draft | staging | production | deprecated',
  owner:       '<équipe>',
  since:       'YYYY-MM',

  // Ce que la capability détecte / calcule — jamais un verbe de service client.
  capability: '<phrase au format "détecter / calculer / qualifier ... à partir de ...">',

  perimeter: {
    in:  [ /* ce que la capability calcule ou détecte */ ],
    out: [ /* explicitement : aucune décision métier engageante, aucune UI propre */ ],
  },

  files: {
    services: [ /* ... */ ],
    routes:   [ /* ... */ ],
    tests:    [ /* ... */ ],
  },

  db: {
    tables: [ /* tables de constat propres à la capability uniquement */ ],
  },

  consumedBy: [ /* features ou projections qui lisent cette capability */ ],

  invariants: [ /* propriétés de calcul à préserver, jamais des invariants produit */ ],
};
```

Champs volontairement absents par rapport à un `.feature.js` : `authority`
(une capability ne fait pas autorité métier), `contract.exposes` en tant que
service public (une capability n'a pas de contrat client — ses routes, si
elles existent, sont des routes d'observation admin, déclarées dans
`files.routes` et documentées dans `perimeter.in`, pas vendues comme API
produit).

---

## 4. Rattachement aux gates existants

`scripts/feature-registry-check.js` détecte les fichiers orphelins de
`services/`, `routes/`, etc. non couverts par un manifest. Une piloting
capability est une couverture légitime au même titre qu'une feature pour
cette détection d'orphelins — **sans devenir une feature pour autant**. Le
script a été étendu (2026-07-12, Lot O1) pour charger également
`capabilities/*.capability.js` comme source de fichiers couverts, en gardant
sa validation de champs obligatoires (`REQUIRED_FIELDS`) strictement scopée
aux manifests de `features/`. Voir le diff dans le livrable O1 pour le détail.

`scripts/feature-classification-check.js` ne s'applique pas aux piloting
capabilities : `ALLOWED_KINDS` reste inchangé, aucune entrée
`piloting-capability` n'y est ajoutée (cf. §2 — ce n'est pas un kind).

---

## 5. Registre

Toute piloting capability doit apparaître dans
`docs/doctrine/PILOTING_CAPABILITY_REGISTRY.md` (registre dédié — jamais
mélangée aux lignes de `APP_FEATURE_REGISTRY.md`, dont la colonne `Type`
référence cette doctrine par un renvoi plutôt que par une valeur inline, pour
éviter qu'un lecteur du registre feature croie qu'il s'agit d'une variante de
feature).
