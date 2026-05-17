# Komerce Backend — État du chantier
> Mis à jour : 2026-05-17
> Repo : `SamyrFateh/komerce-backend` — branche de référence : `main`
> **Ce fichier est la PREMIÈRE chose à ouvrir au début de chaque session.**

---

## Point d'entrée obligatoire

Lire dans cet ordre avant toute modification :

1. `docs/chantier/STATUS.md` — état du jour et prochain lot réel
2. `docs/CARTOGRAPHY_360.md` — cartographie canonique
3. `docs/ZONE_IMPACT.md` — invariants absolus + checklist
4. `docs/BACKEND_AUDIT_CORRECTIONS.md` — corrections post-lecture code, fait foi contre l'audit initial
5. `docs/BACKEND_GOLIVE_ROADMAP.md` — détail complet des lots
6. `docs/BACKEND_AUDIT_SESSIONS_PLAN.md` — sessions d'audit approfondies

---

## Invariants à garder en tête

| ID | Invariant |
|----|-----------|
| I-01 | Ne jamais modifier `orders.status` hors machine de statut |
| I-02 | Paiements Stripe/cash/wallet/shared cart/collectif → uniquement `pending → confirmed` |
| I-03 | Transitions scan/système : forward-only + idempotentes |
| I-04 | Toute transition effective → trace dans `order_status_history` |
| I-05 | Wallet : pas de suppression — créditer, débiter, contre-passer |
| I-06 | Annulation → restaurer stock ET wallet appliqué |
| I-07 | Webhooks Stripe : body brut avant `express.json` |
| I-08 | Pricing : lire les composantes DB, jamais de coefficient dur |
| I-09 | Colis = unité opérationnelle autonome |
| I-10 | Codes retrait et preuves de collecte = éléments de confiance |

---

## État réel confirmé sur `main`

| Lot | État | Notes |
|-----|------|-------|
| INIT-0 | ✅ Fait | Référentiels lus en session |
| DOC-0 | ✅ Fait | `CARTOGRAPHY_360.md` et `ZONE_IMPACT.md` déjà à jour |
| A1 | ✅ Fait | Fichier fantôme `routes/orders/order-api-v2.js` supprimé |
| A3 | ✅ Fait | Script groupe paiement déplacé vers `tests/integration/groupe-paiement.manual.js` ; manuel, non Jest |
| A6 | ✅ Fait | Issue #387 créée ; TODO backend principaux rattachés au backlog central sans changement métier |
| D0 | ✅ Fait avec hotfix | Fallback QR supprimé ; démarrage Railway restauré via commande `npm start` non bloquante |
| D1 | ✅ Fait | Audit couverture auth admin documenté ; aucun oubli évident trouvé sur routes inspectées |
| A5 | ✅ Fait | `docs/chantier/MIGRATIONS_FOLDERS_A5.md` ajouté ; runner réel documenté |
| A7 | ✅ Fait | Docs parasites archivées dans `docs/_archive/` ; `AGENTS.md` corrigé |

---

## Pièges critiques à retenir

- `console.log` : environ 365 occurrences ; F1 est un gros lot, pas un petit nettoyage.
- `routes/parcels.js` et `routes/orders/parcels.js` sont deux fichiers distincts : ne pas supprimer comme doublon.
- Les collisions de migrations SQL ne bloquent pas le boot actuel : le runner actif ne parcourt pas automatiquement les fichiers SQL.
- Les webhooks Stripe sont déjà protégés par body brut + logique d'idempotence ; D2 est un audit formel.
- Toujours vérifier le scope d'un lot avant de modifier un fichier sensible.

---

## Prochain lot recommandé

### D3 — Audit `auth-guest.js`

```text
Branche   : audit/backend-D3-auth-guest
Charge    : 1 jour
Risque    : faible si audit/documentation, moyen si correction de middleware
Prérequis : aucun bloquant
```

Actions :

1. Lire `middleware/auth-guest.js` et les routes qui l'utilisent.
2. Vérifier création/réutilisation guest, cookies, expiration, collisions et sécurité.
3. Documenter les garanties et les risques restants.
4. Corriger uniquement les oublis évidents, sans refactor large.
5. Mettre à jour ce fichier et `docs/BACKEND_GOLIVE_ROADMAP.md` dans la même PR.

---

## File d'attente après D3

| Lot | Priorité | Note |
|-----|----------|------|
| A4 | Prudence | Collisions migrations 060/061 ; approbation humaine recommandée avant merge |
| D4 | Haute | Audit QR / pickup-secret |
| D5 | Haute | Audit `.env.example` vs prod |
| D6 | Moyenne | Rate limiting exhaustif |
| D7 | Moyenne | CORS production |
| D8 | Moyenne | Helmet production |
| F1 | Haute mais gros lot | Logger structuré à la place des `console.log` |
| H3 | Moyenne | Déplacer l'audit backend arch vers `scripts/` |

Pour la liste complète et les détails de chaque lot, utiliser `docs/BACKEND_GOLIVE_ROADMAP.md`.

---

## Règle de fin de session

Avant de terminer une session avec commit ou PR :

1. cocher ou annoter le lot traité ici ;
2. mettre à jour le prochain lot recommandé ;
3. vérifier que `AGENTS.md` continue de pointer vers ce fichier en premier.
