# `.agent` — contexte actif minimal

Ce dossier ne pilote plus un runtime de tâches, de lanes ou de branches.

## Source de vérité

- Branche unique : `main`.
- Instruction racine : `AGENTS.md`.
- Entrée documentaire : `docs/CARTE_FIRST_INDEX.md`.
- Intention métier : cartes `features/*.feature.js` et manifestes frontend concernés.
- Chantier courant : `.agent/LEDGER.md`.

Aucun ancien state, worklog, audit, handoff, compteur ou statut de tâche ne peut rouvrir un travail déjà présent dans le code ou déclaré clos dans le ledger courant.

## Lecture économe

Pour une intervention :

1. lire `AGENTS.md` ;
2. lire `docs/CARTE_FIRST_INDEX.md` ;
3. lire la carte de la feature concernée ;
4. lire uniquement la section pertinente de `.agent/LEDGER.md` ;
5. rechercher les symboles et fichiers directement concernés.

Ne pas parcourir par défaut :

- anciennes tâches `T-*` ;
- worklogs, states, handoffs et audits historiques ;
- preuves brutes de suites de tests ;
- prompts historiques ;
- `docs/_archive/` ;
- JSON et Markdown générés volumineux, sauf échec du générateur correspondant.

## Écriture économe

- Modifier le document canonique existant au lieu d'en créer un nouveau.
- Ne pas créer de prompt bis, rapport daté, ZIP ou patch dans le dépôt.
- Une preuve reproductible se résume par la commande, le résultat et le commit ; son log brut reste hors Git.
- Les rapports de palier restent courts : avant, modification, après, test de détection, dette restante.
- Aucun compte rendu ne doit recopier intégralement du code, un log ou une sortie générée.

## Travail actif

Le chantier de clôture porte uniquement sur :

1. P3b — terminer la projection `gateHealth` prévue par l'audit ;
2. P3/P3b — réparer le mojibake introduit lors du split et le libellé `propriétaire: undefined` ;
3. P5 — fermer les règles de remboursement, l'émission QR et l'idempotence wallet ;
4. documentation — réconcilier les rapports et la roadmap avec le code réel ;
5. nettoyage dépôt — supprimer les anciennes mécaniques `.agent`, preuves brutes, patches et documents redondants après vérification de leurs références.

P6, P7 et P8 restent hors périmètre.

## Règle de suppression

Un fichier peut être supprimé lorsqu'il est :

- remplacé par une source canonique active ;
- non référencé par le code, les scripts, les gates ou l'index documentaire ;
- historique et reproductible depuis Git ;
- un artefact brut, un doublon ou une consigne de branche désormais fausse.

En cas de valeur historique réelle mais non opérationnelle, déplacer sous `docs/_archive/` seulement si cette conservation apporte une information introuvable dans Git. Sinon, supprimer.
