# Delta — Règles Opérationnelles Commandes

## Type: roadmap-addition
## Date: 2026-04-06
## Auteur: Tasklet (demande utilisateur)

### Changements

- **Roadmap v14.0 → v15.0**
- Nouvelle section §7 : **Priorité 6 — Règles Opérationnelles Commandes**
- 3 fonctionnalités documentées :
  1. Délai d'annulation sans frais post-paiement (`CANCEL_FREE_WINDOW_HOURS`)
  2. Règles d'expédition partielle Hub Dubai (`PARTIAL_SHIP_DELAY_THRESHOLD_DAYS`, `PARTIAL_SHIP_MIN_AVAILABLE_PCT`)
  3. Mécanisme d'annulation & mise à jour commande (flux complet)
- 8 tâches ajoutées (toutes ⬜)
- Sections existantes renumérotées (Améliorations futures → Priorité 7)

### Impact code
- Aucun code modifié (roadmap only)
- Tables DB futures : `business_rules`
- Routes futures : annulation, expédition partielle, config admin

### Gouvernance
- Mettre à jour CARTOGRAPHY : aucun fichier ajouté (docs seulement)
- Mettre à jour ROADMAP : déjà fait dans ce commit
