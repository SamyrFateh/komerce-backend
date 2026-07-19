# PROTOCOLE CHECKPOINT — Anti-perte de session

## Règle absolue

Un checkpoint n’existe que lorsque les trois étapes sont terminées :

```text
petit lot cohérent → commit atomique → push confirmé sur origin
```

Un commit uniquement local n’est pas une sauvegarde suffisante. Il est interdit de commencer
un deuxième lot tant que le SHA du premier n’est pas visible sur
`origin/agent/lane-mobile-renderer`.

## Commande obligatoire

Pour chaque lot, utiliser :

```bash
node scripts/agent-checkpoint.mjs \
  --message "type(t-xxx): résultat atomique" \
  -- chemin/du/fichier-1 chemin/du/fichier-2
```

La commande :

1. vérifie la branche courante ;
2. fetch `origin` ;
3. exige que `HEAD` soit identique au HEAD distant avant le commit ;
4. refuse les modifications non incluses dans le lot ;
5. committe avec les hooks actifs ;
6. pousse sans force ;
7. fetch à nouveau ;
8. exige que le SHA local soit exactement le SHA distant ;
9. affiche `CHECKPOINT_DISTANT=<sha>`.

Le lot suivant ne commence qu’après cet affichage.

## Taille des lots

Un lot est une seule unité réversible et compréhensible :

- arbitrage + mise à jour task/state ;
- correction source atomique ;
- test ciblé associé à cette correction ;
- groupe indivisible d’artefacts générés par une même commande ;
- preuves + state de sortie.

Maximum recommandé : trois fichiers source. Les bundles, index de cache et autres artefacts
générés par une même commande peuvent former un groupe indivisible distinct.

Il est interdit d’accumuler plusieurs commits locaux avant un push groupé.

## Push obligatoire avant risque

Créer et confirmer un checkpoint distant avant :

- une suite de tests longue ;
- une génération de captures ;
- une compilation ou migration risquée ;
- un changement de stratégie ;
- une demande d’arbitrage ;
- toute réponse finale à l’utilisateur ;
- toute pause ou fin de session.

## Concurrence et non-fast-forward

Au premier écart entre le HEAD local et le HEAD distant, ou au premier rejet
`non-fast-forward` :

1. arrêter immédiatement les modifications ;
2. ne pas merge, rebase, cherry-pick, reset, stash ou force-push automatiquement ;
3. conserver tous les commits et fichiers locaux ;
4. afficher les SHA local et distant ;
5. afficher les dix derniers commits et la divergence ;
6. demander une réconciliation explicite.

La branche distante ne doit jamais être réécrite pour sauver un checkpoint local.

## Reprise après coupure

À la reprise :

```bash
git fetch origin --prune
git status --short
git rev-parse HEAD
git rev-parse origin/agent/lane-mobile-renderer
```

- SHA identiques et worktree propre : reprendre après le dernier checkpoint distant.
- SHA différents ou worktree non propre : ne rien modifier ; diagnostiquer la divergence.

La preuve de continuité est le dernier `CHECKPOINT_DISTANT`, jamais un message de chat ni un
commit annoncé mais non poussé.
