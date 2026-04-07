# Gouvernance Komerce v2.2

> **Fichier unique de gouvernance.** Tout agent (IA ou humain) DOIT lire ce fichier avant toute action.

---

## ⚠️ RÈGLE ABSOLUE — Commit toutes les 10 min

> **Ta session peut s'arrêter à tout moment** (crédit épuisé, timeout, crash). Tout code non commité est **perdu**.

```
⏱️ 10 min max entre chaque commit. Pas de négociation.
```

- **Format WIP** : `wip: [ce qui a été fait]`
- **Commit propre** quand une tâche est terminée : `feat/fix/refactor: [description]`
- Ne jamais accumuler du travail — **commit petit, commit souvent**
- En début de session : vérifier que le dernier commit reflète l'état réel
- **Zéro fichier local.** Ton dossier de travail c'est Git. Rien ne vit en dehors du repo.

---

## ⚠️ RÈGLE ABSOLUE — Commit immédiat des analyses

> **Toute analyse, étude d'impact, ou travail préparatoire terminé DOIT être commité immédiatement** dans `docs/_work/` ou `docs/_logs/` AVANT de passer au code.

```
🧠 Analyse terminée → Commit IMMÉDIAT. Pas d'exception.
```

- **Pourquoi ?** Si la session coupe entre l'analyse et le code, l'analyse est perdue → on recommence tout à zéro.
- **Où ?** `docs/_work/YYYY-MM-DD_nom-analyse.md` pour les analyses en cours, `docs/_logs/` pour les résultats finaux.
- **Format commit** : `docs(analysis): [description courte]`
- **Contenu minimum** : contexte, fichiers impactés, décisions prises, plan d'action.
- L'analyse commitée sert de **brief** pour la session suivante si coupure → zéro perte de réflexion.

---

## 1. Règle d'entrée

Dès lecture du README, l'agent DOIT **immédiatement** :

1. Lire `docs/ROADMAP_KOMERCE.md`
2. Afficher le statut projet :
```
📊 STATUT KOMERCE
✅ Fait : [domaines complétés]
🟡 En cours : [priorité N — nom] → tâche X/Y
⬜ À venir : [prochaines priorités]
🔴 Bloquants : [issues critiques]
```
3. Enchaîner sur la **première tâche ⬜** de la priorité la plus haute

> Seule une demande **explicite** du propriétaire peut déroger à cet ordre.

---

## 2. Les 3 piliers

| Pilier | Fichier | Rôle |
|--------|---------|------|
| 🗺️ Carte | `docs/CARTOGRAPHY_360.md` | Architecture complète : 120 endpoints, 28+ tables, middlewares, dépendances |
| 📋 Plan | `docs/ROADMAP_KOMERCE.md` | Source de vérité unique : priorités, tâches, progression |
| 🔒 Bouclier | `docs/AUDIT_REPORT.md` + `docs/audit/*` + Issues #71-#84 | Sécurité : 6 critiques (#71-76), 8 majeures (#77-84) |

### Fichiers audit détaillés

`SECURITY_CHECKLIST.md` · `AUDIT_BUGS.md` · `AUDIT_CODE_INTEGRITY.md` · `FRONTEND_AUDIT.md` · `db_audit.md` · `middleware_audit.md` · `utils_audit.md` · `batch_2.md` à `batch_6.md` — tous dans `docs/audit/`

---

## 3. Workflow

```
AVANT de coder           PENDANT                    APRÈS
─────────────────        ──────────────────         ─────────────────────────
① Lire ROADMAP           ④ Respecter l'archi        ⑥ Déposer un delta
② Lire CARTOGRAPHY         existante                  dans docs/_pending/
③ Consulter AUDIT        ⑤ COMMIT TOUTES LES       ⑦ CHECKLIST PRÉ-RAPPORT
   → ALORS coder            10 MIN (wip:)              (delta? carto? roadmap?)
                         ⑤bis COMMIT ANALYSE          ⑧ Commit final propre
                              DÈS QU'ELLE EST FAITE
```

### Nouvelle demande / fonctionnalité ?
Ajouter d'abord à la ROADMAP (commit immédiat) → analyser CARTOGRAPHY (impacts) → **commit l'analyse** → consulter AUDIT (risques) → implémenter.

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

**Cycle** : Agent dépose delta → Trigger Tasklet (10 min) lit + applique + commit + supprime.

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

> **Approche DELTA obligatoire** : ne modifier que les lignes impactées.

---

## 6. Les 8 règles

| # | Règle |
|---|-------|
| 1 | **🔴 COMMIT TOUTES LES 10 MIN.** Zéro perte de travail. Session = éphémère, Git = permanent. |
| 2 | **🧠 COMMIT IMMÉDIAT DES ANALYSES.** Analyse terminée = commit dans docs/_work/. Zéro perte de réflexion.** |
| 3 | **Pas de code sans lecture des 3 piliers** |
| 4 | **Roadmap = source de vérité.** Toute demande y passe d'abord. Toujours suivre l'ordre de priorité. |
| 5 | **Un delta après chaque session.** Ne jamais modifier les docs directement si trigger actif. |
| 6 | **Cartographie à jour.** Tout commit de code inclut la MAJ carto (approche delta). Fix sécurité → MAJ AUDIT + issues. |
| 7 | **🚫 JAMAIS "TERMINÉ" SANS DELTA.** Tout travail (PR, code, analyse) → delta IMMÉDIAT dans `docs/_pending/` AVANT de reporter au user. Zéro exception. |
| 8 | **✅ CHECKLIST PRÉ-RAPPORT.** Avant de dire "terminé" : Delta déposé ? Carto incluse ? Roadmap impactée ? Les 3 doivent être ✅. |

> Vérifier toujours la véracité des informations en croisant avec le code réel.

### Checklist pré-rapport — Gate obligatoire

> **Avant TOUTE déclaration "✅ terminé" au user**, vérifier ces 3 points :

| # | Vérification | Action si manquant |
|---|-------------|-------------------|
| 📄 | **Delta déposé dans `docs/_pending/` ?** | Déposer le delta MAINTENANT |
| 🗺️ | **Cartographie impactée incluse dans le delta ?** | Ajouter la section CARTOGRAPHY au delta |
| 📋 | **Roadmap mise à jour dans le delta ?** | Ajouter la section ROADMAP au delta |

> 🚫 **Gate bloquante** : Si un seul point est ❌, ne PAS déclarer "terminé". Corriger d'abord.

---

## 7. Agent Tasklet

Si tu es un agent Tasklet, lis `docs/GOVERNANCE_BOOTSTRAP.md` pour te configurer comme gardien de la gouvernance.

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
