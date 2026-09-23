# Doctrine — Promesse de délai de livraison

> **Version** : 0.1 — 2026-09-23
> **Statut** : doctrine proposée, prolongement de `DOCTRINE_TRANSPORT_RAILS.md`
> **Feature propriétaire** : `logistics` (autorité sur le rail, donc sur sa durée)
> **Features consommatrices** : `catalog` / boutique (affichage), `orders` (snapshot), `notifications` (projection), `dashboard` (mesure)
> **Débloque** : « Commandes dans les temps (%) » du mock Commandes

---

## 1. Phrase de vérité

Une promesse de délai est une fourchette composée à partir de durées réellement observées, figée au moment de la commande et mesurée à l'arrivée. Sans donnée, on ne promet rien.

## 2. Constat dans le code (2026-09-23)

- Briques existantes : `suppliers.lead_time_days` (défaut 2), `partners.lead_time_days`, registre `services/transport-rails.js` (rails `SEA_STANDARD`, `AIR_EXPRESS`).
- Le registre des rails **ne porte aucune durée**.
- Aucun délai cible par marché, aucune promesse persistée sur la commande.
- `DOCTRINE_TRANSPORT_RAILS.md` impose déjà : **« Les délais sont propres au corridor. Aucun délai générique “livraison” ne doit être codé comme vérité universelle »** (invariant 8), et réserve à `notifications` la projection de la promesse.

## 3. Composition

```txt
délai promis = préparation / achat fournisseur
             + transit du rail sur le corridor
             + dédouanement du corridor
             + mise à disposition au relais
```

Chaque composante est **une fourchette observée** (par exemple un bas et un haut calibrés sur des livraisons réelles), pas une moyenne affichée comme certitude.

## 4. Invariants

1. **Pas de délai universel.** Toute durée est rattachée à un rail et un corridor (conforme à Transport Rails).
2. **UNKNOWN ⇒ pas de promesse.** Si une composante est inconnue, la boutique n'affiche aucun délai plutôt qu'un délai par défaut.
3. **Snapshot à la commande.** La promesse affichée au client est figée sur la commande, comme le coût (`order-cost-snapshot.js`). Elle n'est jamais recalculée rétroactivement.
4. **Mesurée à l'arrivée.** L'écart promesse / réalité (`available_at`, `collected_at`) est calculable pour chaque commande ; c'est ce qui rend « dans les temps » mesurable.
5. **Calibration par l'observé.** Les fourchettes se recalibrent à partir des durées réelles (`parcel_events`, `scan_events`), jamais au jugé.
6. **Le frontend ne calcule pas.** Il affiche la fourchette fournie par le backend.

## 5. Hors périmètre / interdits

- Une date exacte de livraison en V1.
- Un délai affiché pour `AIR_EXPRESS` tant que son `pricing_status` n'est pas `ACTIVE` (invariant 3 de Transport Rails).
- Modifier la promesse d'une commande existante quand les fourchettes changent.

## 6. Gates à prouver avant exposition

- Durées observées suffisantes par corridor (seuil minimal d'échantillon à définir) avant tout affichage.
- Preuve en base réelle : snapshot à la commande, mesure de l'écart, absence de promesse si composante inconnue.

## 7. Première tranche

Ajouter des fourchettes de durée par rail et corridor dans l'autorité `logistics`, puis un calcul serveur de promesse retournant une fourchette ou `UNKNOWN`. Pas encore d'affichage client ni de snapshot : d'abord prouver le calcul.
