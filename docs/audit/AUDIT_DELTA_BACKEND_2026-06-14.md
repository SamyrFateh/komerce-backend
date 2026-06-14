# Audit delta backend Komerce — 2026-06-14

> Scope : audit statique depuis le repo GitHub.  
> Baseline : `docs/backend/BACKEND_AUDIT.md` du 2026-05-16 + `docs/backend/BACKEND_AUDIT_SESSIONS_PLAN.md`.  
> Limite : pas d'exécution locale, pas d'accès DB Railway, pas de logs runtime, pas de test automatisé lancé depuis cet audit.

---

## 1. Verdict court

Le delta est **positif mais incomplet**.

Les progrès les plus nets portent sur :

- gouvernance documentaire ;
- clarification Boutique First ;
- suppression ou clarification de plusieurs dettes d'hygiène ;
- webhook Stripe audité ;
- cash pickup corrigé côté service et route ;
- panier partagé réaligné sur `ready_to_pay` / `needs_validation`.

Les zones encore faibles restent :

- couverture de tests ;
- observabilité structurée partout ;
- flows post-commit fire-and-forget ;
- migrations SQL historiques non normalisées ;
- anciens flows collectifs legacy à ne plus traiter comme produit actif ;
- audit G4 annulation/refund non retrouvé.

Verdict go-live : **GO conditionnel**, pas NO-GO documentaire. Les conditions sont les tests runtime des flows argent et le traitement ou l'acceptation explicite des dettes restantes.

---

## 2. Delta par rapport à l'audit du 2026-05-16

### 2.1 Gouvernance documentaire

**Avant** : gouvernance riche mais incohérente, `.cursorrules`, `AGENTS.md`, vieux audits et docs Boutique pouvaient diverger.

**Maintenant** : fortement amélioré.

Documents actifs créés/réalignés :

- `docs/README.md` — index documentaire actif ;
- `AGENTS.md` — règles agent/dev simplifiées ;
- `docs/chantier/STATUS.md` — état court courant ;
- `docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md` ;
- `docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md` ;
- `docs/boutique/README.md` ;
- docs Boutique CSS/ownership/modal réalignées.

**Delta** : 🟢 fort progrès. Le risque de travailler depuis un ancien prompt ou un ancien audit est fortement réduit.

**Reste** : vérifier si `.cursorrules` existe encore et s'il contredit `AGENTS.md`.

---

### 2.2 Doublons fantômes

#### `routes/orders/order-api-v2.js`

Baseline : fantôme identifié dans l'audit initial.

État repo : `routes/orders/order-api-v2.js` introuvable, `routes/order-api-v2.js` existe encore.

**Delta** : 🟢 clos.

#### `test_groupe_paiement.js`

Baseline : script orphelin à la racine.

État repo : racine introuvable ; script déplacé vers `tests/integration/groupe-paiement.manual.js`.

**Delta** : 🟢 clos.

#### `routes/parcels.js` vs `routes/orders/parcels.js`

Baseline : doublon à clarifier.

État repo : les deux fichiers existent encore, avec rôles manifestement différents :

- `routes/parcels.js` : API colis CRUD / sécurité logistique ;
- `routes/orders/parcels.js` : expédition partielle et colis rattachés à une commande.

**Delta** : 🟡 amélioré conceptuellement si les deux sont bien montés pour des usages distincts, mais pas clos sans vérification des routes montées.

**Action recommandée** : documenter explicitement cette distinction dans `CARTOGRAPHY_360.md` ou ajouter un garde-fou backend qui signale seulement les doublons réellement fantômes.

---

### 2.3 Migrations

Baseline : deux dossiers SQL et collisions 060/061.

État repo : dette documentée dans :

- `docs/chantier/MIGRATIONS_FOLDERS_A5.md` ;
- `docs/chantier/AUDIT_MIGRATIONS_060_061.md`.

Constat établi : le runner actif `scripts/migrate.js` ne parcourt pas automatiquement les fichiers `.sql`; les collisions sont donc une dette future, pas un bloquant de boot.

**Delta** : 🟡 dette clarifiée, non supprimée.

**Action recommandée** : lot futur `MIGRATIONS-RUNNER-1` : inventaire DB live, table `schema_migrations`, convention unique, garde-fou CI anti-collision.

---

### 2.4 Webhooks Stripe / paiement Stripe

Baseline : à auditer en priorité absolue D2/G2.

État repo :

- `docs/chantier/STRIPE_WEBHOOK_AUDIT_D2.md` existe ;
- `docs/chantier/FLOW_AUDIT_STRIPE_G2.md` existe.

Garanties constatées dans les audits :

- raw body monté avant `express.json` ;
- signatures Stripe vérifiées ;
- idempotence via `stripe_events_processed` ;
- `confirmPaymentCycle(...)` utilisé sur paiement commande classique ;
- transactions et guards anti-double paiement présents.

**Delta** : 🟢 D2/G2 audités et globalement solides.

**Restes importants** :

- idempotency key manquante ou à confirmer lors de création PaymentIntent commande classique ;
- post-commit `triggerPurchasing` fire-and-forget ;
- besoin de tests replay webhook et signature invalide ;
- si `stripe_events_processed` indisponible, idempotence dégradée.

---

### 2.5 Cash relais / pickup-secret

Baseline G1 : violation critique sur `/pay-cash`, qui modifiait directement `orders.status` et `payment_status` sans passer par `confirmPaymentCycle`.

État repo :

- service `services/confirm-pickup-cash-payment.js` présent ;
- `routes/pickup-secret.js` importe `confirmPickupCashPayment` ;
- le handler `/pay-cash/:orderId` délègue à ce service ;
- le service passe par `confirmPaymentCycle(...)` et donc par la machine de statut.

