# PROTOCOLE CHECKPOINT — Anti-perte de session

## Règle absolue

La priorité est de sauvegarder ce qu’un agent suivant ne peut pas reconstruire depuis une
nouvelle sandbox : code, tests, artefacts générés et preuves.

Chaque unité de travail se livre donc en deux phases distantes séparées :

```text
PHASE 1 — travail récupérable
source / tests / artefacts / preuves
→ commit atomique
→ push confirmé sur origin
→ CHECKPOINT_DISTANT=<sha_travail>

PHASE 2 — description de l’état
state / worklog / audit / STATUS
→ référence explicite à <sha_travail>
→ commit documentaire
→ push confirmé sur origin
→ CHECKPOINT_DISTANT=<sha_metadata>
```

Il est interdit d’écrire ou de finaliser le statut d’un travail qui n’a pas encore été poussé.
Il est également interdit de conserver du code uniquement dans la sandbox pendant que l’agent
rédige longuement son state ou son compte rendu.

Un state en retard est récupérable à partir du code distant et de l’historique Git. Du code en
avance uniquement dans une sandbox ne l’est pas.

## Ordre obligatoire

Pour une correction fonctionnelle :

1. produire une petite unité source ou test cohérente ;
2. la committer et la pousser immédiatement ;
3. vérifier que son SHA est visible sur `origin/agent/lane-mobile-renderer` ;
4. produire ensuite les preuves ou artefacts issus de cette unité ;
5. les committer et les pousser immédiatement ;
6. seulement après, mettre à jour le state, le worklog, l’audit et `STATUS.md` ;
7. le checkpoint documentaire doit référencer le dernier SHA de travail déjà distant.

En cas de coupure entre les phases 1 et 2, l’agent suivant lit le diff, les tests, les preuves et
les messages de commit distants, puis reconstruit les métadonnées manquantes. Il ne réimplémente
pas le travail.

## Commande obligatoire

Pour chaque phase, utiliser séparément :

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

La phase suivante ne commence qu’après cet affichage.

## Séparation des lots

Ne mélange pas dans un même checkpoint :

- les fichiers de produit, tests ou preuves ;
- les fichiers de statut et de pilotage.

Lots de travail récupérable typiques :

- correction source atomique ;
- test ciblé associé ;
- groupe indivisible d’artefacts générés par une même commande ;
- capture ou preuve réelle.

Lot documentaire typique, toujours après les lots précédents :

- `.agent/state/T-XXX.json` ;
- worklog correspondant ;
- audit correspondant ;
- `.agent/STATUS.md` ;
- lane ou carte d’exécution uniquement si l’avancement global change.

Les arbitrages et extensions de périmètre nécessaires avant le code restent un petit checkpoint
documentaire préalable. Dès que l’arbitrage est résolu, le premier checkpoint suivant doit être
le travail récupérable, pas un second long compte rendu.

Maximum recommandé : trois fichiers source. Les bundles, index de cache et autres artefacts
générés par une même commande peuvent former un groupe indivisible distinct.

Il est interdit d’accumuler plusieurs commits locaux avant un push groupé.

## Source de vérité en reprise

Lorsqu’un state semble en retard ou contradictoire, l’ordre de preuve est :

1. branche distante et historique Git ;
2. fichiers source et tests poussés ;
3. preuves et artefacts poussés ;
4. résultats de gates enregistrés ;
5. state, worklog et tableau de statut.

Le state facilite la lecture, mais ne peut pas invalider du travail réellement présent à distance.
L’agent suivant doit signaler la divergence, reconstruire les métadonnées depuis les commits et
ne jamais conclure « rien n’existe » sans inspecter le code et les preuves de la branche concernée.

## Push obligatoire avant risque

Créer et confirmer un checkpoint distant du travail récupérable avant :

- une suite de tests longue ;
- une génération de captures ;
- une compilation ou migration risquée ;
- un changement de stratégie ;
- une demande d’arbitrage ;
- la rédaction du state de sortie ;
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
git log --oneline --decorate -20
```

- SHA identiques et worktree propre : reprendre après le dernier checkpoint distant.
- SHA différents ou worktree non propre : ne rien modifier ; diagnostiquer la divergence.
- code ou preuves distants plus récents que le state : terminer seulement la métadonnée manquante.

La preuve de continuité est le dernier travail visible à distance, jamais un message de chat ni
un commit annoncé mais non poussé.