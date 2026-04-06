# 🔒 AGENTS_PROTOCOL.md — Protocole de Gouvernance Komerce

> **Version** : 1.5 — 06/04/2026
> **Statut** : OBLIGATOIRE pour tout agent (IA ou humain)
> **Repo** : `SamyrFateh/komerce-backend`

---

## 🎯 Principe fondamental

**Toute implémentation, correction ou modification du projet Komerce DOIT obligatoirement consulter et mettre à jour les 3 documents de référence suivants.**

Aucune exception. Aucun raccourci. Quel que soit l'agent.

---

## 📊 Règle d'Entrée — Présentation Roadmap Obligatoire

> **🔴 PREMIÈRE ACTION de tout agent après lecture du README :**

**Dès qu'un agent IA lit le README du projet, il DOIT impérativement :**

1. **Lire la Roadmap** → `docs/ROADMAP_KOMERCE.md`
2. **Présenter un résumé de la progression globale** → tableau avec tous les domaines et leur avancement
3. **Identifier et afficher le dernier point en cours** → la tâche active de la priorité la plus haute

**Format attendu :**
```
📊 STATUT PROJET KOMERCE
─────────────────────────
✅ Fait : [liste des domaines complétés]
🟡 En cours : [priorité N — nom] → tâche X/Y (pourcentage)
   → Dernière tâche active : [description]
⬜ À venir : [prochaines priorités]
🔴 Bloquants : [issues critiques]
```

**Cette présentation est NON NÉGOCIABLE.** Elle permet au propriétaire du projet de savoir immédiatement où en est le projet sans avoir à le demander.

---

## 🚀 Règle de Continuité — Suivre l'Ordre de Priorité

> **🔴 APRÈS la présentation du statut, l'agent DOIT automatiquement enchaîner sur le travail.**

### Comportement par défaut (SANS demande explicite du propriétaire) :

1. **Identifier la prochaine tâche à faire** de la **priorité la plus haute** dans la Roadmap
2. **Commencer à travailler dessus immédiatement** après la présentation du statut
3. **Suivre l'ordre des tâches** au sein de chaque priorité (2.1 → 2.2 → 2.3, etc.)
4. **Passer à la priorité suivante** uniquement quand toutes les tâches de la priorité en cours sont terminées

### Exception unique :

> **Seule une demande EXPLICITE du propriétaire peut déroger à cet ordre.**

### Logique de sélection de tâche :

```
Pour chaque priorité (de la plus haute à la plus basse) :
  Pour chaque tâche (dans l'ordre numérique) :
    Si statut == ⬜ (non fait) :
      → C'EST LA TÂCHE À FAIRE
      → Commencer immédiatement
      → STOP (ne pas chercher plus loin)
```

---

## 📐 Les 3 Piliers de Référence

### 1️⃣ CARTOGRAPHY_360.md — La Carte
> `docs/CARTOGRAPHY_360.md`

**Ce que c'est** : Cartographie exhaustive de l'architecture — 120 endpoints, 28+ tables, middlewares, dépendances inter-routes, services externes.

**Quand la consulter** :
- ✅ Avant toute modification de code (routes, tables, middlewares)
- ✅ Pour comprendre les dépendances d'un fichier
- ✅ Pour vérifier l'impact d'un changement

**Quand la mettre à jour** :
- ✅ Après ajout/suppression/modification d'un endpoint
- ✅ Après ajout/modification d'une table ou vue
- ✅ Après modification d'un middleware ou service externe

### 2️⃣ ROADMAP_KOMERCE.md — Le Plan
> `docs/ROADMAP_KOMERCE.md`

