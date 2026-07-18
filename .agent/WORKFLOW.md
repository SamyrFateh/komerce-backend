# Workflow GitHub Continuous Push

## Parcours canonique

```text
start + push immédiat
→ petit lot cohérent
→ save + push
→ petit lot suivant
→ save + push
→ finish + gates + push
→ PR brouillon
```

## Commandes

```bash
node scripts/agent.mjs start --agent "sonnet"
node scripts/agent.mjs save --message "résultat précis" --next-action "suite exacte"
node scripts/agent.mjs finish --summary "résumé court"
```

Après coupure :

```bash
node scripts/agent.mjs resume --task T-001 --agent "sonnet-2"
```

Pour un arbitrage réel uniquement :

```bash
node scripts/agent.mjs arbitrate \
  --question "décision exacte" \
  --options "Option A|Option B" \
  --recommendation "Option B" \
  --context "faits vérifiés" \
  --next-action "action après décision"
```

Aucun script PowerShell n’appartient au parcours actif.
