# Registre Canonique des Features — Application complète Komerce

> **Version** : 1.1 — 2026-06
> **Statut** : registre actif — gouverné par `docs/doctrine/FEATURE_DOCTRINE.md`
> **Construit à partir de** : headers `@komerce-arch` réels (`@domain`) du dépôt
> **backend**, croisés avec les fichiers réels des dépôts **bout** (boutique frontend)
> et **dash** (dashboards/hub/relais). Pas de feature inventée, pas de chemin supposé.
> **Vérifié par** : `node scripts/feature-registry-check.js`
>
> **Komerce n'est pas un monorepo.** Trois dépôts distincts composent l'application :
> `backend` (API + logique métier), `bout` (boutique client, dépôt séparé avec son
> propre `package.json`), `dash` (dashboards admin/hub/relais). Une feature métier
> traverse souvent les trois. Le champ `repos` de chaque manifest dit explicitement
> dans quel dépôt vit chaque groupe de fichiers — ne jamais supposer qu'un chemin
> backend (`services/`, `routes/`) et un chemin boutique (`js/`, `css/`) partagent une
> racine commune : ils n'en ont pas.

---

## Comment lire ce registre

Chaque ligne = une feature ou un domaine transversal (voir distinction dans
`FEATURE_DOCTRINE.md`). Le manifest associé contient le détail (périmètre exact,
interfaces, autorité, invariants). Ce registre est l'index — pas le détail.

| # | Feature | Type | Dépôts couverts | Manifest | Statut | Service rendu (résumé) |
|---:|---|---|---|---|---|---|
| 1 | `shared-cart` | feature | backend + boutique | [`shared-cart.feature.js`](../../features/shared-cart.feature.js) | production | Panier partagé multi-participants, de la création au règlement |
| 2 | `orders` | feature | backend | [`orders.feature.js`](../../features/orders.feature.js) | production | Commande : création, statut, coût, rattachement colis/achats |
| 3 | `payments` | feature | backend + boutique | [`payments.feature.js`](../../features/payments.feature.js) | production | Encaissement (Stripe, PayPal, cash) et confirmation de paiement |
| 4 | `wallet-loyalty` | feature | backend + boutique | [`wallet-loyalty.feature.js`](../../features/wallet-loyalty.feature.js) | production | Solde client (wallet) et programme de fidélité |
| 5 | `logistics` | feature | backend + boutique | [`logistics.feature.js`](../../features/logistics.feature.js) | production | Colis : scan, transit, tracking, relais, transporteurs |
| 6 | `economic-engine` | feature | backend | [`economic-engine.feature.js`](../../features/economic-engine.feature.js) | production | Pricing, coûts, marges, stratégies tarifaires |
| 7 | `catalog` | feature | backend + boutique | [`catalog.feature.js`](../../features/catalog.feature.js) | production | Produits, connecteurs fournisseurs, publication boutique |
| 8 | `customs` | feature | backend | [`customs.feature.js`](../../features/customs.feature.js) | production | Classification douanière, déclaration, analytics douane |
| 9 | `notifications` | feature | backend | [`notifications.feature.js`](../../features/notifications.feature.js) | production | Alertes et messages sortants (WhatsApp, notifications internes) |
| 10 | `documents` | feature | backend | [`documents.feature.js`](../../features/documents.feature.js) | production | Génération de documents (preuve retrait, facture douane, reçu) |
| 11 | `recommendations` | feature | backend | [`recommendations.feature.js`](../../features/recommendations.feature.js) | staging | Classement et suggestions boutique |
| 12 | `inventory` | feature | backend | [`inventory.feature.js`](../../features/inventory.feature.js) | staging | Suivi de stock |
| 13 | `refunds` | feature | backend | [`refunds.feature.js`](../../features/refunds.feature.js) | production | Remboursement transverse (wallet, cash, panier partagé) |
| 14 | `dashboard` | feature | backend + dash | [`dashboard.feature.js`](../../features/dashboard.feature.js) | production | Tableaux de bord et back-office (admin, hub, relais, finance) |
| 15 | `auth-identity` | transversal | backend | [`auth-identity.feature.js`](../../features/auth-identity.feature.js) | production | Authentification, OTP, identité vérifiée — consommé par toutes les features |
| 16 | `platform-ops` | transversal | backend | [`platform-ops.feature.js`](../../features/platform-ops.feature.js) | production | Santé applicative, config, modules — infrastructure d'exploitation |

---

## Les trois dépôts et leur gouvernance propre

