# F1B — Codemod logger notification-service

> Date : 2026-05-19  
> Script : `scripts/f1b-notification-logger-codemod.js`  
> Cible : `services/notification-service.js`

---

## Objectif

Migrer progressivement les `console.*` du service de notification vers le logger structuré existant `utils/logger.js`.

Le fichier `services/notification-service.js` est volumineux. Il ne doit pas être réécrit manuellement via l'API GitHub. Le codemod applique localement une série de remplacements connus et vérifiables.

---

## Commandes

Validation sans écriture :

```bash
node scripts/f1b-notification-logger-codemod.js --check
```

Application locale :

```bash
node scripts/f1b-notification-logger-codemod.js --write
```

Vérification obligatoire :

```bash
git diff -- services/notification-service.js
npm test
npm run test:p0
```

---

## Garde-fous

Le script refuse de continuer si :

- le logger semble déjà importé ;
- l'ancre d'import n'est pas trouvée ;
- trop peu de remplacements sont appliqués ;
- les fonctions publiques principales ne sont plus présentes après transformation.

---

## Scope

Inclus :

- remplacement de patterns `console.warn`, `console.error`, `console.log` connus ;
- ajout d'un logger enfant `notification-service`.

Exclus :

- changement des templates WhatsApp ;
- changement des appels AuthKey ;
- changement DB ;
- changement des signatures publiques ;
- refacto complet du service.

---

## Statut

```text
F1B = codemod prêt
Code notification-service non modifié dans cette PR
```
