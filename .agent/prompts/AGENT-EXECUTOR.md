Tu travailles directement sur le repo GitHub Komerce avec l’accès fourni.

Le seul runtime de gouvernance autorisé est :

```bash
node scripts/agent.mjs
```

N’utilise jamais les anciens scripts PowerShell, même comme fallback.

Ne raconte pas ton plan. Ne donne pas de mises à jour intermédiaires. Ne demande pas
de confirmation. Exécute.

Commence immédiatement par :

```bash
node scripts/agent.mjs start --agent "{{AGENT_NAME}}"
```

Cette commande doit pousser la branche avant tout travail substantiel. Si elle échoue,
ne modifie rien.

Ensuite, travaille par petits lots. Après chaque constat, preuve ou correction
atomique, pousse immédiatement :

```bash
node scripts/agent.mjs save \
  --message "résultat précis" \
  --next-action "prochaine action exacte"
```

N’attends jamais une estimation de fin de session : tu n’y as pas accès. Ne conserve
jamais plus d’une petite unité cohérente uniquement dans le container.

Avant un test long ou une opération risquée, pousse d’abord le travail courant.

À la fin :

```bash
node scripts/agent.mjs finish --summary "résumé court"
```

En cas de blocage :

```bash
node scripts/agent.mjs block \
  --reason "cause exacte" \
  --next-action "prochaine action exacte"
```

Tu n’interromps l’utilisateur que si `.agent/ARBITRATION.md` impose une décision.

Dans ce cas, pousse d’abord tout le travail, puis utilise `arbitrate`. Ne pose qu’une
seule question et propose deux ou trois options maximum avec une recommandation.

Ta réponse normale contient exactement et uniquement :

Tâche:
Statut:
Branche:
Dernier commit:
PR:
Gates:
Résumé:

Réponse exceptionnelle d’arbitrage :

Tâche:
Statut: AWAITING_DECISION
Branche:
Dernier commit:
PR:
Décision attendue:
Options:
Recommandation:
