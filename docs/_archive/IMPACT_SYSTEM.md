# 🛡️ Système coffre-fort de production — Komerce

> **Version :** 1.0.0
> **Date :** 05/04/2026
> **Auteur :** Coffre-fort automatique Komerce
> **Statut :** Opérationnel

---

## 📋 Table des matières

1. [Vue d'ensemble](#vue-densemble)
2. [Architecture du système](#architecture-du-système)
3. [Installation](#installation)
4. [Usage](#usage)
5. [Moteur d'analyse d'impact](#moteur-danalyse-dimpact)
6. [Scoring & seuils](#scoring--seuils)
7. [Scan de sécurité](#scan-de-sécurité)
8. [GitHub Actions](#github-actions)
9. [Hook local pre-push](#hook-local-pre-push)
10. [Configuration avancée](#configuration-avancée)
11. [Dépannage](#dépannage)

---

## Vue d'ensemble

Le **coffre-fort de production** est un pipeline automatique d'analyse d'impact qui protège le codebase Komerce. Il fonctionne à 3 niveaux :

```
┌─────────────────────────────────────────────────────────┐
│                    COFFRE-FORT KOMERCE                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  📍 Niveau 1 — LOCAL (pre-push hook)                    │
│  └─ Analyse avant chaque push                          │
│  └─ Bloque les pushes à haut risque                    │
│                                                         │
│  📍 Niveau 2 — CI/CD (GitHub Action PR)                 │
│  └─ Analyse automatique sur chaque PR                  │
│  └─ Commentaire détaillé sur la PR                     │
│  └─ Bloque le merge si score >= 70                     │
│                                                         │
│  📍 Niveau 3 — POST-MERGE (GitHub Action)               │
│  └─ Régénère la cartographie 360° automatiquement      │
│  └─ Commit automatique des mises à jour                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Fonctionnalités clés

| Fonctionnalité | Description |
|---------------|-------------|
| **Graphe de dépendances** | Parse la configuration pour tracer fichier → tables → routes → services |
| **Traçage en cascade** | Détecte les impacts indirects via les chaînes de dépendance |
| **Scan sécurité** | Détecte SQL injection, XSS, secrets en dur, opérations dangereuses |
| **Score de risque** | Score 0-100 avec 3 niveaux (SAFE / REVIEW / BLOCK) |
| **Commentaire PR** | Rapport Markdown automatique sur chaque Pull Request |
| **Cartographie auto** | Mise à jour automatique de CARTOGRAPHY_360.md après merge |
| **0 dépendances** | Fonctionne avec Node.js natif uniquement |

---

## Architecture du système

```
komerce-backend/
├── scripts/
│   ├── impact-check.js        # 🧠 Moteur d'analyse (Node.js, 0 deps)
│   ├── impact-config.json     # ⚙️ Configuration des règles et seuils
│   └── setup-hooks.sh         # 🔧 Installateur du hook local
├── .github/workflows/
│   ├── impact-check.yml       # 🛡️ GitHub Action — analyse sur PR
│   └── auto-cartography.yml   # 🗺️ GitHub Action — régénère la carto
└── docs/
    └── IMPACT_SYSTEM.md       # 📖 Cette documentation
```

### Diagramme de flux

```
 Développeur
     │
     ▼
 git push ──► [pre-push hook] ──► impact-check.js
     │                                │
     │         score < 30 ───────► ✅ Push OK
     │         score 30-69 ──────► ⚠️ Confirmation requise
     │         score >= 70 ──────► 🚫 Push bloqué
     │
     ▼
 Pull Request ──► [GitHub Action] ──► impact-check.js --ci
     │                                    │
     │         Commentaire PR ◄───────────┘
     │         Annotations CI ◄───────────┘
     │         Block/Review ◄─────────────┘
     │
     ▼
 Merge sur main ──► [Auto-Carto Action] ──► CARTOGRAPHY_360.md
                                                    │
                                              Commit auto ◄──┘
```

---

## Installation

### Prérequis

- **Node.js** >= 18.0.0
- **Git** >= 2.20
- Accès au dépôt `SamyrFateh/komerce-backend`

### 1. Installation du hook local

```bash
# À la racine du projet
bash scripts/setup-hooks.sh
```

Le hook sera installé dans `.git/hooks/pre-push`. Il s'active automatiquement à chaque `git push`.

### 2. GitHub Actions

Les GitHub Actions se déclenchent automatiquement :
- **impact-check.yml** : sur chaque PR vers `main` ou `develop`
- **auto-cartography.yml** : après chaque merge sur `main`

Aucune configuration supplémentaire requise — ils utilisent le `GITHUB_TOKEN` par défaut.

---

## Usage

### Commandes

```bash
# Analyse du diff par rapport à une branche
node scripts/impact-check.js --diff=origin/main

# Analyse de fichiers spécifiques
node scripts/impact-check.js --files=routes/orders.js,routes/payments.js

# Scan complet du projet
node scripts/impact-check.js --all

# Mode CI (GitHub Actions)
node scripts/impact-check.js --diff=origin/main --ci --json

# Mode verbeux
node scripts/impact-check.js --diff=origin/main --verbose
```

### Options

| Option | Description |
|--------|-------------|
| `--diff=<ref>` | Analyse le diff par rapport à une référence git |
| `--files=<f1,f2>` | Analyse des fichiers spécifiques (séparés par virgule) |
| `--all` | Scan complet de tous les fichiers du projet |
| `--ci` | Mode CI : annotations GitHub Actions + fichier rapport |
| `--json` | Sortie JSON sur stdout |
| `--verbose` / `-v` | Affichage détaillé avec extraits de code |
| `--help` / `-h` | Affiche l'aide |

### Exemples de sortie

```
╔══════════════════════════════════════════════════════════════╗
║  KOMERCE — Rapport d'analyse d'impact                       ║
╚══════════════════════════════════════════════════════════════╝

  Score de risque : 🟡 45/100 — REVIEW
  [█████████░░░░░░░░░░░]
  Action : revue manuelle obligatoire

  📊 Résumé d'impact :
     · Fichiers modifiés  : 3
     · Fichiers critiques : 1
     · Tables affectées   : 8 (orders, order_items, products, ...)
     · Services externes  : 2 (stripe, sms)
     · Routes impactées   : 5
     · Chaînes en cascade : 2
```

---

## Moteur d'analyse d'impact

### Fonctionnement

Le moteur suit un pipeline en 5 étapes :

1. **Récupération** — Identifie les fichiers modifiés (git diff, liste manuelle, ou scan complet)
2. **Catégorisation** — Classe chaque fichier (route, middleware, utils, db, core, etc.)
3. **Traçage d'impact** — Utilise le graphe de dépendances pour tracer les impacts en cascade
4. **Scan sécurité** — Analyse le contenu de chaque fichier pour détecter les vulnérabilités
5. **Scoring** — Calcule le score de risque pondéré

### Graphe de dépendances

Le graphe est défini dans `impact-config.json` et cartographie :

- **18 routes** → tables, services, middleware
- **3 middleware** → routes protégées
- **5 utils** → services, routes utilisatrices
- **4 fichiers DB** → portée d'impact
- **3 fichiers core** → server.js, db.js, package.json

### Chaînes de cascade

4 chaînes principales sont surveillées :

| Chaîne | Fichiers | Profondeur |
|--------|----------|-----------|
| `orders_full` | orders → payments → purchasing → scans → loyalty | 5 |
| `scan_chain` | scans → orders → sms → order_status_history | 4 |
| `auth_chain` | auth → middleware/auth → toutes les routes authentifiées | 3+ |
| `payment_flow` | payments → orders → sms → email → stripe | 5 |

---

## Scoring & seuils

### Formule de score

```
Score = Σ(fichiers × 1)
      + Σ(fichiers critiques × 15)
      + Σ(tables standard × 5)
      + Σ(tables critiques × 12)
      + Σ(tables sensibles × 7.5)
      + Σ(services externes × 8)
      + Σ(failles critiques × 20)
      + Σ(failles hautes × 12)
      + Σ(failles moyennes × 6)
      + max(cascade) × 3
      + total_lignes × 0.02
```

Score plafonné à **100**.

### Niveaux de risque

| Niveau | Score | Emoji | Action |
|--------|-------|-------|--------|
| **SAFE** | 0–29 | 🟢 | Auto-merge OK |
| **REVIEW** | 30–69 | 🟡 | Revue manuelle obligatoire |
| **BLOCK** | 70–100 | 🔴 | Merge bloqué |

### Tables critiques vs sensibles

| Criticité | Tables |
|-----------|--------|
| 🔴 Critique | `users`, `orders`, `order_items`, `scans`, `payments`, `order_status_history` |
| 🟠 Sensible | `sms_log`, `exchange_rates`, `disputes`, `shipments`, `recipients` |
| ⚪ Standard | `products`, `baskets`, `basket_items`, `relais`, `fabrics`, `garment_models`, `ceremony_*` |

---

## Scan de sécurité

Le moteur détecte 6 catégories de vulnérabilités :

### Catégories

| Catégorie | Sévérité | Score | Description |
|-----------|----------|-------|-------------|
| **SQL Injection** | 🔴 Critique | +25 | Interpolation de variables dans des requêtes SQL |
| **XSS** | 🔴 Critique | +20 | Injection HTML/JS via données utilisateur |
| **Secrets en dur** | 🔴 Critique | +25 | Credentials, tokens, API keys dans le code |
| **Opérations dangereuses** | 🟠 Haute | +15 | DROP, TRUNCATE, DELETE sans WHERE, eval(), exec() |
| **Auth manquante** | 🟡 Moyenne | +10 | Routes sans middleware d'authentification |
| **Fichiers non sécurisés** | 🟠 Haute | +15 | Opérations fichier avec chemins non validés |

### Patterns détectés

Chaque catégorie utilise des expressions régulières configurables dans `impact-config.json` sous `securityPatterns`. Les commentaires (`//`, `/*`, `*`) sont automatiquement ignorés.

---

## GitHub Actions

### 1. Impact Check (PR)

**Fichier :** `.github/workflows/impact-check.yml`

**Déclenchement :** Ouverture/mise à jour d'une PR vers `main` ou `develop`

**Comportement :**
1. Checkout avec historique complet
2. Exécution de `impact-check.js` en mode CI
3. Publication d'un commentaire Markdown sur la PR
4. Annotations sur les fichiers problématiques
5. Échec du job si score ≥ 70

**Permissions requises :**
- `contents: read`
- `pull-requests: write`
- `checks: write`

### 2. Auto-Cartography (post-merge)

**Fichier :** `.github/workflows/auto-cartography.yml`

**Déclenchement :** Push sur `main` touchant routes/, middleware/, utils/, db/, server.js, db.js, ou package.json

**Comportement :**
1. Exécute l'analyse complète
2. Met à jour la section automatique de `docs/CARTOGRAPHY_360.md`
3. Commit et push automatique avec `[skip ci]`

---

## Hook local pre-push

### Installation

```bash
bash scripts/setup-hooks.sh
```

### Comportement

| Score | Action |
|-------|--------|
| 🟢 0-29 | Push autorisé automatiquement |
| 🟡 30-69 | Demande de confirmation interactive |
| 🔴 70-100 | Push bloqué |

### Bypass d'urgence

```bash
# Contourner le hook (usage exceptionnel !)
git push --no-verify
```

### Désinstallation

```bash
rm .git/hooks/pre-push
```

---

## Configuration avancée

Le fichier `scripts/impact-config.json` contient toute la configuration. Voici les sections modifiables :

### Seuils (`thresholds`)

Modifier les plages de score pour ajuster la sensibilité :

```json
{
  "thresholds": {
    "safe":   { "min": 0,  "max": 25 },
    "review": { "min": 26, "max": 60 },
    "block":  { "min": 61, "max": 100 }
  }
}
```

### Poids (`scoring.weights`)

Ajuster l'importance relative de chaque facteur :

```json
{
  "scoring": {
    "weights": {
      "criticalFileChanged": 15,
      "securityIssue": 20,
      "criticalTableAffected": 12
    }
  }
}
```

### Fichiers ignorés (`ignorePatterns`)

Ajouter des patterns glob pour exclure des fichiers :

```json
{
  "ignorePatterns": [
    "node_modules/**",
    "*.test.js",
    "docs/**"
  ]
}
```

### Nouvelles routes

Lors de l'ajout d'une nouvelle route, mettre à jour `architecture.routes` :

```json
{
  "new_route.js": {
    "tables": ["table1", "table2"],
    "services": ["service1"],
    "middleware": ["auth"],
    "critical": false
  }
}
```

---

## Dépannage

### Problèmes courants

| Problème | Solution |
|----------|----------|
| `❌ Impossible de charger impact-config.json` | Vérifier que le fichier existe dans `scripts/` |
| `❌ Erreur git diff` | Vérifier que la ref existe (`git fetch origin`) |
| Hook ne se déclenche pas | Vérifier les permissions : `chmod +x .git/hooks/pre-push` |
| Score toujours à 0 | Vérifier que les fichiers modifiés ne sont pas dans `ignorePatterns` |
| GitHub Action échoue | Vérifier les permissions du workflow dans Settings > Actions |

### Logs de débogage

```bash
# Mode verbeux pour plus de détails
node scripts/impact-check.js --diff=origin/main --verbose

# Vérifier la configuration
node -e "console.log(JSON.parse(require('fs').readFileSync('scripts/impact-config.json')))"
```

---

## Évolutions prévues

| # | Fonctionnalité | Priorité |
|---|---------------|----------|
| 1 | Parse AST des `require()` pour graphe dynamique | 🟡 Moyenne |
| 2 | Dashboard web d'historique des scores | 🟡 Moyenne |
| 3 | Intégration Slack/Discord pour alertes | 🟢 Basse |
| 4 | Cache des analyses pour accélérer le CI | 🟡 Moyenne |
| 5 | Support monorepo (frontend + backend) | 🔴 Haute |

---

*Documentation générée le 05/04/2026 — Coffre-fort Komerce v1.0*
