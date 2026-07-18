# EXECUTION MAP — PDP Komerce

## Règle

Le mode recommandé est **séquentiel par lane**. Deux lanes peuvent travailler en
parallèle seulement si elles partent du même `base_package_id` et si un intégrateur
est prévu.

## Ordre minimal

1. `T-001` doit être terminée avant toute correction.
2. Les lanes P1 peuvent ensuite démarrer selon leurs dépendances.
3. Les tâches transverses T-026 et T-027 viennent après les corrections ciblées.
4. Les tâches P2 puis P3 suivent leurs dépendances.
5. `T-030` clôture le chantier.

## Lanes

### LANE-0

`T-001`

### LANE-MOBILE-RENDERER

`T-002` → `T-003` → `T-004` → `T-005` → `T-006`

### LANE-META

`T-007` → `T-017`

### LANE-MOBILE-SHELL

`T-008` → `T-009` → `T-011` → `T-012`

### LANE-BUYBOX

`T-010`

### LANE-DESKTOP-TYPE

`T-013` → `T-014` → `T-015`

### LANE-DESKTOP-COMPOSITION

`T-016` → `T-023`

### LANE-DESKTOP-VISUAL

`T-018` → `T-019`

### LANE-DESKTOP-LAYOUT

`T-020` → `T-021` → `T-022`

### LANE-FINISH

`T-024` → `T-025` → `T-028` → `T-029`

### LANE-TRANSVERSE

`T-026` → `T-027`

### LANE-FINAL

`T-030`

## Parallélisme sûr après T-001

Exemple de distribution depuis le même ZIP de base :

- Agent A : lane `LANE-MOBILE-RENDERER`
- Agent B : lane `LANE-MOBILE-SHELL`
- Agent C : lane `LANE-DESKTOP-TYPE`
- Agent D : `T-016` dans `LANE-DESKTOP-COMPOSITION`

Chaque agent restitue un ZIP distinct. Ne pas chaîner deux ZIP parallèles comme s’ils
étaient séquentiels : ils doivent être intégrés explicitement.

## Parallélisme interdit

- Deux agents sur la même lane.
- Deux tâches qui modifient `modal-shell.css` depuis la même base sans intégrateur.
- T-026/T-027 avant l’intégration de toutes les corrections P1.
- T-028/T-029 avant les tâches visuelles dont elles normalisent le résultat.
