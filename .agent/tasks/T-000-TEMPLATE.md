# {{TASK_ID}} — {{TITLE}}

## Métadonnées

- Feature ID : `{{FEATURE_ID}}`
- Écart d’audit / besoin : `{{FINDING_ID}}`
- Priorité : `MEDIUM`
- Dépendances : aucune
- ADR applicables : aucune

## Objectif

Décrire un seul résultat observable.

## Contexte minimal

Donner uniquement les informations nécessaires à l’exécution de cette tâche.

## Périmètre autorisé

```text
chemin/fichier-1
chemin/fichier-2
```

## Périmètre interdit

```text
À renseigner
```

## Action attendue

1.
2.
3.

## Critères d’acceptation

- [ ] Le résultat principal est observable.
- [ ] Aucun comportement hors périmètre n’a changé.
- [ ] Les fichiers modifiés correspondent au périmètre déclaré.
- [ ] Les preuves sont déposées.
- [ ] Le handoff est complet.

## Gates

```text
À remplacer par les commandes réelles.
```

## Preuves attendues

- `.agent/evidence/{{TASK_ID}}/before.*`
- `.agent/evidence/{{TASK_ID}}/after.*`
- `.agent/evidence/{{TASK_ID}}/tests.txt`

## Risques particuliers

- Aucun risque identifié à ce stade.

## Notes pour le reviewer

- Vérifier la conformité au périmètre.
- Vérifier les critères d’acceptation.
- Vérifier les effets de bord.
