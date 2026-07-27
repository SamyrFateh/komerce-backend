# AGENTS.md — Règles obligatoires Komerce

Ce fichier est l'instruction racine du dépôt pour tout agent IA ou développeur.

En cas de désaccord, `AGENTS.md` fait foi.

---

## 0. Avant de coder — protocole carte-first obligatoire

Ne pas coder puis corriger. Coder avec l'analyse en tête.

Toute intervention commence par :

1. `docs/CARTE_FIRST_INDEX.md`
2. la carte `features/<feature>.feature.js` ou le transversal concerné
3. un plan d'attaque annoncé à l'utilisateur
4. les gates applicables

Un agent ne doit pas démarrer depuis un ancien audit, un rapport daté, un prompt historique, un `_LIVE.md`, un `MEMO_*` ou une sortie générée.

## 1. Plan d'attaque obligatoire

Avant toute modification substantielle, l'agent doit annoncer un plan d'attaque court avant de coder.

Le plan d'attaque doit contenir :

- la demande comprise ;
- la feature ou le transversal concerné ;
- l'opération : Create, Read, Update, Delete/Archive/Deprecate ;
- la carte à lire ;
- le périmètre probable ;
- les fichiers ou familles de fichiers probablement concernés ;
- les fichiers ou zones à ne pas toucher ;
- les invariants à protéger ;
- les risques ou points à vérifier ;
- les gates et tests prévus.

Format recommandé :

```md
## Plan d'attaque

Demande comprise :
- ...

Feature / transversal :
- ...

Opération :
- ...

Carte à lire :
- features/<feature>.feature.js

Périmètre probable :
- ...

Hors périmètre :
- ...

Invariants à protéger :
- ...

Risques / points à vérifier :
- ...

Vérification prévue :
- npm run ...
```

Exceptions : lecture simple, explication sans modification, commande triviale explicitement demandée, ou correction purement typographique sans impact métier. Même dans ces cas, l'agent doit rester capable de nommer la carte ou le transversal si la demande touche au produit.

## 2. Parcours obligatoire

1. Identifier la feature ou le transversal concerné.
2. Ouvrir la carte correspondante.
3. Qualifier l'opération : Create, Read, Update, Delete/Archive/Deprecate.
4. Vérifier `service`, `perimeter.in`, `perimeter.out`, `authority`, `contract`, `invariants` et `files`.
5. Annoncer le plan d'attaque avant de modifier.
6. Vérifier que les fichiers touchés appartiennent à la carte ou à un transversal déclaré.
7. Si l'intention métier change, mettre à jour la carte dans la même PR.
8. Régénérer les sorties dérivées pertinentes.
9. Lancer les gates.

## 3. Gates carte-first

| Gate | Commande | Rôle |
|------|----------|------|
| Registre features | `npm run feature:registry` | cohérence des features déclarées |
| Schéma cartes | `npm run gate:schema` | carte structurellement valide |
| Schéma complet | `npm run gate:schema:full` | cible stricte de maturité |
| Fichiers touchés | `npm run gate:touched-files` | tout fichier applicatif touché appartient à une carte ou transversal |
| Audit feature | `npm run gate:feature-audit` | contrats/tests/features vérifiables |
| Docs lint | `npm run gate:docs-lint` | empêche le bruit historique documentaire |
| Map globale | `npm run map:check` | reconstruction globale |

## 4. Vérification minimale

```bash
npm run feature:registry
npm run gate:schema
npm run gate:touched-files
npm run gate:docs-lint
```

## 5. Vérification complète

```bash
npm run map:check
```

## 6. Hiérarchie documentaire

1. Code de production
2. DB live
3. `AGENTS.md`
4. `docs/CARTE_FIRST_INDEX.md`
5. `features/*.feature.js`
6. Doctrines actives
7. Générateurs
8. Sorties générées à jour
9. Archives

## 7. Contexte agent, branche et économie de tokens

- `main` est l'unique branche de travail active. Ne pas créer, rechercher ou réactiver une ancienne branche `agent/*` sauf demande humaine explicite.
- `.agent/README.md` est la seule instruction active sous `.agent/`.
- `.agent/LEDGER.md` contient uniquement le chantier courant et les prochains actes décidés. Un palier clos n'est jamais rouvert à cause d'un ancien state, worklog, audit ou compteur.
- Lecture minimale obligatoire : `AGENTS.md` → `docs/CARTE_FIRST_INDEX.md` → carte de la feature concernée → `.agent/LEDGER.md`. Ne lire ensuite que les fichiers directement utiles au changement.
- Ne pas scanner par défaut les archives, rapports datés, preuves brutes, anciens prompts, sorties générées volumineuses ou historiques de tâches. Les ouvrir seulement lorsqu'un fichier actif les référence précisément ou qu'une preuve ne peut pas être régénérée.
- Préférer les recherches ciblées et les extraits courts. Ne pas recopier des fichiers entiers dans les rapports ou réponses.
- Ne pas créer de document horodaté, prompt bis, ZIP, patch ou rapport parallèle lorsqu'un document canonique existe déjà.
- Les preuves reproductibles sont des commandes et des tests. Ne pas committer leurs logs bruts ; consigner un résumé et la commande, sauf preuve externe non régénérable et compacte.
- Toute nouvelle instruction d'agent doit remplacer une instruction obsolète, jamais s'empiler avec elle.

## 8. Règles techniques non négociables

- Statuts commande : `services/order-status-machine.js`.
- Paiements Stripe/cash/wallet/shared-cart : services propriétaires.
- Webhooks Stripe : body brut avant `express.json`.
- Wallet : créditer, débiter, contre-passer, jamais supprimer.
- Pricing : composantes DB, jamais de coefficient dur.
- Toute transition laisse une trace.
- Complétion au contact : si tu touches un fichier **et** son test dans la même
  PR, tu dois amener la couverture de ce fichier au seuil cible (100 % par
  défaut) — pas de retouche partielle qui laisse le fichier aussi peu couvert
  qu'avant. Voir `docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md`, Niveau 3.1.

## 9. Divergence

Si code, DB, cartes et docs divergent : ne pas corriger silencieusement. Noter la divergence, corriger dans la même PR ou créer une dette explicite.
