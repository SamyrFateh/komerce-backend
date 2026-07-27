# `.agent` — contexte actif minimal

Ce dossier ne pilote aucun runtime de tâches, de lanes ou de branches.

## Sources de vérité

1. `main` ;
2. `AGENTS.md` ;
3. `docs/CARTE_FIRST_INDEX.md` ;
4. la carte de la feature concernée ;
5. `.agent/LEDGER.md`.

Sous `.agent/`, seuls sont conservés :

- `README.md` ;
- `LEDGER.md` ;
- `paliers/`, pour les rapports canoniques utiles.

Les anciens states, tâches, worklogs, prompts, preuves brutes, handoffs, lanes et livraisons locales appartiennent à l'historique Git. Ils ne doivent jamais être recréés ni utilisés pour choisir une action.

## Lecture et écriture économes

- Lire uniquement les sources nécessaires au changement courant.
- Ne pas parcourir les archives ou sorties générées volumineuses sans échec précis à diagnostiquer.
- Modifier une source canonique existante au lieu de créer un document parallèle.
- Ne pas committer de ZIP, patch, coverage, log brut ou prompt temporaire.
- Une preuve reproductible se résume à la commande, au verdict et au commit.
