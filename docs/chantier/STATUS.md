# STATUS — registre commun des chantiers Komerce

> Dernière vérification : **2026-11-14**, GitHub.  
> **Seul tableau de coordination actif** pour ChatGPT/GPT, Sonnet et Opus. Il remplace les journaux de tâches historiques ; il ne remplace ni le code, ni les données live, ni `AGENTS.md`, ni les cartes Feature First, ni les checks GitHub.
> La PR et ses checks font foi pour l'état du code. Un nom d'agent n'est pas une preuve d'exécution.

## Comment travailler à plusieurs sans collision

1. **Lire ce fichier sur `main` et les PR ouvertes avant d'agir.** Ne pas reprendre une tâche déjà attribuée sans transfert explicite. Ne jamais interpréter une vieille section « terminé » comme preuve actuelle.
2. **Réserver une tâche avant le premier changement de code** : une seule ligne active avec ID issue/PR, propriétaire (`GPT`, `Sonnet`, `Opus`), périmètre/chemins concernés, branche, statut et prochaine action. Pas de double propriétaire actif. Si l'assignation est inconnue, inscrire `à attribuer` plutôt que deviner.
3. **Mettre à jour après chaque événement vérifié** : début, PR ouverte, blocage, changement de propriétaire, checks, merge. `FAIT` exige une PR effectivement fusionnée dans `main` (ou une preuve précise si aucun code n'était à livrer). La certification staging/production est un verdict séparé.
4. **Ne pas se marcher dessus** : une tâche = un propriétaire à la fois ; scope technique et fichiers clairement indiqués ; pas de changement de même writer, migration ou contrat transversal en parallèle sans coordination. Si conflit de périmètre, mettre en `BLOQUÉ` et signaler.
5. **Pas d'écrasement concurrent de STATUS.md** : relire la version la plus récente sur `main` avant chaque écriture ; faire une modification minimale, conserver les lignes d'autrui ; utiliser le SHA de fichier / rebase, et en cas de conflit relire et recomposer, jamais forcer. Une modification de coordination passe par le workflow Git prévu par `AGENTS.md` ; ne pas court-circuiter ses gates.
6. **Éviter la bureaucratie** : une ligne courte par chantier actif ; lien issue/PR ; tests/checks et commits précis. Les détails, discussions et preuves longues restent dans les PR. Archiver les tâches closes hors du tableau actif après une période raisonnable, avec le lien de preuve. Pas de second tracker dans `.agent/`, `docs/Work/` ou des prompts.

Statuts autorisés : `À_FAIRE` · `EN_COURS` · `PR_EN_REVUE` · `BLOQUÉ` · `FAIT` · `ABANDONNÉ`. Une PR draft ouverte n'est pas `FAIT`.

## Tâches actives — reprise contrôlée (14 novembre 2026)

| Chantier | Responsable | Statut | PR / source | Zone réservée | Prochaine action / preuve |
| --- | --- | --- | --- | --- | --- |
| Fermer les writers Hub legacy HB-09 | **GPT** (priorité demandée) | **PR_EN_REVUE** (draft, non mergée) | [#4014](https://github.com/SamyrFateh/komerce-backend/pull/4014) · [#4013](https://github.com/SamyrFateh/komerce-backend/issues/4013) | Hub legacy : `routes/hub-dashboard.js`, `/hub`, `public/hub/index.html` ; vérifier le diff réel avant toute édition | Mettre à jour #4014, obtenir preflight/checks requis verts, vérifier mergeabilité, merger selon `AGENTS.md`. **Ne pas en faire un chantier Sonnet en parallèle.** |
| Consolidation audit Hub H1–H4 (ancienne PR) | **À attribuer**, **gelée** pendant #4014 | **BLOQUÉ** | [#4004](https://github.com/SamyrFateh/komerce-backend/pull/4004), draft ouverte · [#3998](https://github.com/SamyrFateh/komerce-backend/issues/3998) | Reprise/quantités/réception/supervision Hub | Après #4014, comparer couverture avec #4010 et les merges réels ; ne pas fermer ni merger par simple présomption de doublon. |
| Consolidation audit Hub + simplification KOM-BOX | **À attribuer**, **gelée** pendant #4014 | **BLOQUÉ** | [#4010](https://github.com/SamyrFateh/komerce-backend/pull/4010), draft ouverte · [#3998](https://github.com/SamyrFateh/komerce-backend/issues/3998) | Hub H1–H4 / placement sac→KOM-BOX | Réconcilier avec #4004 après #4014 ; désigner **un seul** PR porteur et fermer l'autre seulement une fois la couverture prouvée. |

> Ce tableau est un **instantané de coordination**, pas une déclaration d'exhaustivité des PR ou des corrections financières. Avant d'ajouter un chantier, consulter GitHub et éviter les doublons ; les attributions non observées ne doivent pas être inventées. Priorité de reprise : **#4014 d'abord**.

## Modèle à copier pour une nouvelle tâche

`| Action métier précise | Sonnet/GPT/Opus | À_FAIRE / EN_COURS / PR_EN_REVUE / BLOQUÉ | #issue / #PR | fichiers/feature + branche | prochaine action factuelle |`

## Clôtures récentes

| Date | Chantier | Responsable | Preuve | Certification / suite |
| --- | --- | --- | --- | --- |
| — | Aucune clôture nouvelle déduite de ce registre | — | — | — |

Lors de chaque clôture, ajouter un enregistrement daté avec le numéro de PR, le merge SHA et le niveau de preuve atteint. Ne jamais confondre « tests verts », « mergé » et « certifié staging/production ».
