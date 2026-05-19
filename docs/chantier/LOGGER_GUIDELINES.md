# F1A — Logger structuré Komerce

> Date : 2026-05-19  
> Scope : guide court + pilote SMS  
> Logger : `utils/logger.js`

---

## Décision

Le repo possède déjà un logger central : `utils/logger.js`.

F1A ne recrée donc pas de logger. Le lot formalise son usage et migre un domaine pilote :

```text
utils/sms.js
```

---

## Usage recommandé

Éviter dans le nouveau code backend :

```js
console.log(...)
console.warn(...)
console.error(...)
```

Préférer :

```js
const log = require('../utils/logger').child({ module: 'module-name' });

log.info({ order_id }, 'Order processed');
log.warn({ phone }, 'SMS skipped');
log.error({ err, order_id }, 'Operation failed');
```

Depuis `utils/`, adapter le chemin :

```js
const log = require('./logger').child({ module: 'sms' });
```

---

## Convention

Mettre les données variables dans l'objet, puis un message stable :

```js
log.info({ order_id: order.id, status }, 'Order status changed');
```

Éviter les messages construits uniquement par interpolation.

---

## Niveaux

| Niveau | Usage |
|--------|-------|
| `debug` | détail dev |
| `info` | événement normal |
| `warn` | anomalie non bloquante |
| `error` | échec récupéré |
| `fatal` | arrêt ou démarrage impossible |

---

## Erreurs

Passer les exceptions sous la clé `err` :

```js
log.error({ err, order_id }, 'Operation failed');
```

---

## Migration progressive

Ne pas remplacer tous les `console.*` en une seule PR.

Ordre recommandé :

```text
F1A — utils/sms.js pilote
F1B — notification-service
F1C — purchasing
F1D — pricing
F1E — server startup logs après H1A/H1B
```

---

## Statut F1A

```text
F1A = pilote logger appliqué sur utils/sms.js
Logger central = existant, confirmé
Refonte globale logs = non faite
```
