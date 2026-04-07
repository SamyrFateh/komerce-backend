# Delta — Hardened Governance: 3 corrections anti-oubli delta

## Contexte
Mise en place de 3 corrections définitives pour éviter tout travail sans delta associé.

### Correction 1 — Règle interne agent
Nouvelle règle #7 : Tout travail (PR, code, analyse) → delta IMMÉDIAT dans `docs/_pending/` AVANT de reporter au user. Zéro exception.

### Correction 2 — Sous-agent enrichi (filet de sécurité)
Step 1bis dans governance-autocommit : vérifie les PRs ouvertes sans delta associé. Avertissement dans le rapport si oubli détecté.

### Correction 3 — Checklist pré-rapport (gate bloquante)
Nouvelle règle #8 + section dédiée : avant de dire "✅ terminé", vérifier :
- 📄 Delta déposé ?
- 🗺️ Carto incluse ?
- 📋 Roadmap impactée ?

## ROADMAP
- Pas de changement de tâche (gouvernance interne)

## CARTOGRAPHY
- `docs/GOVERNANCE.md` — v2.2 → v2.3, 2 règles ajoutées, workflow enrichi, section checklist
- `docs/AGENT_SUBAGENTS.md` — v1 → v2, Step 1bis ajouté, mission enrichie
