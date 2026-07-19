# ADR-029 — Déblocage de T-029 par override des dépendances

- Statut : ACCEPTED
- Date : 2026-07-19
- Décideur : Samsam (utilisateur, propriétaire du dépôt)
- Tâches concernées : T-029 ; débloquées par override : T-018, T-019, T-021, T-022, T-027
- Features concernées : modal-product

## Contexte

`.agent/state/T-029.json` déclare 6 dépendances (`T-018`, `T-019`, `T-021`, `T-022`,
`T-025`, `T-027`). Seule T-025 était `DONE`. `scripts/agent.mjs start --task T-029`
refuse tant que `depsDone()` n'est pas vrai pour les 6.

## Options étudiées

### Option A — Exécuter T-018, T-019, T-021, T-022, T-027 avant T-029

Respecte la chaîne de dépendances telle que déclarée, mais retarde T-029 (5 tâches
supplémentaires, hors périmètre demandé aujourd'hui).

### Option B — Marquer ces 5 tâches `DONE` sans exécution ni gates, sur confirmation
explicite de l'utilisateur que leur contenu est déjà couvert ou obsolète

## Décision

Option B retenue, sur confirmation explicite de l'utilisateur en conversation.

## Justification

L'utilisateur a confirmé vouloir débloquer T-029 sans exécuter T-018/T-019/T-021/
T-022/T-027 au préalable. Ces 5 tâches sont marquées `DONE` par override déclaratif,
**sans preuve de gates ni diff associé** — à la différence des tâches réellement
exécutées (ex. T-025). Ce fichier fait foi de la décision et de son absence de
vérification technique. Si l'une de ces tâches s'avère non couverte en réalité,
le travail correspondant reste à faire malgré le statut `DONE` affiché.
