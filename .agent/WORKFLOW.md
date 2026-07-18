# Workflow GitHub — branche durable par lane

## Exemple mobile

```text
agent/lane-mobile-renderer
├── T-002 — commits et gates
├── T-003 — commits et gates
├── T-004 — commits et gates
├── T-005 — commits et gates
└── T-006 — commits et gates
    └── PR unique vers main
```

## Démarrage ou reprise de la lane

```bash
node scripts/agent.mjs start --agent "sonnet"
```

Si la branche de lane existe déjà, la CLI la récupère et sélectionne la prochaine
tâche exécutable dans cette branche. Elle ne repart pas de `main`.

## Petit lot

```bash
node scripts/agent.mjs save \
  --message "résultat précis" \
  --next-action "action suivante exacte"
```

## Fin d’une tâche

```bash
node scripts/agent.mjs finish --summary "résumé court"
```

Si les gates passent et qu’une tâche suivante existe dans la lane, la CLI marque la
tâche `DONE`, démarre automatiquement la suivante et reste sur la même branche.

Si aucune tâche ne reste, la CLI prépare la revue de lane et ouvre une PR unique.

## Après coupure

```bash
node scripts/agent.mjs resume --task T-003 --agent "sonnet-2"
```

## Arbitrage réel

```bash
node scripts/agent.mjs arbitrate \
  --question "décision exacte" \
  --options "Option A|Option B" \
  --recommendation "Option B" \
  --context "faits vérifiés" \
  --next-action "action après décision"
```