| Dépôt | Contient | Gouvernance détaillée |
|---|---|---|
| `backend` | API, services métier, migrations | Ce registre + manifests `features/*.feature.js` |
| `bout` | Boutique client (HTML/CSS/JS) | `docs/BOUTIQUE_COMPONENT_OWNERSHIP.md` + `docs/BOUTIQUE_OWNERSHIP_LIVE.md` (auto-générée par `scripts/gen-ownership.js` **du dépôt bout**) — source de vérité pour le détail CSS/DOM, ce registre ne fait que pointer vers les fichiers, pas dupliquer leur contrat |
| `dash` | Dashboards admin, hub, relais | **Aucune doctrine d'ownership dédiée aujourd'hui** — dette explicite, voir section suivante |

Ce registre ne remplace pas le système d'ownership déjà en place côté boutique — il s'y
branche. Pour une feature qui a des fichiers boutique (`repos.boutique` dans le manifest),
le détail CSS/DOM précis (qui style quoi, qui écrit quel DOM) vit dans
`BOUTIQUE_OWNERSHIP_LIVE.md`, pas ici. Dupliquer cette information créerait deux sources
de vérité qui divergeraient à la première PR boutique non répercutée ici.

---

## Lecture rapide des interfaces inter-features

```
            ┌───────────────┐
            │ auth-identity │  (transversal — consommé par tout le reste)
            └───────┬───────┘
                     │
   ┌─────────────────┼──────────────────────────────────────┐
   ▼                 ▼                                      ▼
catalog ──► shared-cart ──► orders ──► payments      economic-engine
              │                │           │           (pricing pour
              │                │           ▼            catalog, orders,
              ▼                ▼       refunds          shared-cart)
        wallet-loyalty     logistics       │
              │                │           ▼
              └──────► refunds ◄───── documents (génère les preuves
                          │                       pour orders, refunds,
                          ▼                       customs)
                    notifications (émission, consommée par toutes)
                          │
                    customs (déclaration, consommée par logistics,
                              dashboard)
                          │
                    dashboard (lecture agrégée de toutes les features
                              ci-dessus — n'écrit jamais dans leur domaine)
```

Règle de lecture du schéma : une flèche `A ──► B` signifie *A consomme un service de B*,
jamais l'inverse. `dashboard` est en lecture seule sur tout le reste — voir son manifest
pour l'invariant explicite.

---

## Fichiers actuellement sans feature déclarée (dette connue)

`scripts/feature-registry-check.js --orphans` liste en continu les fichiers de
`services/`, `routes/`, `middleware/`, `utils/`, `validators/`, `core/` non couverts par
un manifest. Au moment de la rédaction de ce registre, les familles suivantes restent à
cartographier précisément (rattachées provisoirement par approximation de nommage, à
corriger au fil de l'eau plutôt qu'en bloquant ce registre) :

- fichiers historiques sans header `@komerce-arch` du tout (`@domain unknown`, 35 fichiers
  au moment de la rédaction) — chacun doit recevoir un header daté avant ou pendant son
  prochain changement, puis rejoindre le manifest de la feature correspondante ;
- sous-domaines `purchasing` / `sourcing` mentionnés dans les doctrines produit mais pas
  encore portés par un `@domain` dédié — actuellement répartis entre `orders` et
  `dashboard` (ex. `purchasing-admin-service.js`). À scinder en feature `purchasing`
  propre dès que son périmètre métier sera tranché ;
- **le dépôt `dash`** (dashboards admin, hub, relais) n'a aucune doctrine d'ownership
  équivalente à `BOUTIQUE_OWNERSHIP_LIVE.md` côté boutique. Le manifest `dashboard.feature.js`
  liste les fichiers connus (`dashboards/admin/*`, `hub/index.html`, `relais/index.html`,
  quelques modules JS partagés) mais sans le détail de qui écrit quel DOM ni de
  multipropriété CSS. Tant que cette doctrine n'existe pas, toute modification dans `dash`
  doit être traitée avec la même prudence qu'une zone non cartographiée — vérifier
  manuellement les usages avant de toucher un fichier partagé comme `js/auth-guard.js`.

Cette section n'est pas un satisfecit : c'est la liste de ce que le registre ne couvre
**pas encore**, à traiter explicitement plutôt qu'à laisser invisible.

---

## Règle de mise à jour

Toute feature nouvelle, fusionnée, scindée ou dépréciée met à jour ce tableau et son
manifest dans la même PR. `feature-registry-check.js --strict` échoue si un manifest
référence un fichier absent du disque — il ne détecte pas (encore) l'inverse de manière
automatique pour tous les répertoires ; la liste de dette ci-dessus reste donc à jour
manuellement jusqu'à ce que tous les `@domain unknown` soient résorbés.
