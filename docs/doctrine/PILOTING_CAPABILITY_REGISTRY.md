# Registre des Piloting Capabilities — Komerce

> **Version** : 1.0 — 2026-07-12
> **Statut** : registre actif — gouverné par
> `docs/doctrine/PILOTING_CAPABILITY_DOCTRINE.md`. Distinct de
> `docs/doctrine/APP_FEATURE_REGISTRY.md`, qui référence celui-ci plutôt que
> de dupliquer ses lignes.

| # | Capability | Manifest | Statut | Détecte / calcule (résumé) | Consommé par |
|---:|---|---|---|---|---|
| 1 | `decision-signals` | [`capabilities/decision-signals.capability.js`](../../capabilities/decision-signals.capability.js) | staging | Génère et qualifie des signaux opérationnels (radar cash/colis/incidents) à partir des données produites par plusieurs features | `dashboard` (via `routes/admin-radar.js`), consultation admin directe (`routes/signals.js`) |

---

## Historique

- **2026-07-12 (Lot O1)** : création. `decision-signals` était auparavant
  mélangée dans `features/recommendations.feature.js` (fichiers
  `services/radar-queries.js`, `services/signal-service.js`,
  `routes/signals.js`) alors que son service réel (générer des signaux
  opérationnels) n'a rien à voir avec le moteur de classement boutique
  (`services/boutique-ranking-engine.js`) qui reste seul propriétaire de
  `recommendations`. Voir `docs/chantier/BUSINESS_FEATURE_ONTOLOGY_AUDIT_V1.md`
  pour le constat complet et `docs/chantier/LOT_O1_LIVRABLE.md` pour le détail
  du déplacement (fichiers, headers, tests).
