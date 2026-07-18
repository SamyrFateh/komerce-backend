# Gouvernance agents — GitHub Lane Branch V3.3

## Instruction unique

> Lis `.agent/`, prends la prochaine tâche de la lane active, exécute-la et pousse
> chaque petit lot cohérent sur la branche durable de cette lane.

## Modèle de branche

Une **lane représente un sujet cohérent**. Toutes ses tâches, corrections, tests et
retours sur des fichiers déjà modifiés restent sur la même branche.

Exemple :

```text
LANE-MOBILE-RENDERER
→ agent/lane-mobile-renderer
→ T-002
→ T-003
→ T-004
→ T-005
→ T-006
→ une seule revue
→ une seule PR
→ merge dans main
```

Il est normal de modifier plusieurs fois le même fichier au fil du sujet. Les petits
commits permettent de revenir en arrière sans fragmenter le travail entre des branches.

## Parcours obligatoire

```text
accès GitHub vérifié
→ branche de lane créée ou reprise
→ tâche active poussée
→ petit lot
→ commit + push
→ petit lot suivant
→ commit + push
→ gates de la tâche
→ tâche DONE dans la lane
→ tâche suivante automatiquement sur la même branche
→ fin de lane
→ REVIEW + PR unique
```

## Runtime

```bash
node scripts/agent.mjs start --agent "sonnet"
node scripts/agent.mjs save --message "résultat précis" --next-action "action suivante"
node scripts/agent.mjs finish --summary "résumé court"
```

Après une coupure :

```bash
node scripts/agent.mjs resume --task T-003 --agent "sonnet-2"
```

## Interdictions

- une branche par micro-tâche ;
- une PR par micro-tâche ;
- repartir de `main` entre deux tâches d’une même lane ;
- recopier manuellement les fichiers d’une branche vers une autre ;
- attendre une estimation de fin de session avant de pousser ;
- raconter le plan dans le chat.

## Arbitrage

L’agent interrompt le mode silencieux uniquement pour un arbitrage réel. Il pousse
d’abord tout le travail courant, puis pose une seule question avec options et
recommandation.
