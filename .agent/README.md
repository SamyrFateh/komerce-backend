# Gouvernance agents — GitHub Continuous Push V3.2

## Instruction unique

> Lis `.agent/`, prends la prochaine tâche, exécute-la et pousse chaque petit lot
> cohérent sur sa branche GitHub.

## Parcours obligatoire

```text
accès GitHub vérifié
→ branche distante créée
→ état IN_PROGRESS poussé
→ petit lot de travail
→ commit + push
→ petit lot suivant
→ commit + push
→ gates
→ état REVIEW/BLOCKED poussé
→ PR brouillon
```

## Runtime unique

```bash
node scripts/agent.mjs start --agent "sonnet"
node scripts/agent.mjs save --message "résultat précis" --next-action "action suivante"
node scripts/agent.mjs finish --summary "résumé court"
```

Les scripts PowerShell historiques ne font plus partie du protocole actif.

En cas de coupure :

```bash
node scripts/agent.mjs resume --task T-001 --agent "sonnet-2"
```

## Règle essentielle

L’agent ne connaît pas le moment de la coupure. Il ne doit donc jamais attendre une
jauge, 70 %, 90 % ou la fin de la tâche.

Chaque unité cohérente est poussée immédiatement. Une unité recommandée représente
environ un constat, une correction atomique ou au maximum trois fichiers source.

## Communication

Pendant l’exécution :

- aucun plan raconté ;
- aucun compte rendu intermédiaire dans le chat ;
- aucune demande de confirmation ;
- aucune longue synthèse ;
- priorité absolue à l’écriture, au commit et au push.

La réponse finale contient uniquement les sept champs déclarés dans le manifeste.

## Exception : arbitrage

L’agent interrompt le mode silencieux uniquement pour une décision couverte par
`.agent/ARBITRATION.md`.

Il pousse obligatoirement le travail courant avant de poser la question :

```bash
node scripts/agent.mjs arbitrate \
  --question "décision exacte" \
  --options "Option A|Option B" \
  --recommendation "Option B" \
  --context "faits vérifiés" \
  --next-action "action après décision"
```

Après la décision, la tâche reprend avec :

```bash
node scripts/agent.mjs decide \
  --task T-001 \
  --decision "Option B" \
  --decider "Samyr" \
  --agent "sonnet"
```
