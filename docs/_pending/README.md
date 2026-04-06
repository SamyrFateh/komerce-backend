# 📥 Dossier _pending — Deltas de Gouvernance

> **Ce dossier est surveillé automatiquement par le trigger Tasklet toutes les 10 minutes.**

## 🎯 Objectif

Tout agent (Cursor, Tasklet, humain) qui modifie le code **DOIT** déposer ici un fichier delta
décrivant les changements à répercuter dans les docs de gouvernance.

## 📝 Format du fichier delta

**Nom** : `YYYY-MM-DD_HH-MM_description-courte.md`

**Exemple** : `2026-04-06_18-30_dashboard-9-vues.md`

**Contenu** :

```markdown
# Delta — [Titre descriptif]

## Agent
[Nom de l'agent : cursor / tasklet / humain]

## Session
[Résumé en 1 ligne de ce qui a été fait]

## ROADMAP
- Section X : [changement à appliquer]
- Tâche Y.Z : [nouveau statut ✅/🟡/⬜]

## CARTOGRAPHY
- Section X : [changement à appliquer]
- Fichier ajouté/supprimé : [chemin]

## AUDIT
- [Changement si applicable, sinon omettre cette section]
```

## ⚙️ Règles

1. **Un delta par session de travail** — pas besoin de micro-deltas
2. **Soyez précis** — indiquez sections et numéros de tâches exacts
3. **Le trigger** lira ce delta, l'appliquera aux docs, commitera, puis **supprimera le fichier delta**
4. **Ne modifiez PAS** les docs directement si le trigger est actif — utilisez ce dossier
5. Si le delta est ambigu, le trigger le logera sans l'appliquer

## 🔄 Cycle de vie

```
Agent fait du code → Dépose un delta ici → Trigger (10 min) → 
Lit delta → Met à jour ROADMAP/CARTO → Commit → Supprime delta
```

## 📋 Exemple complet

```markdown
# Delta — Dashboard Pilotage : 9 vues complètes

## Agent
cursor

## Session  
Refonte du dashboard pilotage : ajout de 4 nouvelles vues
(Hub Dubai, Relais, Pipeline, Clients) + rename des anciennes.

## ROADMAP
- Section 2 : nombre de vues 5 → 9
- Tâche 2.4 : ✅ (était "Vue Ops" → renommée "HubDubaiView")
- Tâche 2.5 : ✅ (était "Vue Finance" → renommée "FinanceView") 
- Tâche 2.6 : ✅ (était "Vue Pilotage" → renommée "OverviewView")
- Nouvelles tâches à ajouter : 2.7 RelaisView, 2.8 PipelineView, 2.9 ClientsView, 2.10 CatalogueView

## CARTOGRAPHY
- Section 13 : remplacer OpsView/PilotageView/AlertsView par les 9 composants réels
- Section 2 (arbre fichiers) : mettre à jour dashboard-app/components/
- Compteurs fichiers : 12 → 18
```