**Quand la consulter** :
- ✅ **Immédiatement après lecture du README** (règle d'entrée ci-dessus)
- ✅ Avant de commencer toute session de travail
- ✅ Pour vérifier les priorités actuelles

**Quand la mettre à jour** :
- ✅ Après complétion d'une tâche de la roadmap
- ✅ Après découverte d'un nouveau bug ou besoin
- ✅ Après changement de priorités

### 3️⃣ Coffre-Fort Sécurité — Le Bouclier
> `docs/AUDIT_REPORT.md` + `docs/audit/` + Issues #71-#84

| Document | Rôle |
|----------|------|
| `docs/AUDIT_REPORT.md` | Rapport principal — 8 écarts identifiés |
| `docs/audit/SECURITY_CHECKLIST.md` | Checklist sécurité avant Go-Live |
| `docs/audit/AUDIT_BUGS.md` | Bugs identifiés par audit |
| `docs/audit/AUDIT_CODE_INTEGRITY.md` | Intégrité du code |
| `docs/audit/FRONTEND_AUDIT.md` | Audit frontend |
| `docs/audit/db_audit.md` | Audit base de données |
| `docs/audit/middleware_audit.md` | Audit middlewares |
| `docs/audit/utils_audit.md` | Audit utilitaires |
| `docs/audit/batch_2.md` à `batch_6.md` | Audits par lot |
| **Issues #71-#76** | 🔴 6 vulnérabilités CRITIQUES |
| **Issues #77-#84** | 🟠 8 vulnérabilités MAJEURES |

---

## 📂 Système de Deltas — `docs/_pending/`

> **🔴 NOUVEAU v1.5 — Mécanisme universel de mise à jour des docs**

### Principe

Après chaque session de travail, tout agent DOIT déposer un **fichier delta** dans `docs/_pending/` décrivant les changements à appliquer aux documents de gouvernance.

### Format du fichier

**Nom** : `YYYY-MM-DD_HH-MM_description-courte.md`

**Contenu** :
```markdown
# Delta — [Description courte]

## Contexte
[Ce qui a été fait dans cette session]

## ROADMAP
- Section X: [changement à appliquer]
- Tâche Y.Z: ⬜ → ✅
- Ajout tâche: [description]

## CARTOGRAPHY
- Section X: [changement à appliquer]
- Ajout fichier: path/to/file.tsx
- Suppression fichier: path/to/old.tsx
- Compteur fichiers: N → M

## AUDIT (si applicable)
- [changement sécurité]
```

### Cycle de vie

```
┌───────────────────────────────────────────────┐
│  Agent (Cursor/Tasklet/humain) fait du travail │
│  → Dépose un delta dans docs/_pending/         │
└──────────────────────┬────────────────────────┘
                       │
            ⏱️ Toutes les 10 min
                       │
┌──────────────────────▼────────────────────────┐
│  Trigger Tasklet (gardien de gouvernance)      │
│  1. Lit les deltas                             │
│  2. Scanne le repo (détection dérive)          │
│  3. Applique les changements aux docs          │
│  4. Commit + supprime les deltas traités       │
└───────────────────────────────────────────────┘
```

### Règles

1. **TOUJOURS déposer un delta** après une session de travail
2. **NE JAMAIS modifier directement** ROADMAP ou CARTOGRAPHY si un trigger Tasklet est actif — passer par un delta
3. **Un delta par session** (pas un par fichier modifié)
4. **Format DELTA uniquement** — décrire les changements, pas régénérer les docs

---

## 🤖 Bootstrap Agent Tasklet

> **Si tu es un agent Tasklet**, lis `docs/GOVERNANCE_BOOTSTRAP.md` pour te configurer comme gardien de la gouvernance.

Le système est conçu pour être **zéro état agent** — tout vit dans le repo. N'importe quel agent Tasklet peut reprendre le rôle de gardien en suivant le bootstrap.

---

## 🔄 Workflow Obligatoire — Avant Toute Action

```
┌─────────────────────────────────────────────────────┐
│       ÉTAPE 0 — APRÈS LECTURE DU README             │
│                                                      │
│  📊 Lire ROADMAP_KOMERCE.md                          │
│  → Présenter la progression globale au propriétaire  │
│  → Identifier le dernier point EN COURS              │
│  → Afficher les bloquants éventuels                  │
│                                                      │
│  ⚠️ CETTE ÉTAPE EST OBLIGATOIRE ET AUTOMATIQUE       │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│       ÉTAPE 0.5 — CONTINUITÉ AUTOMATIQUE             │
│                                                      │
│  🚀 Enchaîner sur la prochaine tâche ⬜              │
│     de la priorité la plus haute                     │
│  → Sauf demande EXPLICITE contraire du propriétaire │
│  → Suivre l'ordre numérique des tâches              │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│           AVANT DE CODER / CORRIGER                 │
│                                                      │
│  1. 📖 Lire ROADMAP_KOMERCE.md                      │
│  2. 🗺️  Lire CARTOGRAPHY_360.md                     │
│  3. 🔒 Consulter le Coffre-Fort Sécurité            │
│  4. ✅ SEULEMENT ALORS → Implémenter                │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│           APRÈS AVOIR CODÉ / CORRIGÉ                │
│                                                      │
│  1. 🗺️  Mettre à jour CARTOGRAPHY_360.md            │
│  2. 📋 Mettre à jour ROADMAP_KOMERCE.md              │
│  3. 🔒 Mettre à jour le Coffre-Fort si applicable    │
│  4. 📂 Déposer un DELTA dans docs/_pending/          │
│  5. 📝 Commit avec message clair                     │
└─────────────────────────────────────────────────────┘
```

---

## ⏱️ Règle de Sauvegarde Continue — Commit Automatique

> **🔴 RÈGLE ABSOLUE : Tout travail en cours DOIT être commité sur GitHub toutes les 10 minutes maximum.**

### Pourquoi ?
- **Zéro perte de travail** — si une session est interrompue, on reprend exactement là où on s'est arrêté
- **Traçabilité complète** — chaque étape de progression est historisée
- **Reprise facile** — un nouvel agent peut lire les derniers commits et continuer

### Architecture (v1.5 — Stateless)

Le trigger de gouvernance est **stateless** et **repo-contained** :
- Aucune base de données agent requise
- Aucun fichier local requis
- Tout est dans le repo → n'importe quel agent Tasklet peut reprendre le rôle
- Voir `docs/GOVERNANCE_BOOTSTRAP.md` pour la configuration

### Règles pour les agents
1. **Ne jamais désactiver** le trigger de commit automatique
2. **Ne pas attendre** le commit auto pour les changements critiques → commiter manuellement
3. **Toujours vérifier** que le dernier commit reflète l'état réel du travail en début de session
4. **En cas de conflit** → le commit manuel prime sur l'auto-commit

---

## 🗺️ Règle #9 — Mise à Jour Cartographie Obligatoire

> **🔴 RÈGLE ABSOLUE : Tout commit modifiant du code DOIT inclure la mise à jour correspondante de la CARTOGRAPHY_360.md.**

### Ce qui déclenche une mise à jour de la carto :

| Modification | Mise à jour carto requise |
|-------------|--------------------------|
| Ajout/suppression de fichier | ✅ Arbre + section concernée |
| Modification d'un fichier (contenu changé) | ✅ SHA dans l'arbre |
| Ajout/modification d'un endpoint API | ✅ Section routes |
| Modification table/vue BDD | ✅ Section BDD |
| Ajout/modification middleware | ✅ Section middleware |
| Modification frontend (HTML/JS/CSS) | ✅ Section frontend |
| Modification docs uniquement | ❌ Pas nécessaire |

### Approche DELTA :

```
❌ INTERDIT : Régénérer toute la cartographie à chaque commit
✅ OBLIGATOIRE : Ne modifier que les lignes impactées par le changement
```

---

## ⚠️ Règles Absolues

1. **JAMAIS de modification sans lecture préalable des 3 piliers**
2. **JAMAIS de commit sans mise à jour des documents impactés**
3. **JAMAIS de fix sécurité sans mise à jour de l'AUDIT_REPORT et des issues**
4. **TOUJOURS vérifier la véracité** — croiser les claims avec le code réel
5. **TOUJOURS garder la roadmap comme source de vérité** pour la progression
6. **TOUJOURS commiter le travail en cours toutes les 10 minutes maximum**
7. **TOUJOURS présenter le statut roadmap après lecture du README**
8. **TOUJOURS suivre l'ordre de priorité de la roadmap**
9. **TOUJOURS mettre à jour la CARTOGRAPHY_360.md** dans le même commit que le code modifié
10. **TOUJOURS déposer un delta dans docs/_pending/** après une session de travail

---

## 📡 Synchronisation Automatique

| Document / Travail | Fréquence sync | Méthode |
|--------------------|----------------|---------|
| **Tout travail en cours** | **Toutes les 10 min** | **Auto-commit via trigger Tasklet** |
| `ROADMAP_KOMERCE.md` | Via deltas + auto-sync | Trigger Tasklet stateless |
| `CARTOGRAPHY_360.md` | À chaque modification de code | Commit manuel + deltas |
| Coffre-Fort Sécurité | À chaque fix sécurité | Commit manuel + fermeture issue |

---

## 🔗 Liens Rapides

| Ressource | Chemin |
|-----------|--------|
| Cartographie | `docs/CARTOGRAPHY_360.md` |
| Roadmap | `docs/ROADMAP_KOMERCE.md` |
| Audit Principal | `docs/AUDIT_REPORT.md` |
| Checklist Sécurité | `docs/audit/SECURITY_CHECKLIST.md` |
| Deltas en attente | `docs/_pending/` |
| Bootstrap Tasklet | `docs/GOVERNANCE_BOOTSTRAP.md` |
| Issues Critiques | GitHub Issues #71-#76 |
| Issues Majeures | GitHub Issues #77-#84 |
| Ce protocole | `docs/AGENTS_PROTOCOL.md` |

---

> _"Pas de carte, pas de plan, pas de bouclier → pas de code."_
> _"Pas de commit régulier → pas de filet de sécurité."_
> _"Pas de delta → pas de mise à jour."_
> _"Le repo est le système. L'agent est remplaçable."_
> — Protocole Komerce v1.5
