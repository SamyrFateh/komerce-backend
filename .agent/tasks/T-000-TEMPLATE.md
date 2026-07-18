# {{TASK_ID}} â€” {{TITLE}}

## MÃ©tadonnÃ©es

- Feature ID : `{{FEATURE_ID}}`
- Ã‰cart dâ€™audit / besoin : `{{FINDING_ID}}`
- PrioritÃ© : `MEDIUM`
- DÃ©pendances : aucune
- ADR applicables : aucune

## Objectif

DÃ©crire un seul rÃ©sultat observable.

## Contexte minimal

Donner uniquement les informations nÃ©cessaires Ã  lâ€™exÃ©cution de cette tÃ¢che.

## PÃ©rimÃ¨tre autorisÃ©

```text
chemin/fichier-1
chemin/fichier-2
```

## PÃ©rimÃ¨tre interdit

```text
Ã€ renseigner
```

## Action attendue

1.
2.
3.

## CritÃ¨res dâ€™acceptation

- [ ] Le rÃ©sultat principal est observable.
- [ ] Aucun comportement hors pÃ©rimÃ¨tre nâ€™a changÃ©.
- [ ] Les fichiers modifiÃ©s correspondent au pÃ©rimÃ¨tre dÃ©clarÃ©.
- [ ] Les preuves sont dÃ©posÃ©es.
- [ ] Le handoff est complet.

## Gates

```text
Ã€ remplacer par les commandes rÃ©elles.
```

## Preuves attendues

- `.agent/evidence/{{TASK_ID}}/before.*`
- `.agent/evidence/{{TASK_ID}}/after.*`
- `.agent/evidence/{{TASK_ID}}/tests.txt`

## Risques particuliers

- Aucun risque identifiÃ© Ã  ce stade.

## Notes pour le reviewer

- VÃ©rifier la conformitÃ© au pÃ©rimÃ¨tre.
- VÃ©rifier les critÃ¨res dâ€™acceptation.
- VÃ©rifier les effets de bord.
