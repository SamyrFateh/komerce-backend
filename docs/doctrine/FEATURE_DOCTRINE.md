# Doctrine Feature — Komerce

> **Version** : 1.0 — 2026-06
> **Statut** : doctrine active — **sommet de la pyramide**
> **Hiérarchie** : complète `AGENTS.md` — en cas de conflit, `AGENTS.md` fait foi.
> **Registre** : `docs/doctrine/APP_FEATURE_REGISTRY.md`
> **Commande** : `node scripts/feature-registry-check.js`

---

## Pourquoi cette doctrine existe — et pourquoi elle est au sommet

La Pyramide Qualité (`QUALITY_PYRAMID_DOCTRINE.md`, niveaux 1 à 5) répond à une question :
*« ce code est-il correct ? »* — sécurité des dépendances, conventions, tests, architecture,
cohérence du slice.

Elle ne répond pas à une question plus en amont, qui doit être tranchée **avant** d'écrire
la première ligne :

> **De quelle feature métier ce code fait-il partie, quel service rend-elle,
> où s'arrête-t-elle, et qui a autorité pour en décider ?**

Sans réponse à cette question, on peut avoir un code irréprochable niveau 1 à 5 et pourtant :
- une logique métier dupliquée dans deux features qui ne se savent pas voisines ;
- une feature dont le périmètre déclaré (`features/*.feature.js`) est cohérent en interne,
  mais dont on ne sait pas si elle est la seule à exister pour ce service, ou complète ;
- un fichier qui ne correspond à aucune feature et que personne ne revendique.

C'est le rôle de cette doctrine : poser **ce qu'est une feature métier chez Komerce**,
imposer qu'elle soit enregistrée dans un **registre canonique unique**, et garantir que
toute ligne de code backend appartient à une feature déclarée — jamais à un vide.

```
                    ╔══════════════════════════════════╗
        Niveau 0    ║         FEATURE DOCTRINE         ║   ← CE DOCUMENT
                    ║  Qu'est-ce qu'une feature ?      ║     Sommet : gouverne tout en dessous
                    ║  Registre canonique exhaustif    ║
                    ╚════════════════╦═════════════════╝
                                     ▼ encadre
                    ╔══════════════════════════════════╗
        Niveau 5    ║      FEATURE SLICE DOCTRINE       ║   Découpage technique d'une feature
                    ║   (fichiers, migrations, tests)   ║   déjà reconnue par le registre
                    ╚════════════════╦═════════════════╝
                                     ▼ encadre
                    ╔══════════════════════════════════╗
     Niveaux 1-4    ║      QUALITY PYRAMID DOCTRINE     ║   Qualité du code à l'intérieur
                    ║  (deps, lint, tests, architecture)║   d'un slice déjà délimité
                    ╚══════════════════════════════════╝
```

Lecture du schéma : on ne discute pas de la qualité d'un fichier (niveaux 1-4) avant de
savoir à quel slice il appartient (niveau 5) ; on ne discute pas du slice avant de savoir
à quelle **feature métier reconnue** il appartient (niveau 0). L'ordre de lecture d'un
agent ou d'un humain qui intervient est donc : **ce document → le registre → le manifest
de la feature → le code**.

---

## Principe fondamental

> Une feature métier est un **service rendu identifiable**, pas un regroupement
> technique de fichiers qui se ressemblent.

Elle se définit par cinq propriétés, toutes obligatoires, jamais déduites :

| Propriété | Question à laquelle elle répond |
|---|---|
| **Service rendu** | Quel besoin métier, côté utilisateur ou opérateur, cette feature satisfait-elle — en une phrase ? |
| **Périmètre** | Qu'est-ce qui est dedans (fichiers, routes, tables) ? Qu'est-ce qui n'y est explicitement **pas** ? |
| **Interfaces** | Qu'expose-t-elle aux autres features ? Que consomme-t-elle chez elles ? |
| **Autorité** | Qui a le droit de trancher un changement de périmètre sans consultation ? |
| **Invariants** | Quelles règles ne bougent jamais, quelle que soit l'implémentation ? |

Une feature qui n'a pas ces cinq propriétés déclarées **n'existe pas formellement**,
même si son code tourne en production. Le code tournant sans feature déclarée est une
dette de gouvernance, au même titre qu'une route sans test est une dette de qualité.

---

## Le registre canonique — source de vérité unique

`docs/doctrine/APP_FEATURE_REGISTRY.md` est la liste exhaustive et datée de toutes
les features métier du backend Komerce. Chaque ligne du registre pointe vers un manifest
`features/<feature>.feature.js` qui porte le détail technique.

Règles du registre :

1. **Exhaustivité** : toute logique backend qui rend un service métier identifiable a une
   ligne dans le registre. Pas d'exception « petit utilitaire » — s'il rend un service, il
   est dans le registre, même rattaché à une feature existante plutôt qu'isolé.
2. **Unicité d'autorité** : un fichier appartient à une seule feature. Si un fichier sert
   deux features, c'est un signal qu'il doit être scindé ou que les deux features doivent
   fusionner — jamais une raison de le laisser sans propriétaire unique.
3. **Aucun fichier orphelin** : tout fichier de `services/`, `routes/`, `middleware/`,
   `utils/`, `validators/`, `core/` qui n'est ni transverse déclaré (auth, logger, db) ni
   rattaché à une feature du registre est une anomalie à corriger — pas à ignorer.
