# ⚠️ RÈGLES OBLIGATOIRES POUR TOUT AGENT IA

> Ce fichier doit être lu par **tout agent IA** (Tasklet, Cursor, Copilot, Claude, GPT, etc.) avant de toucher au code de ce projet.

---

## RÈGLE N°1 — Lire la cartographie avant tout code

**Avant toute implémentation, modification ou ajout de fonctionnalité :**

1. Lire en entier le fichier `docs/CARTOGRAPHY_360.md`
2. Ce fichier contient la **vue 360° du projet** :
   - 111 endpoints répartis sur 18 fichiers de routes
   - 27 tables DB avec leurs relations et criticités
   - 4 middlewares (`authenticate`, `requireRole`, `requireAdmin`, `validate`)
   - 6 rate limiters configurés
   - 9 services externes intégrés
   - 5 chaînes d'appels inter-routes critiques

**Sans cette lecture, aucun code ne doit être écrit.**

---

## RÈGLE N°2 — Mettre à jour la cartographie après chaque implémentation

Si la feature ajoute ou modifie des routes, tables, middlewares ou services :

1. Mettre à jour `docs/CARTOGRAPHY_360.md` avec les nouveaux éléments
2. Ajouter une entrée dans le changelog en bas du fichier :
   ```
   - [DATE] [FEATURE] : description des changements
   ```
3. Pousser la cartographie mise à jour sur GitHub dans le même commit ou un commit séparé

---

## RÈGLE N°3 — Respecter l'architecture existante

- **Backend** : Node.js / Express.js — fichiers dans `routes/`
- **Frontend** : HTML/JS vanilla — fichiers dans `public/`
- **Auth** : JWT via cookie httpOnly — toujours utiliser les middlewares existants
- **DB** : Supabase PostgreSQL — ne jamais modifier le schéma sans vérifier les dépendances dans la carto
- **Style de code** : respecter le pattern existant dans chaque fichier avant de modifier

---

## RÈGLE N°4 — Rapport après implémentation

Après chaque feature, produire un rapport avec :
- ✅ Cartographie lue (confirmer)
- 📁 Fichiers modifiés
- 🗄️ Tables/colonnes DB impactées
- 🔗 Nouvelles routes ajoutées
- 📝 Cartographie mise à jour (oui/non)
- ⚠️ Points d'attention ou risques

---

## RÈGLE N°5 — Documenter dans SESSION_STATUS.md et commiter régulièrement

**À chaque action significative (implémentation, migration, bugfix, décision) :**

1. Lire le fichier `docs/SESSION_STATUS.md` depuis GitHub (ou le créer s'il n'existe pas)
2. Ajouter une entrée horodatée avec :
   ```
   ### [DATE HEURE] — [TITRE ACTION]
   - **Statut** : ✅ Terminé / 🔄 En cours / ⚠️ Bloqué
   - **Fichiers modifiés** : liste
   - **DB impactée** : colonnes/tables ajoutées ou modifiées
   - **Commits** : SHA(s) du ou des commits
   - **Points en suspens** : ce qui reste à faire ou à vérifier
   - **Credentials/Accès nécessaires** : ce dont le prochain agent aura besoin
   ```
3. Commiter `docs/SESSION_STATUS.md` sur GitHub **après chaque action** — pas en fin de session
4. En début de session, lire `docs/SESSION_STATUS.md` pour reprendre exactement où on s'est arrêté

**Objectif** : zéro perte de contexte entre sessions, quel que soit l'agent.

---

## RÈGLE N°6 — Lire le README pour le contexte général

**À la fin de la lecture des règles, lire aussi `docs/README.md`** pour comprendre :
- La présentation générale du projet Komerce
- La stack technique utilisée
- Les commandes d'installation et de lancement
- Les liens vers les autres docs (architecture, déploiement, etc.)

Ce fichier donne le **contexte business et technique** nécessaire pour travailler efficacement.

---

## Ressources clés

| Fichier | Description |
|---|---|
| `docs/CARTOGRAPHY_360.md` | Vue 360° du projet — **SOURCE DE VÉRITÉ** |
| `docs/SESSION_STATUS.md` | Journal de session — **REPRENDRE ICI À CHAQUE SESSION** |
| `docs/README.md` | Présentation du projet, stack, installation — **CONTEXTE GÉNÉRAL** |
| `docs/ARCHITECTURE.md` | Architecture technique détaillée |
| `docs/DEPLOYMENT.md` | Guide de déploiement Railway |
| `routes/` | Tous les endpoints backend |
| `public/` | Tous les fichiers frontend |
| `middleware/auth.js` | Middlewares d'authentification |

---

*Ce fichier est maintenu par l'équipe Komerce. Toute modification doit être approuvée.*
