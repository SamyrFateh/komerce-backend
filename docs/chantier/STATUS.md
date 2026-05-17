# Komerce Backend — État du chantier
> Mis à jour : 2026-05-17
> Repo : `SamyrFateh/komerce-backend` — branche de référence : `main`
> **Ce fichier est la PREMIÈRE et SEULE chose à ouvrir au début de chaque session.**

---

## 🏛️ RÉFÉRENTIELS ARCHITECTURAUX — PIERRE ANGULAIRE

Ces deux documents sont **figés comme source de vérité absolue**. Tout agent doit les lire avant de toucher quoi que ce soit. En cas de conflit entre un autre document et ces deux-là, **ces deux-là font foi**.

| # | Fichier | Ce qu'il contient | Statut |
|---|---------|------------------|--------|
| **ARCHI-1** | `docs/CARTOGRAPHY_360.md` | Cartographie canonique du 15 mai 2026 mise à jour : routes, services, invariants, REQUIRED_ENV réel, `services/order-payment-confirmation.js` comme point d'entrée paiement→stock | ✅ Mis à jour 2026-05-17 |
| **ARCHI-2** | `docs/ZONE_IMPACT.md` | 10 invariants absolus + checklist avant modification + dette connue + sources de paiement complètes (collective_payment inclus) | ✅ Mis à jour 2026-05-17 |

**Les 10 invariants de ZONE_IMPACT à avoir en tête en permanence :**

| ID | Invariant | Source de vérité |
|----|-----------|-----------------|
| I-01 | Ne jamais modifier `orders.status` hors machine de statut | `services/order-status-machine.js` |
| I-02 | Paiements Stripe/cash/wallet/shared cart/collectif → uniquement `pending → confirmed` | `transitionOrderStatus()` |
| I-03 | Transitions scan/système : forward-only + idempotentes | `isForwardTransition()` |
| I-04 | Toute transition → trace dans `order_status_history` | `transitionOrderStatus()` |
| I-05 | Wallet : pas de suppression — créditer, débiter, contre-passer | `services/wallet-service.js` |
| I-06 | Annulation → restaurer stock ET wallet appliqué | `transitionOrderStatus()` |
| I-07 | Webhooks Stripe : body brut avant `express.json` | `server.js` |
| I-08 | Pricing : lire les composantes DB, jamais de coefficient dur | `services/pricing-engine.js` |
| I-09 | Colis = unité autonome, ne pas refaire dépendre du flux commande entière | routes colis/scans/hub |
| I-10 | Codes retrait et preuves de collecte = éléments de confiance, pas de simples champs UI | `pickup`, `scans`, `parcel-security` |

---

## 📖 LIRE EN PREMIER — base de connaissance du chantier

Lire dans cet ordre après les deux référentiels ci-dessus.

| # | Fichier | Ce qu'il contient | Annule / corrige |
|---|---------|------------------|-----------------|
| 1 | `docs/BACKEND_AUDIT.md` | Audit initial — photo du repo au 2026-05-16 | — |
| 2 | `docs/BACKEND_AUDIT_CORRECTIONS.md` | **Corrections post-lecture code** — chiffres réels, faux positifs, nouveaux risques | Corrige BACKEND_AUDIT.md sur : console.log (112→**365**), doublon parcels (**faux positif**), collisions migrations (**risque minoré**), webhook Stripe (**déjà blindé**) |
| 3 | `docs/BACKEND_GOLIVE_ROADMAP.md` | Les 50 lots détaillés avec actions, prérequis, critères | — |
| 4 | `docs/BACKEND_AUDIT_SESSIONS_PLAN.md` | Les 9 sessions d'audit approfondies avec prompts prêts à coller | — |

**Règle** : si une information de BACKEND_AUDIT.md contredit BACKEND_AUDIT_CORRECTIONS.md, c'est **CORRECTIONS qui fait foi** — c'est la lecture directe du code source.

**5 pièges critiques à retenir avant de commencer :**
- `console.log` : **365** dans le repo (pas 112) → lot F1 est ~3× plus gros que prévu
- `routes/parcels.js` vs `routes/orders/parcels.js` : **deux fichiers distincts**, ne pas toucher
- Collisions migrations 060/061 : **risque minoré** — le runner ne lit pas les fichiers `.sql` directement
- Webhook Stripe : **déjà blindé** sur 3 endpoints — audit D2 = validation, pas découverte
- `routes/orders/order-api-v2.js` : **fantôme confirmé** — jamais chargé, `git rm` sans risque