4. **Statut de vie explicite** : `draft` (en construction, pas encore exposée), `staging`
   (exposée en interne / beta), `production` (service réel), `deprecated` (en cours de
   retrait — ne pas y ajouter de nouvelle logique).
5. **Mise à jour synchrone** : créer, fusionner, scinder ou retirer une feature met à jour
   le registre **et** son manifest dans la même PR. Le registre qui ne reflète pas le code
   réel est pire qu'absent — il fait croire à une cartographie qui n'existe pas.

---

## Distinguer feature métier et domaine technique transversal

Tous les `@domain` présents dans les headers `@komerce-arch` ne sont pas des features
métier au sens de cette doctrine. Deux catégories existent et ne se gouvernent pas pareil :

| Catégorie | Définition | Gouvernance |
|---|---|---|
| **Feature métier** | Rend un service de bout en bout à un utilisateur ou un opérateur (ex. `orders`, `shared-cart`, `payments`) | Manifest complet (service, périmètre, interfaces, autorité, invariants) |
| **Domaine technique transversal** | Infrastructure consommée par plusieurs features, ne rend pas de service métier en soi (ex. `auth`, `logger`, `db`) | Documenté dans le registre comme **transversal**, périmètre et invariants déclarés, mais pas de notion de service métier autonome |

Le registre déclare explicitement chaque entrée comme `feature` ou `transversal`.
Confondre les deux est l'erreur la plus fréquente : un domaine transversal qui s'étend
silencieusement pour absorber de la logique métier devient un point de couplage caché.

---

## Le manifest — format canonique enrichi

Le format défini par `FEATURE_SLICE_DOCTRINE.md` (périmètre fichiers, contrat, invariants)
reste la base technique. Cette doctrine y ajoute les champs **obligatoires au niveau
métier**, vérifiés par `scripts/feature-registry-check.js` :

```js
module.exports = {
  // ── Identité (déjà requis par FEATURE_SLICE_DOCTRINE) ──
  name: 'orders',
  domain: 'orders',
  status: 'production',
  owner: 'backend-core',
  since: '2025-09',

  // ── Niveau métier (requis par FEATURE_DOCTRINE) ──
  service: 'Faire exister une commande, de la création au statut final, ' +
           'avec un coût figé et une référence lisible.',

  perimeter: {
    in:  [
      'création, annulation, snapshot de coût, machine de statut de la commande',
      'rattachement aux colis et aux achats fournisseurs',
    ],
    out: [
      'paiement lui-même (feature payments)',
      'logique panier partagé (feature shared-cart, qui consomme orders)',
      'remboursement (feature refunds, qui consomme orders en lecture)',
    ],
  },

  authority: 'backend-core — tout changement de statut ou de schéma de commande ' +
             'doit être validé par le propriétaire de order-status-machine.js',

  // ── Déjà requis par FEATURE_SLICE_DOCTRINE ──
  files: { services: [...], routes: [...], migrations: [...], tests: [...] },
  contract: { exposes: [...], consumes: [...] },
  invariants: [...],
};
```

`perimeter.out` est le champ le plus important du document. Une feature qui ne sait pas
dire ce qu'elle **ne fait pas** n'a pas de périmètre — elle a une zone d'influence floue
qui finira par se chevaucher avec sa voisine.

---

## Ce que cette doctrine garantit en pratique

Pour un agent IA ou un développeur qui doit toucher une feature :

1. Ouvrir `docs/doctrine/APP_FEATURE_REGISTRY.md` → trouver la feature concernée.
2. Lire son manifest `features/<feature>.feature.js` → connaître service rendu, périmètre
   exact, interfaces avec le reste, autorité, invariants.
3. Modifier en restant dans `perimeter.in` ; si la modification touche `perimeter.out`,
   c'est un signal d'arrêt — soit la modification est mal placée, soit le périmètre doit
   être renégocié explicitement (mise à jour du registre, pas contournement silencieux).
4. Lancer `node scripts/feature-registry-check.js --strict` avant `node scripts/feature-guard.js --strict` :
   le registre garantit que la feature existe et que ses fichiers sont déclarés ; le guard
   garantit que le slice lui-même est cohérent.

Réagir 100 fois plus vite qu'un concurrent sur un ajustement ne vient pas de coder plus
vite — ça vient de ne jamais se demander *« où est-ce que ça vit, et est-ce que j'ai le
droit de le changer ici »*. Cette question est répondue avant que l'agent ouvre un fichier,
pas pendant qu'il le modifie.

---

## Ordre de gouvernance complet (rappel)

```
0. FEATURE_DOCTRINE.md + APP_FEATURE_REGISTRY.md   ← la feature existe, est unique, a un périmètre
   node scripts/feature-registry-check.js --strict

5. FEATURE_SLICE_DOCTRINE.md + features/<x>.feature.js  ← le slice est cohérent et complet
   node scripts/feature-guard.js --strict

1-4. QUALITY_PYRAMID_DOCTRINE.md                         ← le code à l'intérieur est correct
   npm run audit:gate / quality:gate / test / arch:gate
```

---

## Règle de mise à jour de cette doctrine

Toute nouvelle feature métier identifiée doit recevoir une ligne dans le registre et un
manifest avant son premier merge en `production`. Toute scission, fusion ou dépréciation
de feature met à jour le registre dans la même PR que le code.

Cette doctrine ne change pas avec chaque feature — elle change quand la **définition même**
de ce qu'est une feature chez Komerce évolue. C'est volontairement le document le plus
stable de la pyramide.
