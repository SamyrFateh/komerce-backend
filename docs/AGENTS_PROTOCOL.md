# 🔒 AGENTS_PROTOCOL.md — Protocole de Gouvernance Komerce

> **Version** : 1.3 — 06/04/2026
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
>
> Si le propriétaire donne une instruction précise (ex: "travaille sur la sécurité", "fais la vue Retards d'abord"), l'agent suit cette instruction.
> Sinon, l'agent suit strictement l'ordre de la Roadmap.

### Logique de sélection de tâche :

```
Pour chaque priorité (de la plus haute à la plus basse) :
  Pour chaque tâche (dans l'ordre numérique) :
    Si statut == ⬜ (non fait) :
      → C'EST LA TÂCHE À FAIRE
      → Commencer immédiatement
      → STOP (ne pas chercher plus loin)
```

### Exemple concret :

```
Roadmap actuelle :
  Priorité 1 — Dashboard Pilotage :
    2.1 ✅ | 2.2 ✅ | 2.3 ✅ | 2.4 ✅ | 2.5 ✅ | 2.6 ✅ | 2.7 ⬜ | 2.8 ⬜ | ...

→ L'agent présente le statut
→ L'agent dit : "Je continue avec la tâche 2.7 — Vue Tendances"
→ L'agent commence à travailler
```

**Cette règle garantit une progression linéaire et prévisible du projet, sans temps mort.**

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
- ✅ Après modification des dépendances inter-routes

---

### 2️⃣ ROADMAP_KOMERCE.md — Le Plan
> `docs/ROADMAP_KOMERCE.md`

**Ce que c'est** : Roadmap unifiée v14 — progression globale, issues ouvertes, priorités, ordre de travail session par session.

