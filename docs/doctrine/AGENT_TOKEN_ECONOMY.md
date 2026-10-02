# Doctrine — économie de tokens des agents

Cette doctrine conserve le détail opérationnel extrait de `AGENTS.md §7.1`.
`AGENTS.md` reste l'autorité racine ; ce document sert de référence détaillée
lorsqu'un diagnostic de coût/contexte est nécessaire.

## 7.1. Économie de tokens — anti-patterns et réflexes obligatoires

Chaque token consommé coûte du temps et du crédit. Un agent efficace livre le même résultat avec 3× moins de contexte qu'un agent naïf.

### Anti-patterns interdits

| Anti-pattern | Coût typique | Réflexe correct |
|---|---|---|
| Lire un fichier entier pour trouver une fonction | ~2 000 tokens | `grep` ou recherche ciblée + lecture du range utile |
| Relire AGENTS.md à chaque tour | ~2 500 tokens | Déjà en contexte au démarrage — ne jamais relire |
| `git clone --depth=0` ou `git fetch --unshallow` | réseau + tokens des logs | `fetch --depth=1` + `fetch origin <SHA>` sur le SHA utile |
| Lire les sorties générées (FEATURE_360.json, BUSINESS_FEATURE_GRAPH.json, etc.) | 5 000–50 000 tokens | Lire la carte source, pas la projection |
| Scanner `docs/` ou `archive/` sans cible | milliers de tokens | Recherche ciblée par nom/grep, jamais `ls -R` |
| Recopier le contenu d'un fichier dans la réponse | double le coût | Citer le chemin + les lignes pertinentes |
| Lancer `npm run map:check` pour un changement ciblé | ~3 min CI | `npm run pr:preflight` suffit |
| Lancer la suite de tests complète pour un fichier | ~2 min | `npx jest --findRelatedTests <fichier>` |
| Lire `.agent/LEDGER.md` en entier | ~3 000 tokens | Lire uniquement la section du chantier courant |
| Créer un rapport/memo/audit parallèle | tokens + bruit | Modifier le document canonique existant |

### Réflexes de lecture minimale

1. **Carte feature** : lire seulement `name`, `service`, `perimeter`, `authority`, `invariants`, `files` — pas les commentaires ni l'historique.
2. **Headers `@komerce-arch`** : les 10–20 premières lignes du fichier source suffisent pour extraire owner, service, authority.
3. **`interventionIndex.mustCheck`** : une seule requête dans le graphe d'architecture, pas la lecture du JSON complet.
4. **Diff** : `git diff --name-only` d'abord pour le scope, `git diff <fichier>` ensuite uniquement sur les fichiers pertinents.
5. **Tests** : `--findRelatedTests` ou `run-staged-related-tests.js` — jamais la suite complète sauf preuve structurelle requise.
6. **Logs CI** : lire uniquement le step en échec, pas le log complet du job.

### Réflexes d'écriture minimale

1. **Réponse** : résultat + chemin + commande de preuve. Pas de récit de l'analyse ni de reformulation du brief.
2. **Commit message** : `<type>(<scope>): <quoi>` + une ligne pourquoi. Pas de paragraphes.
3. **PR body** : les sections `## Pourquoi / ## Quoi / ## Tests` remplies — pas de prose supplémentaire.
4. **Plan d'attaque** : le template de §1, pas un essai. 10 lignes max.
5. **Preuves** : la commande et le verdict (OK/FAIL). Pas le log brut.

### Séquence d'entrée optimale (budget cible : < 4 000 tokens de lecture)

```
1. AGENTS.md               → déjà en contexte (0 token)
2. Carte feature concernée → ~200–500 tokens (champs utiles)
3. Headers des 2–3 fichiers touchés → ~100 tokens chacun
4. mustCheck si applicable → ~50 tokens
5. .agent/LEDGER.md section courante → ~300 tokens
Total : < 1 500 tokens de lecture avant de coder
```

Un agent qui dépasse 4 000 tokens de lecture avant son premier changement doit justifier pourquoi dans le plan d'attaque.

### Clone et fetch

- **Jamais** `git clone` complet ni `git fetch --unshallow` sauf reconstruction globale explicite.
- Clone shallow : `--depth=1 --single-branch --branch main`.
- Pour un diff PR : `git fetch --depth=1 origin <BASE_SHA>` — uniquement le commit de base.
- Le workspace est déjà cloné dans la plupart des environnements agents — vérifier avant de cloner.

### Tests et gates

- **Avant PR** : `npm run pr:preflight` (unique commande, scope automatique).
- **Diagnostic** : la gate unitaire qui a échoué, pas toutes les gates.
- **Tests ciblés** : `npx jest --findRelatedTests <fichiers>` ou `node scripts/run-staged-related-tests.js`.
- **Suite complète** : uniquement si migration, changement de schéma ou refactoring transversal.
- Ne jamais relancer une gate verte pour "vérifier" — elle est déterministe.

## Projection compacte canonique

Le chemin normal n'est plus de relire manuellement toutes les sources ci-dessus.
La commande suivante compile uniquement le contexte utile au chantier :

```bash
npm run agent:context -- --brief --feature <feature>
# ou
npm run agent:context -- --brief --files path/a.js,path/b.js

# si et seulement si une ambiguïté subsiste
npm run agent:context -- --expand <feature|file>
```

La projection est dérivée des cartes Feature First, headers `@komerce-arch`,
`interventionIndex.mustCheck`, du diff et du ledger actif. Elle n'est jamais
une nouvelle source de vérité.

Budget d'entrée : 2800 caractères maximum, soit environ 700 tokens pour `--brief`.
Le mode complet à 6000 caractères reste disponible pour compatibilité, mais le
chemin normal est brief → expand ciblé → source brute seulement si nécessaire.
