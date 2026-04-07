# Gouvernance Komerce v2.0

> **Fichier unique de gouvernance.** Remplace AGENT_RULES.md et AGENTS_PROTOCOL.md.
> Tout agent (IA ou humain) DOIT lire ce fichier avant toute action sur le projet.

---

## 1. Règle d'entrée

Dès lecture du README, l'agent DOIT **immédiatement** :

1. Lire `docs/ROADMAP_KOMERCE.md`
2. Afficher le statut projet dans ce format :
```
📊 STATUT KOMERCE
✅ Fait : [domaines complétés]
🟡 En cours : [priorité N — nom] → tâche X/Y
⬜ À venir : [prochaines priorités]
🔴 Bloquants : [issues critiques]
```
3. Enchaîner sur la **première tâche ⬜** de la priorité la plus haute (ordre numérique)

> Seule une demande **explicite** du propriétaire peut déroger à cet ordre.

---

## 2. Les 3 piliers

| Pilier | Fichier | Rôle |
|--------|---------|------|
| 🗺️ Carte | `docs/CARTOGRAPHY_360.md` | Architecture complète : 120 endpoints, 28+ tables, middlewares, dépendances |
| 📋 Plan | `docs/ROADMAP_KOMERCE.md` | Source de vérité unique : priorités, tâches, progression |
| 🔒 Bouclier | `docs/AUDIT_REPORT.md` + `docs/audit/*` + Issues #71-#84 | Sécurité : 6 vulnérabilités critiques (#71-76), 8 majeures (#77-84) |

### Fichiers audit détaillés

`SECURITY_CHECKLIST.md` · `AUDIT_BUGS.md` · `AUDIT_CODE_INTEGRITY.md` · `FRONTEND_AUDIT.md` · `db_audit.md` · `middleware_audit.md` · `utils_audit.md` · `batch_2.md` à `batch_6.md` — tous dans `docs/audit/`

---

## 3. Workflow

```
AVANT de coder           PENDANT                    APRÈS
─────────────────        ──────────────────         ─────────────────────────
① Lire ROADMAP           ④ Respecter l'archi        ⑥ Déposer un delta
② Lire CARTOGRAPHY         existante et les           dans docs/_pending/
③ Consulter AUDIT          middlewares               ⑦ Commit avec message clair
   → ALORS coder         ⑤ Commit toutes les 10 min
```

### Nouvelle demande / fonctionnalité ?
Ajouter d'abord à la ROADMAP (commit immédiat) → analyser la CARTOGRAPHY (impacts) → consulter l'AUDIT (risques) → implémenter.

---

## 4. Système de deltas — `docs/_pending/`

Après chaque session, déposer **un fichier delta** (pas de modification directe des docs si un trigger Tasklet est actif).

**Nom** : `YYYY-MM-DD_HH-MM_description-courte.md`

**Template** :
```markdown
# Delta — [Description]
## Contexte
[Ce qui a été fait]
## ROADMAP
- Tâche Y.Z: ⬜ → ✅
## CARTOGRAPHY
- [Fichiers/endpoints/tables modifiés, approche DELTA uniquement]
## AUDIT (si applicable)
- [Changement sécurité]
```

**Cycle** : Agent dépose delta → Trigger Tasklet (toutes les 10 min) lit + applique + commit + supprime les deltas traités.

---

## 5. Mise à jour cartographie

| Modification | MAJ carto ? |
|-------------|:-----------:|
| Ajout/suppression/modification de fichier | ✅ arbre + SHA |
| Ajout/modification endpoint API | ✅ section routes |
| Modification table/vue BDD | ✅ section BDD |
| Ajout/modification middleware | ✅ section middleware |
| Modification frontend (HTML/JS/CSS) | ✅ section frontend |
| Modification docs uniquement | ❌ |

> **Approche DELTA obligatoire** : ne modifier que les lignes impactées, jamais régénérer toute la carto.

---

## 6. Sauvegarde continue

- Commit toutes les **10 min max** (auto-commit via trigger Tasklet)
- Format WIP : `wip: auto-save progress – [description]`
- Ne pas attendre l'auto-commit pour les changements critiques → commit manuel
- En début de session : vérifier que le dernier commit reflète l'état réel
- Le commit manuel prime sur l'auto-commit en cas de conflit
- Architecture **stateless** : tout vit dans le repo, aucun état agent requis

---

## 7. Les 5 règles

| # | Règle |
|---|-------|
| 1 | **Pas de code sans lecture des 3 piliers** |
| 2 | **Roadmap = source de vérité.** Toute demande y passe d'abord. Toujours suivre l'ordre de priorité. |
| 3 | **Un delta après chaque session.** Ne jamais modifier les docs directement si trigger actif. |
| 4 | **Commit toutes les 10 min.** Zéro perte de travail. |
| 5 | **Cartographie à jour.** Tout commit de code inclut la MAJ carto (approche delta). Fix sécurité → MAJ AUDIT_REPORT + issues. |

> Vérifier toujours la véracité des informations en croisant avec le code réel.

---

## 8. Agent Tasklet

Si tu es un agent Tasklet, lis `docs/GOVERNANCE_BOOTSTRAP.md` pour te configurer comme gardien de la gouvernance. Le système est **zéro état agent** — tout vit dans le repo.

---

## Liens rapides

| Ressource | Chemin |
|-----------|--------|
| Cartographie | `docs/CARTOGRAPHY_360.md` |
| Roadmap | `docs/ROADMAP_KOMERCE.md` |
| Audit principal | `docs/AUDIT_REPORT.md` |
| Checklist sécurité | `docs/audit/SECURITY_CHECKLIST.md` |
| Deltas en attente | `docs/_pending/` |
| Bootstrap Tasklet | `docs/GOVERNANCE_BOOTSTRAP.md` |
| Système coffre-fort | `docs/IMPACT_SYSTEM.md` |
| Issues critiques | GitHub Issues #71-#76 |
| Issues majeures | GitHub Issues #77-#84 |