---

## 🎯 PROCHAIN LOT À EXÉCUTER

**INIT-0 — Lire les 6 documents dans l'ordre (référentiels + base de connaissance)**

```
Branche   : aucune — pas de code, pas de commit
Charge    : 45 min
Prérequis : aucun ✅
```

Lire dans l'ordre :
1. `docs/CARTOGRAPHY_360.md` ← référentiel architectural
2. `docs/ZONE_IMPACT.md` ← référentiel invariants métier
3. `docs/BACKEND_AUDIT.md`
4. `docs/BACKEND_AUDIT_CORRECTIONS.md` ← **fait foi sur tout ce qui contredit AUDIT.md**
5. `docs/BACKEND_GOLIVE_ROADMAP.md`
6. `docs/BACKEND_AUDIT_SESSIONS_PLAN.md`

Une fois lu : passer à DOC-0, puis D0.

---

### Après INIT-0 — lot de synchronisation documentaire

**DOC-0 — Mettre à jour CARTOGRAPHY_360.md et ZONE_IMPACT.md (déjà faits, à commiter)**

```
Branche   : docs/backend-DOC0-freeze-arch-referentials
Charge    : 15 min (fichiers corrigés prêts, juste commiter)
Prérequis : INIT-0 ✅
```

Les deux fichiers ont été corrigés le 2026-05-17 sur les divergences suivantes :

