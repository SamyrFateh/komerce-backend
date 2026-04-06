# ⚠️ RÈGLES OBLIGATOIRES POUR TOUT AGENT IA

> **STOP** — Avant toute action sur ce projet, lire le protocole de gouvernance.

---

## 📊 PREMIÈRE ACTION — Statut Roadmap

> **🔴 Immédiatement après lecture de ce README, tout agent DOIT :**

1. **Lire** [`docs/ROADMAP_KOMERCE.md`](./docs/ROADMAP_KOMERCE.md)
2. **Présenter la progression globale** du projet (tableau résumé)
3. **Identifier et afficher le dernier point en cours** (priorité la plus haute, tâche active)

**Aucune question, aucune action ne doit précéder cette présentation.**

---

## 🚀 DEUXIÈME ACTION — Continuer le travail

> **Après la présentation du statut, l'agent enchaîne automatiquement sur la prochaine tâche de la priorité la plus haute.**

- 🟢 **Par défaut** : suivre l'ordre des priorités et des tâches de la Roadmap
- 🟠 **Exception** : seule une demande **EXPLICITE** du propriétaire peut déroger à cet ordre

→ Détails complets dans [`docs/AGENTS_PROTOCOL.md`](./docs/AGENTS_PROTOCOL.md) § "Règle de Continuité"

---

## 👉 LIRE ENSUITE

### [`docs/AGENTS_PROTOCOL.md`](./docs/AGENTS_PROTOCOL.md)

Ce fichier contient le **protocole obligatoire** qui lie les 3 documents de référence du projet :

| Pilier | Document | Rôle |
|--------|----------|------|
| 🗺️ **La Carte** | [`docs/CARTOGRAPHY_360.md`](./docs/CARTOGRAPHY_360.md) | Vue 360° de tout le système |
| 📋 **Le Plan** | [`docs/ROADMAP_KOMERCE.md`](./docs/ROADMAP_KOMERCE.md) | Roadmap unique — état réel du projet |
| 🔒 **Le Bouclier** | [`docs/AUDIT_REPORT.md`](./docs/AUDIT_REPORT.md) + [`docs/audit/`](./docs/audit/) | Audit de sécurité |

---

## Résumé des règles

1. **D'ABORD** → Lire le README → Présenter le statut Roadmap + dernier point en cours
2. **ENSUITE** → Enchaîner sur la prochaine tâche (ordre de priorité, sauf demande contraire)
3. **AVANT** toute modification → Lire `AGENTS_PROTOCOL.md` + les 3 piliers
4. **PENDANT** → Respecter l'architecture existante, utiliser les middlewares
5. **APRÈS** → Mettre à jour la Cartographie + la Roadmap + commiter

**Sans cette lecture, aucun code ne doit être écrit.**

---

## ⏱️ Règle de Sauvegarde Continue

> **TOUT travail en cours DOIT être commité sur GitHub toutes les 10 minutes maximum.**

- Cela inclut : code, documentation, analyses, fichiers de configuration, apps front-end
- Objectif : **zéro perte de travail** — on peut toujours reprendre là où on s'est arrêté
- Un trigger automatique est en place pour garantir cette règle
- Format du commit WIP : `wip: auto-save progress – [description]`
- Voir [`docs/AGENTS_PROTOCOL.md`](./docs/AGENTS_PROTOCOL.md) pour les détails complets

---

*Ce fichier redirige vers [`docs/AGENTS_PROTOCOL.md`](./docs/AGENTS_PROTOCOL.md) qui est la source de vérité pour la gouvernance.*