**Delta** : 🟢 très fort progrès. La violation I-01/I-02 du chemin pickup cash semble corrigée dans le code.

**Reste** : tests runtime à faire : nominal, replay, stock insuffisant, cross-relais, reçu one-shot.

---

### 2.6 Panier partagé / Boutique First

Baseline : ancien modèle V4.1 / collectif / settlement.

État repo :

- doctrine Boutique First ajoutée ;
- guide d'implémentation ajouté ;
- `share_mode = ready_to_pay | needs_validation` présent côté backend ;
- `ready_to_pay` crée le panier en `closed` avec `payment_window_ends_at` dans la même transaction ;
- le paiement public reste interdit si le statut n'est pas `closed` ;
- le retour Stripe partagé revient dans `/boutique/?p=TOKEN&shared_payment=...`.

**Delta** : 🟢 très bon réalignement produit / technique.

**Reste** : quelques messages backend peuvent encore parler en vocabulaire ancien si l'erreur remonte brute à l'UI : `entièrement financé`, `En attente de décision du créateur`, `contribution`. C'est moins grave côté API, mais à neutraliser côté UI ou remplacer dans la route.

---

### 2.7 Collectif legacy / workspace

Baseline : G3 audite le panier collectif / workspace comme flow actif.

État repo documentaire récent : Boutique First dit que `collective workspace`, `cagnotte`, `event` et financement collectif sont historiques/subordonnés.

**Delta** : 🟡 changement de stratégie majeur. G3 reste utile pour comprendre les risques argent legacy, mais ne doit plus piloter le produit actif.

**Reste** : vérifier que toutes les surfaces legacy sont tombstone/no-op ou redirigées, et qu'aucune nouvelle UX ne dépend de `collective-workspaces`.

---

### 2.8 Annulation / refund G4

Le plan prévoit `AUDIT-G4 — Annulation + refund`.

État repo : aucun livrable `FLOW_AUDIT_REFUND_G4.md` retrouvé dans cette passe.

**Delta** : 🔴 non couvert dans les documents retrouvés.

**Action recommandée** : prochain audit prioritaire, car annulation/refund touche argent + stock + wallet + Stripe.

---

### 2.9 Tests

Baseline : couverture très faible, 2,2 %, seulement quelques tests unitaires.

État repo : présence de tests supplémentaires autour du panier partagé V4.1 (`shared-cart-v41-transitions.test.js`) et script manuel déplacé.

**Delta** : 🟡 amélioration ponctuelle, mais pas transformation.

**Reste** : manquent toujours des tests automatiques robustes pour :

- replay webhook Stripe ;
- signature Stripe invalide ;
- pickup cash nominal/replay/stock/cross-relais ;
- shared-cart `ready_to_pay` / `needs_validation` ;
- annulation/refund ;
- post-commit purchasing repair.

---

### 2.10 Observabilité

Baseline : `console.log` nombreux, logger structuré pas généralisé.

État repo : des zones critiques vues utilisent désormais `utils/logger` (`pickup-secret`, service pickup cash), mais plusieurs audits signalent encore du fire-and-forget et des logs à structurer.

**Delta** : 🟡 amélioration locale, dette générale probable.

**Action recommandée** : lot F dédié : corriger les logs critiques par flux plutôt que chercher un refacto global.

---

## 3. Plan recommandé après delta

### P0 — avant go-live réel

1. Exécuter tests manuels Boutique First Cas A à E.
2. Tester `/pay-cash` pickup-secret : nominal, replay, stock insuffisant, cross-relais.
3. Tester Stripe webhook replay + signature invalide.
4. Auditer G4 annulation/refund.
5. Vérifier qu'aucune surface legacy collective n'est accessible comme produit actif.

### P1 — stabilisation courte

1. Ajouter tests automatisés sur les chemins P0.
2. Remplacer les messages API shared-cart hérités qui peuvent fuiter à l'UI.
3. Ajouter repair job ou audit ops pour commandes payées/ordered sans purchasing.
4. Documenter distinctement `routes/parcels.js` vs `routes/orders/parcels.js`.

### P2 — dette maîtrisée

1. Normaliser stratégie migrations SQL.
2. Réduire progressivement les god-files.
3. Généraliser logger structuré.
4. Reprendre couverture tests par service critique.

---

## 4. Synthèse delta par bloc

| Bloc | Baseline 2026-05-16 | Delta 2026-06-14 | État |
|---|---|---|---|
| Gouvernance | incohérente | index actif + docs Boutique First | 🟢 amélioré |
| Doublons | order-api-v2 fantôme, parcels ambigu | order-api-v2 clos, parcels à documenter | 🟡 partiel |
| Migrations | collisions + double dossier | dette clarifiée, non bloquante boot | 🟡 clarifié |
| Stripe D2/G2 | à auditer | audits faits, socle solide | 🟢 bon |
| Cash G1 | violation `/pay-cash` | service + route corrigés | 🟢 fort progrès |
| Collectif G3 | flow actif audité | devenu legacy/subordonné | 🟡 à surveiller |
| Refund G4 | prévu | non retrouvé | 🔴 à faire |
| Tests | très faible | quelques tests ajoutés | 🟠 encore faible |
| Observabilité | insuffisante | progrès local | 🟠 encore faible |

---

## 5. Conclusion

Le projet a clairement avancé depuis l'audit initial : les problèmes les plus dangereux de gouvernance et certains chemins argent ont été corrigés ou cadrés. Le risque principal n'est plus le désordre documentaire ; il est maintenant dans les tests runtime et les flows argent non encore couverts.

La bonne prochaine passe n'est pas un nouvel audit général. C'est un audit ciblé :

```txt
G4 Annulation + refund
+ tests pickup cash
+ tests Stripe replay/signature
+ tests Boutique First shared-cart
```