**CARTOGRAPHY_360.md** — 3 corrections :
- §5 REQUIRED_ENV : ajout de 5 variables obligatoires (STRIPE_WEBHOOK_SECRET ×3, QR_SECRET, démo de STRIPE_SECRET_KEY promu)
- §2 Sources de vérité : ajout de `services/order-payment-confirmation.js` (point d'entrée paiement→stock)
- §6 Machine commande : ajout de `collective_payment` dans les sources de transition

**ZONE_IMPACT.md** — 3 corrections :
- §2 I-02 : ajout de `collectif` dans les sources de paiement reconnues
- §3 Fichiers à risque : ajout de `services/order-payment-confirmation.js`
- §4 Sources de paiement : ajout de `collective_payment`
- §11 Dette connue : ajout pickup rate-limit in-memory (lignes 336 et 1110)

**Template PR :**
```
Branche : docs/backend-DOC0-freeze-arch-referentials
Titre   : docs(backend): figer les référentiels architecturaux (DOC-0)

## Quoi
- CARTOGRAPHY_360.md mis à jour : REQUIRED_ENV complet, order-payment-confirmation.js, collective_payment
- ZONE_IMPACT.md mis à jour : I-02 étendu, fichiers à risque complétés, dette pickup rate-limit documentée

## Pourquoi
Ces deux fichiers sont la pierre angulaire du chantier.
Tout agent qui démarre une session les lit en premier.
Des divergences entre la réalité du code et ces docs auraient créé des erreurs de diagnostic.

## ZONE_IMPACT
- docs uniquement — zéro code modifié

## Tests effectués
- relecture croisée avec BACKEND_AUDIT_CORRECTIONS.md — aucune nouvelle divergence

## Coche associée
docs/chantier/STATUS.md — DOC-0 → ✅
```

---

### Après DOC-0 — premier lot de code

**D0 — Durcir REQUIRED_ENV + supprimer le fallback QR_SECRET**

```
Branche   : fix/backend-D0-required-env-hardening
Charge    : 30 min
Prérequis : INIT-0 ✅, DOC-0 ✅
```

**Deux fichiers à modifier :**

`server.js` — remplacer REQUIRED_ENV et RECOMMENDED_ENV :
```diff
- const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
- const RECOMMENDED_ENV = ['ADMIN_PASSWORD', 'STRIPE_SECRET_KEY'];
+ const REQUIRED_ENV = [
+   'DATABASE_URL',
+   'JWT_SECRET',
+   'STRIPE_SECRET_KEY',
+   'STRIPE_WEBHOOK_SECRET',
+   'STRIPE_SHARED_CART_WEBHOOK_SECRET',
+   'STRIPE_COLLECTIVE_WEBHOOK_SECRET',
+   'QR_SECRET',
+ ];
+ const RECOMMENDED_ENV = ['ADMIN_PASSWORD', 'META_WA_APP_SECRET'];
```

`routes/orders/qr.js` ligne ~50 — supprimer le fallback :
```diff
- const secret = process.env.QR_SECRET || 'komerce-qr-default-secret-change-in-prod';
+ // QR_SECRET est obligatoire (REQUIRED_ENV dans server.js) — pas de fallback.
+ const secret = process.env.QR_SECRET;
```

**Template PR :**
```
Branche : fix/backend-D0-required-env-hardening
Titre   : fix(backend): durcir REQUIRED_ENV et supprimer fallback QR_SECRET (D0)

## Quoi
- STRIPE_SECRET_KEY promu de RECOMMENDED_ENV vers REQUIRED_ENV
- STRIPE_WEBHOOK_SECRET, STRIPE_SHARED_CART_WEBHOOK_SECRET,
  STRIPE_COLLECTIVE_WEBHOOK_SECRET ajoutés en REQUIRED_ENV
- QR_SECRET ajouté en REQUIRED_ENV
- Fallback en dur supprimé dans routes/orders/qr.js

## Pourquoi
QR_SECRET avait un fallback 'komerce-qr-default-secret-change-in-prod' —
QR de retrait forgeable si variable non configurée en Railway.
STRIPE_SECRET_KEY en RECOMMENDED permettait au serveur de démarrer sans Stripe.

## ZONE_IMPACT
- server.js : crash au démarrage si variables absentes (comportement voulu)
- routes/orders/qr.js : suppression fallback — QR_SECRET obligatoire en Railway
- I-07 respecté : aucune modification de l'ordre middleware webhook

## Tests effectués
- npm test passe
- Variables configurées sur Railway avant merge (voir §6 de BACKEND_AUDIT_CORRECTIONS.md)

## Coche associée
docs/chantier/STATUS.md — D0 → ✅
docs/BACKEND_GOLIVE_ROADMAP.md — D0 → ✅
```

---

## ✅ FAIT (mergé sur main)

*— rien. Le repo est dans son état d'origine.*

---

## 📋 IDENTIFIÉ (analysé, correction connue, pas encore commité)

Ces points ont été établis par lecture directe du code source. Pas encore dans le repo.

| Réf | Description | Correction connue | Source |
|-----|------------|-------------------|--------|
| A7 | 9 docs parasites identifiés + `AGENTS.md` à corriger | Liste complète dans §A7 de BACKEND_GOLIVE_ROADMAP.md | Session 2026-05-17 |
| DOC-0 | CARTOGRAPHY_360 et ZONE_IMPACT à commiter (corrections faites) | PR prête dans § ci-dessus | Session 2026-05-17 |
| D0 | REQUIRED_ENV trop laxiste + fallback QR_SECRET en dur | Diff prêt dans § ci-dessus | BACKEND_AUDIT_CORRECTIONS.md §3 |
| A1 | Fichier fantôme `routes/orders/order-api-v2.js` jamais chargé | `git rm routes/orders/order-api-v2.js` | BACKEND_AUDIT_CORRECTIONS.md §4.3 |
| A2 | Doublon `parcels.js` — **faux positif** | Rien à faire — deux fichiers distincts | BACKEND_AUDIT_CORRECTIONS.md §1.2 |
| D2 | Webhook Stripe — **déjà blindé** | Rien à corriger — signature + idempotence OK sur 3 endpoints | BACKEND_AUDIT_CORRECTIONS.md §2.1 |
| F1 | 365 `console.log` (pas 112) | Lot F1 est ~3× plus gros que prévu | BACKEND_AUDIT_CORRECTIONS.md §1.1 |

---

## ⏳ FILE D'ATTENTE — tous les 50 lots

> Ordre recommandé. Ne jamais sauter un prérequis non coché ✅.

### Phase 0 — Lecture + gel documentaire (avant tout commit de code)
| Lot | Description | Prérequis | Charge | Statut |
|-----|------------|-----------|--------|--------|
| **INIT-0** | Lire les 6 documents dans l'ordre du tableau § LIRE EN PREMIER. CARTOGRAPHY_360 et ZONE_IMPACT en premier. Aucun code modifié. | aucun | 45 min | ☐ **← COMMENCER ICI** |
| **DOC-0** | Commiter CARTOGRAPHY_360.md + ZONE_IMPACT.md corrigés | INIT-0 ✅ | 15 min | ☐ |

### Phase 1 — Hygiène
| Lot | Description | Prérequis | Charge | Statut |
|-----|------------|-----------|--------|--------|
| **D0** | Durcir REQUIRED_ENV + fallback QR_SECRET | DOC-0 ✅ | 30 min | ☐ |
| **A7** | Archiver 9 docs parasites → `docs/_archive/` + corriger `AGENTS.md` | DOC-0 ✅ | 20 min | ☐ |
| A1 | Supprimer fantôme `routes/orders/order-api-v2.js` | aucun | 15 min | ☐ |
| A3 | Déplacer `test_groupe_paiement.js` dans `tests/` | aucun | 15 min | ☐ |
| A6 | Nettoyer les TODO en issues GitHub | aucun | 30 min | ☐ |
| A4 | Résoudre collisions migrations 060/061 | aucun | 1 h ⚠️ | ☐ |
| A5 | Documenter / archiver `db/migrations/` | aucun | 45 min | ☐ |

### Phase 2 — Sécurité (bloquant go-live)
| Lot | Description | Prérequis | Charge | Statut |
|-----|------------|-----------|--------|--------|
| D1 | Audit routes admin (authenticate + requireAdmin) | aucun | 1 j | ☐ |
| D3 | Audit `auth-guest.js` | aucun | 1 j | ☐ |
| D4 | Audit tokens QR / pickup-secret | aucun | 1 j | ☐ |
| D5 | Audit secrets (.env.example vs prod) | aucun | ½ j | ☐ |
| D6 | Rate limiting — couverture exhaustive | aucun | ½ j | ☐ |
| D7 | CORS — restriction des origines | aucun | ½ j | ☐ |
| D8 | Helmet — config production | aucun | ½ j | ☐ |

### Phase 3 — Observabilité (bloquant go-live)
| Lot | Description | Prérequis | Charge | Statut |
|-----|------------|-----------|--------|--------|
| F1 | Remplacer 365 `console.log` par logger structuré | aucun | 1 j | ☐ |
| F2 | Health check enrichi `/api/health` | aucun | ½ j | ☐ |
| F5 | Plan de rollback documenté et testé | aucun | 1 j | ☐ |
| F6 | Backup DB automatique vérifié | aucun | ½ j | ☐ |
| F7 | Request IDs propagés dans les logs | aucun | ½ j | ☐ |
| F3 | Métriques business exposées | aucun | 1-2 j | ☐ |
| F4 | Alerting (webhook Stripe erreur, DB lente) | aucun | 1 j | ☐ |

### Phase 4 — Garde-fous & gouvernance
| Lot | Description | Prérequis | Charge | Statut |
|-----|------------|-----------|--------|--------|
| H1 | Réconcilier `.cursorrules` et `AGENTS.md` → pointer vers AGENT_CONFIG.md | aucun | ½ j | ☐ |
| H2 | Vérifier que CARTOGRAPHY_360 + ZONE_IMPACT sont à jour post-corrections | DOC-0 ✅ | ½ j | ☐ |
| **H3** | Déplacer `audit-backend-arch.js` → `scripts/` + vérifier exécution *(script déjà écrit, 464 lignes, 10 invariants)* | aucun | 30 min | ☐ |
| H4 | Créer `gen-backend-arch-live.js` → `docs/BACKEND_ARCHITECTURE_LIVE.md` | H3 ✅ | 1 j | ☐ |
| H5 | Brancher audit + gen en CI (`pretest`) | H3 ✅, H4 ✅ | ½ j | ☐ |

### Phase 5 — Architecture modulaire
| Lot | Description | Prérequis | Charge | Statut |
|-----|------------|-----------|--------|--------|
| B1 | Extraire `routes/sourcing-engine.js` → `services/sourcing/` | aucun | 1-2 j ⚠️ | ☐ |
| B2 | Extraire `routes/economic-engine.js` → `services/` | aucun | 1 j | ☐ |
| B6 | Extraire `pickup-secret` → `services/` | aucun | 1 j ⚠️ | ☐ |
| B4 | Découper `routes/admin.js` | aucun | 1-2 j | ☐ |
| B5 | Découper `routes/pricing.js` | aucun | 1 j | ☐ |
| B3 | Découper `routes/dashboard.js` (2 614 lignes) | aucun | 2-3 j | ☐ |

### Phase 6 — Sourcing consolidation
| Lot | Description | Prérequis | Charge | Statut |
|-----|------------|-----------|--------|--------|
| C1 | Inventorier les connecteurs fournisseurs | aucun | 1 j | ☐ |
| C4 | Audit du schéma sourcing en DB | aucun | 1 j | ☐ |
| C6 | Documentation moteur sourcing | aucun | 1 j | ☐ |
| C2 | Tests unitaires `sourcing/analyzer.js` | B1 ✅ | 1 j | ☐ |
| C3 | Tests unitaires `reader.js` et `enricher.js` | B1 ✅ | 1 j | ☐ |
| C5 | Normalisation doublons `cost_kmf` / `cost_price_kmf` | C4 ✅ | 2-3 j ⚠️ | ☐ |
| C7 | Garde-fou sourcing exécutable | C4 ✅, C6 ✅ | 1 j | ☐ |

### Phase 7 — Tests & couverture
| Lot | Description | Prérequis | Charge | Statut |
|-----|------------|-----------|--------|--------|
| E1 | Tests `services/pricing-engine.js` | aucun | 2-3 j | ☐ |
| E3 | Tests `collective-payment-orchestrator.js` | aucun | 2-3 j | ☐ |
| E2 | Tests `shared-cart-engine.js` | aucun | 2 j | ☐ |
| E4 | Tests intégration flows paiement | aucun | 3-4 j | ☐ |
| E5 | Mesure couverture (`jest --coverage`) | aucun | ½ j | ☐ |
| E6 | Tests flows sourcing | B1 ✅, C2 ✅, C3 ✅ | 1-2 j | ☐ |

### Phase 8 — Audit flows pré-go-live
| Lot | Description | Prérequis | Charge | Statut |
|-----|------------|-----------|--------|--------|
| G1 | Flow cash → retrait relais | phases 1-4 | 2 j | ☐ |
| G2 | Flow Stripe → préparation hub | phases 1-4 | 2 j | ☐ |
| G3 | Flow panier collectif → contributions | phases 1-4 | 2-3 j | ☐ |
| G4 | Flow annulation commande + refund | phases 1-4 | 1-2 j | ☐ |
| G5 | Flow sourcing → ajout produit | B1 ✅ | 2 j | ☐ |

### Sessions d'audit approfondies (BACKEND_AUDIT_SESSIONS_PLAN.md)
| Lot | Description | Note | Statut |
|-----|------------|------|--------|
| AUDIT-D2 | Webhook Stripe | Lecture code confirme déjà blindé — audit formel pour valider | ☐ |
| AUDIT-G3 | Flow paiement collectif | Zone bugogène (branches fix/collective-*) | ☐ |
| AUDIT-G2 | Flow paiement Stripe E2E | | ☐ |
| AUDIT-G1 | Flow cash → retrait relais | | ☐ |
| AUDIT-G4 | Annulation + refund | | ☐ |
| AUDIT-D1 | Routes admin auth coverage | Lecture code suggère 100% couvert — à confirmer | ☐ |
| AUDIT-D3 | Auth guest UUID | Zone instable (hotfixes répétés) | ☐ |
| AUDIT-D4 | Tokens QR / pickup secret | Mécanisme solide, rate-limit in-memory | ☐ |
| AUDIT-G5 | Flow sourcing → ajout produit | | ☐ |

---

## ⚠️ RISQUES CONNUS NON BLOQUANTS

| Risque | Fichier | Condition de bascule en bloquant |
|--------|---------|----------------------------------|
| Pickup rate-limit in-memory | `routes/pickup-secret.js` lignes 336 et 1110 | Si passage multi-instance Railway |
| `META_WA_APP_SECRET` fallback chaîne vide | `routes/meta-whatsapp.js` | Si WhatsApp activé en prod |

---

## 📋 RÈGLES NON-NÉGOCIABLES

1. **Un seul lot par session** — si tu découvres quelque chose hors scope, créer un nouveau lot dans la roadmap, ne pas étendre l'actuel.
2. **Mettre à jour STATUS.md dans le même commit** que le code (☐ → ✅ + pointer PROCHAIN LOT vers le suivant).
3. **NE JAMAIS modifier `services/order-status-machine.js`** sans approbation explicite humaine.
4. **NE JAMAIS modifier une migration déjà mergée** — toujours ajouter une nouvelle migration.
5. **NE JAMAIS désactiver une règle d'audit** pour faire passer un test — créer une allowlist justifiée.
6. **Lancer `npm test`** avant de pousser.
7. **Créer une branche dédiée** — ne jamais commiter directement sur `main`.
8. **Lots D\*/G\*/AUDIT-\* = audit sans patch** — produire uniquement des docs, zéro code modifié.
9. **Vérifier les 10 invariants de ZONE_IMPACT** avant toute modification d'un fichier à haut risque.
10. **En cas de conflit de doc** : CARTOGRAPHY_360 > ZONE_IMPACT > BACKEND_AUDIT_CORRECTIONS > BACKEND_AUDIT.

---

## 🚀 BOOTSTRAP — Démarrer une session

```
ÉTAPE 1 — Lire les référentiels (obligatoire)
  docs/CARTOGRAPHY_360.md  ← architecture canonique
  docs/ZONE_IMPACT.md      ← invariants + checklist

ÉTAPE 2 — Identifier le lot
  Chercher ☐ ← COMMENCER ICI / ← SUIVANT dans la file d'attente.
  Vérifier que les prérequis sont ✅.

ÉTAPE 3 — Lire la fiche complète du lot
  Ouvrir docs/BACKEND_GOLIVE_ROADMAP.md et lire la fiche du lot.

ÉTAPE 4 — Créer la branche
  git checkout main && git pull
  git checkout -b {type}/backend-{LOT}-{slug}

ÉTAPE 5 — Faire le travail
  Suivre les "Actions" de la fiche, étape par étape.
  Si divergence du scope → STOP. Créer un nouveau lot. Rester dans le scope.

ÉTAPE 6 — Mettre STATUS.md à jour
  Déplacer le lot de ☐ vers ✅ avec date et numéro de PR.
  Pointer PROCHAIN LOT vers le suivant.
  Inclure STATUS.md dans le même commit que le code.

ÉTAPE 7 — Ouvrir la PR
  Titre : {type}(backend): {résumé court} ({LOT})
  Body  :
    ## Quoi
    ## Pourquoi
    ## ZONE_IMPACT (répondre aux 10 invariants concernés)
    ## Tests effectués
    ## Coche associée dans STATUS.md et BACKEND_GOLIVE_ROADMAP.md
  Ne pas merger — attendre la validation humaine.
```

---

## 📁 Fichiers de référence

### Référentiels architecturaux (pierre angulaire — figés)
| Fichier | Utilité |
|---------|---------|
| `docs/CARTOGRAPHY_360.md` | Cartographie canonique — routes, services, ENV, machine d'états |
| `docs/ZONE_IMPACT.md` | 10 invariants absolus + checklist avant modification |
| `docs/AGENT_CONFIG.md` | Configuration agent — accès GitHub, procédure de reprise |

### Documentation du chantier
| Fichier | Utilité |
|---------|---------|
| `docs/chantier/STATUS.md` | Ce fichier — état du jour |
| `docs/BACKEND_GOLIVE_ROADMAP.md` | Les 50 lots détaillés avec actions et critères |
| `docs/BACKEND_AUDIT_SESSIONS_PLAN.md` | Les 9 sessions d'audit approfondies avec prompts |
| `docs/BACKEND_AUDIT_CORRECTIONS.md` | Corrections post-lecture code — fait foi sur les chiffres réels |
| `docs/BACKEND_AUDIT.md` | Audit initial — photo du repo au 2026-05-16 |

### Garde-fous (chantier)
| Fichier | Utilité |
|---------|---------|
| `docs/chantier/garde-fous/audit-backend-arch.js` | Garde-fou architectural exécutable (lot H3) |
| `docs/chantier/audits/` | Livrables markdown des sessions d'audit |

---

*Mis à jour le 2026-05-17 — référentiels architecturaux figés. Repo main intact, aucun commit chantier.*
*Prochain commit attendu : docs/backend-DOC0-freeze-arch-referentials*