**Quand la consulter** :
- ✅ **Immédiatement après lecture du README** (règle d'entrée ci-dessus)
- ✅ Avant de commencer toute session de travail
- ✅ Pour vérifier les priorités actuelles
- ✅ Pour s'assurer qu'on ne duplique pas un travail déjà fait

**Quand la mettre à jour** :
- ✅ Après fermeture d'une issue ou PR
- ✅ Après complétion d'une tâche de la roadmap
- ✅ Après découverte d'un nouveau bug ou besoin
- ✅ Après changement de priorités
- ✅ **Avant toute nouvelle implémentation** (ajouter la demande à la roadmap d'abord)

---

### 3️⃣ Coffre-Fort Sécurité — Le Bouclier
> `docs/AUDIT_REPORT.md` + `docs/audit/` + Issues #71-#84

**Ce que c'est** : L'ensemble des audits de sécurité et de qualité du projet.

| Document | Rôle |
|----------|------|
| `docs/AUDIT_REPORT.md` | Rapport principal — 8 écarts identifiés entre carto et code |
| `docs/audit/SECURITY_CHECKLIST.md` | Checklist sécurité à valider avant Go-Live |
| `docs/audit/AUDIT_BUGS.md` | Bugs identifiés par audit |
| `docs/audit/AUDIT_CODE_INTEGRITY.md` | Intégrité du code — cohérence imports/exports |
| `docs/audit/FRONTEND_AUDIT.md` | Audit du frontend |
| `docs/audit/db_audit.md` | Audit de la base de données |
| `docs/audit/middleware_audit.md` | Audit des middlewares |
| `docs/audit/utils_audit.md` | Audit des utilitaires |
| `docs/audit/batch_2.md` à `batch_6.md` | Audits par lot de fichiers |
| **Issues #71-#76** | 🔴 6 vulnérabilités CRITIQUES ouvertes |
| **Issues #77-#84** | 🟠 8 vulnérabilités MAJEURES ouvertes |

**Quand le consulter** :
- ✅ Avant toute modification touchant l'authentification, les paiements, ou les données sensibles
- ✅ Avant d'ajouter un nouvel endpoint ou middleware
- ✅ Avant tout déploiement
- ✅ Pour vérifier si un fix sécurité est déjà planifié

**Quand le mettre à jour** :
- ✅ Après correction d'une vulnérabilité
- ✅ Après découverte d'un nouveau risque
- ✅ Après modification d'un middleware de sécurité (auth, validate, rateLimit)

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
│                                                      │
│  ⚠️ PAS DE TEMPS MORT — ON AVANCE TOUJOURS          │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│           AVANT DE CODER / CORRIGER                 │
│                                                      │
│  1. 📖 Lire ROADMAP_KOMERCE.md                      │
│     → Quelle est la priorité ? Est-ce déjà fait?    │
│                                                      │
│  2. 🗺️  Lire CARTOGRAPHY_360.md                     │
│     → Quels fichiers sont impactés ?                 │
│     → Quelles dépendances inter-routes ?             │
│                                                      │
│  3. 🔒 Consulter le Coffre-Fort Sécurité            │
│     → Y a-t-il une vulnérabilité liée ?              │
│     → Le changement introduit-il un risque ?         │
│                                                      │
│  4. ✅ SEULEMENT ALORS → Implémenter                │
└─────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────┐
│           APRÈS AVOIR CODÉ / CORRIGÉ                │
│                                                      │
│  1. 🗺️  Mettre à jour CARTOGRAPHY_360.md            │
│     → Si endpoints/tables/middlewares changés        │
│                                                      │
│  2. 📋 Mettre à jour ROADMAP_KOMERCE.md              │
│     → Cocher les tâches complétées                   │
│     → Ajouter les nouvelles tâches découvertes       │
│                                                      │
│  3. 🔒 Mettre à jour le Coffre-Fort                  │
│     → Si vulnérabilité corrigée → fermer l'issue     │
│     → Si nouveau risque → créer une issue            │
│                                                      │
│  4. 📝 Commit avec message clair                     │
│     → Référencer les issues/PRs liées                │
└─────────────────────────────────────────────────────┘
```

---

## ⏱️ Règle de Sauvegarde Continue — Commit Automatique

> **🔴 RÈGLE ABSOLUE : Tout travail en cours DOIT être commité sur GitHub toutes les 10 minutes maximum.**

### Pourquoi ?
- **Zéro perte de travail** — si une session est interrompue, on reprend exactement là où on s'est arrêté
- **Traçabilité complète** — chaque étape de progression est historisée
- **Reprise facile** — un nouvel agent peut lire les derniers commits et continuer le travail

### Ce qui est couvert
| Type de travail | Commité automatiquement |
|-----------------|------------------------|
| Code source (backend, frontend, apps) | ✅ Oui |
| Documentation (roadmap, carto, audit) | ✅ Oui |
| Analyses et rapports d'impact | ✅ Oui |
| Fichiers de configuration | ✅ Oui |
| Fichiers temporaires / brouillons | ❌ Non |

### Comment ça fonctionne
- Un **trigger automatique** (Tasklet) s'exécute toutes les 10 minutes
- Il détecte les fichiers modifiés depuis le dernier commit
- Il pousse un commit WIP sur `main` avec le format : `wip: auto-save progress – [description]`
- Si aucun changement détecté → aucun commit (pas de bruit)

### Règles pour les agents
1. **Ne jamais désactiver** le trigger de commit automatique
2. **Ne pas attendre** le commit auto pour les changements critiques → commiter manuellement immédiatement
3. **Toujours vérifier** que le dernier commit reflète l'état réel du travail en début de session
4. **En cas de conflit** → le commit manuel prime sur l'auto-commit

---

## ⚠️ Règles Absolues

1. **JAMAIS de modification sans lecture préalable des 3 piliers**
2. **JAMAIS de commit sans mise à jour des documents impactés**
3. **JAMAIS de fix sécurité sans mise à jour de l'AUDIT_REPORT et des issues**
4. **TOUJOURS vérifier la véracité** — croiser les claims avec le code réel
5. **TOUJOURS garder la roadmap comme source de vérité** pour la progression
6. **TOUJOURS commiter le travail en cours toutes les 10 minutes maximum** — zéro perte tolérée
7. **TOUJOURS présenter le statut roadmap après lecture du README** — le propriétaire doit voir l'état du projet immédiatement
8. **TOUJOURS suivre l'ordre de priorité de la roadmap** — sauf demande explicite contraire du propriétaire

---

## 📡 Synchronisation Automatique

| Document / Travail | Fréquence sync | Méthode |
|--------------------|----------------|---------|
| **Tout travail en cours** | **Toutes les 10 min** | **Auto-commit via Tasklet trigger** |
| `ROADMAP_KOMERCE.md` | Toutes les 10 min + commit manuel | Auto-commit + commit après chaque changement |
| `CARTOGRAPHY_360.md` | À chaque modification de code | Commit manuel obligatoire |
| Coffre-Fort Sécurité | À chaque fix sécurité | Commit manuel + fermeture issue |

---

## 🔗 Liens Rapides

| Ressource | Chemin |
|-----------|--------|
| Cartographie | `docs/CARTOGRAPHY_360.md` |
| Roadmap | `docs/ROADMAP_KOMERCE.md` |
| Audit Principal | `docs/AUDIT_REPORT.md` |
| Checklist Sécurité | `docs/audit/SECURITY_CHECKLIST.md` |
| Issues Critiques | GitHub Issues #71-#76 |
| Issues Majeures | GitHub Issues #77-#84 |
| Ce protocole | `docs/AGENTS_PROTOCOL.md` |

---

> _"Pas de carte, pas de plan, pas de bouclier → pas de code."_
> _"Pas de commit régulier → pas de filet de sécurité."_
> _"Pas de statut roadmap → pas de visibilité."_
> _"Pas de demande contraire → on suit la roadmap, point."_
> — Protocole Komerce v1.3
