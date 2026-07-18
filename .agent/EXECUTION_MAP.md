# EXECUTION MAP — PDP Komerce

## Règle

Chaque lane est un sujet cohérent et possède une branche durable unique.

```text
LANE-X → agent/lane-x
```

Les tâches d’une lane sont exécutées séquentiellement sur cette branche. Elles peuvent
modifier plusieurs fois les mêmes fichiers. Elles produisent une seule PR à la fin de
la lane.

Deux lanes peuvent travailler en parallèle uniquement si leurs périmètres ne se
chevauchent pas ou si une intégration explicite est prévue.

## Ordre minimal

1. `T-001` établit le préflight commun.
2. Chaque lane P1 poursuit ses tâches dans l’ordre indiqué.
3. Les tâches transverses T-026 et T-027 viennent après les corrections ciblées.
4. Les tâches P2 puis P3 suivent leurs dépendances.
5. `T-030` clôture le chantier.

## Lanes et branches

| Lane | Branche durable | Tâches |
|---|---|---|
| `LANE-0` | `agent/lane-0` | `T-001` |
| `LANE-MOBILE-RENDERER` | `agent/lane-mobile-renderer` | `T-002 → T-003 → T-004 → T-005 → T-006` |
| `LANE-META` | `agent/lane-meta` | `T-007 → T-017` |
| `LANE-MOBILE-SHELL` | `agent/lane-mobile-shell` | `T-008 → T-009 → T-011 → T-012` |
| `LANE-BUYBOX` | `agent/lane-buybox` | `T-010` |
| `LANE-DESKTOP-TYPE` | `agent/lane-desktop-type` | `T-013 → T-014 → T-015` |
| `LANE-DESKTOP-COMPOSITION` | `agent/lane-desktop-composition` | `T-016 → T-023` |
| `LANE-DESKTOP-VISUAL` | `agent/lane-desktop-visual` | `T-018 → T-019` |
| `LANE-DESKTOP-LAYOUT` | `agent/lane-desktop-layout` | `T-020 → T-021 → T-022` |
| `LANE-FINISH` | `agent/lane-finish` | `T-024 → T-025 → T-028 → T-029` |
| `LANE-TRANSVERSE` | `agent/lane-transverse` | `T-026 → T-027` |
| `LANE-FINAL` | `agent/lane-final` | `T-030` |

## Revue

La revue humaine intervient à la fin de la lane, sur une PR unique. Une tâche
intermédiaire ne bloque pas automatiquement la suivante lorsqu’elle a ses gates verts.

## Parallélisme interdit

- deux agents sur la même lane ;
- une branche distincte par tâche d’une même lane ;
- deux lanes modifiant simultanément les mêmes owners sans intégrateur ;
- repartir de `main` au milieu d’une lane ;
- déplacer manuellement des fichiers entre branches.
