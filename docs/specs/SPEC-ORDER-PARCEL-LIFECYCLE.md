# SPEC — Cycle de vie commande & colis (Komerce)

> Version 1.3 — Avril 2026

---

## Principe fondamental

**Les deux cycles sont indépendants.**

| Entité | Cycle | Piloté par |
|--------|-------|-----------|
| `orders.status` | **Business** | Actions humaines / API métier |
| `parcels.status` | **Logistique** | Scans, agents, transitions physiques |

`orders.status` ne se déduit PAS automatiquement de `parcels.status`.  
`parcels.status` ne se déduit PAS automatiquement de `orders.status`.  
Seules les **Link Rules** définissent les franchissements autorisés.

---

## Cycle commande — `orders.status`

```
confirmed → ordered → preparation → shipped → in_transit → available → collected
                                                                      ↘ cancelled → refunded
```

| Statut | Signification business |
|--------|----------------------|
| `confirmed` | Commande créée / enregistrée dans le système |
| `ordered` | Paiement confirmé — commande lancée côté opérations |
| `preparation` | En cours de préparation physique au hub |
| `shipped` | Remise au transitaire à Dubaï — jalon physique clé |
| `in_transit` | Réellement en route vers le relais |
| `available` | Disponible au retrait au relais |
| `collected` | Retiré par le client — fin de cycle |
| `cancelled` | Annulée (avant ou pendant expédition) |
| `refunded` | Remboursée après annulation — statut terminal |

> 💡 **Pourquoi conserver `shipped` ?** Les trois jalons `preparation → shipped → in_transit` ne racontent pas la même chose :
> - `preparation` = emballé au hub
> - `shipped` = remis au transitaire à Dubaï
> - `in_transit` = effectivement en route
>
> Cette distinction est utile pour l'équipe opérationnelle, le support client, les litiges et les KPI délais.

> 💡 **Piste future :** renommer `confirmed → created` et `ordered → paid_confirmed` pour coller encore plus au vocabulaire métier. À faire lors d'une migration dédiée.

**Règle :** `orders.status` est modifié uniquement via l'API métier (`PATCH /api/orders/:id/status`) ou via une Link Rule autorisée.

---

## Cycle colis — `parcels.status`

```
draft → preparation → shipped → in_transit → available → collected
                                                        ↘ cancelled
```

| Statut | Signification logistique |
|--------|------------------------|
| `draft` | Colis créé, non encore préparé |
| `preparation` | En cours de conditionnement |
| `shipped` | Remis au transporteur |
| `in_transit` | En route vers le relais |
| `available` | Arrivé au relais, en attente de retrait |
| `collected` | Remis au client |
| `cancelled` | Annulé / retourné |

**Règle :** `parcels.status` est modifié uniquement via `PATCH /api/parcels/:id/status` (parcelSync).

---

## Link Rules — Événements autorisés

Les Link Rules sont des événements **ponctuels** et **explicites** qui permettent à un cycle d'informer l'autre.  
Elles sont évaluées automatiquement après chaque `PATCH /api/parcels/:id/status`.

### R1 — Livraison totale confirmée
```
Condition : TOUS les colis actifs (non annulés) de la commande = collected
Action    : orders.status = 'collected'
            orders.computed_status = 'collected'
```
Logique : si chaque colis physique a été remis au client, la commande est considérée comme entièrement livrée.

---

### R2 — Tous les colis annulés
```
Condition : TOUS les colis (y compris actifs) = cancelled
            ET orders.status ≠ 'collected'
Action    : orders.computed_status = 'parcels_all_cancelled'
            (orders.status inchangé — décision humaine requise)
```
Logique : l'annulation de tous les colis est un signal, pas une décision business automatique. Un agent doit évaluer si la commande doit être annulée ou re-préparée.

---

### R3 — Premier colis expédié
```
Condition : au moins un colis actif est en statut shipped | in_transit | available | collected
            ET orders.status ∈ ['confirmed', 'ordered', 'preparation']
Action    : orders.status = 'in_transit'
```
Logique : dès qu'un premier colis part physiquement, la commande entre logiquement en phase de transit côté business.

> ⚠️ **Note importante :** si `orders.status = 'shipped'`, R3 **ne s'applique pas**.  
> La commande est déjà au-delà du seuil de départ physique — elle a été remise au transitaire par une action humaine explicite.  
> Le passage `shipped → in_transit` reste une transition manuelle (opérateur ou scan).

---

## Statuts front simplifiés (client)

Les statuts internes sont détaillés pour les opérations. Le front client peut les mapper en messages simplifiés :

| `orders.status` interne | Libellé client suggéré |
|------------------------|----------------------|
| `confirmed` | Commande enregistrée |
| `ordered` | Commande lancée |
| `preparation` | En préparation |
| `shipped` | En route vers Comores |
| `in_transit` | En transit |
| `available` | Disponible au retrait |
| `collected` | Retirée — merci ! |
| `cancelled` | Annulée |
| `refunded` | Remboursée |

> Ce mapping est indicatif. Il n'est pas stocké en base — c'est une couche de présentation uniquement.

---

## Vue logistique — `orders.computed_status`

`orders.computed_status` est une **vue lecture seule** calculée par le moteur d'optimisation.  
Elle reflète l'avancement logistique global de la commande mais **ne pilote pas `orders.status`**.

Valeurs possibles : `draft`, `preparation`, `shipped`, `in_transit`, `available`, `collected`, `parcels_all_cancelled`

---

## Ce qui N'est PAS autorisé

| ❌ Interdit | Raison |
|------------|--------|
| Déduire `orders.status` depuis l'ensemble des `parcels.status` | Les deux cycles sont indépendants |
| Déduire `parcels.status` depuis `orders.status` | Idem |
| Ajouter des Link Rules sans les documenter ici | Contrôle explicite des franchissements |
| Une Link Rule qui revient en arrière (ex: `collected → ordered`) | Les transitions sont unidirectionnelles |

---

## Implémentation

| Fichier | Rôle |
|---------|------|
| `utils/orderParcelLinkRules.js` | Moteur des Link Rules (R1 / R2 / R3) |
| `routes/parcels.js` | Appelle `evaluateOrderParcelLinkRules` après chaque PATCH statut |
| `utils/parcels.js` — `computeOrderStatus()` | Vue logistique seule (écrit `computed_status`, pas `status`) |
| `services/parcelOptimizationService.js` | Optimisation de la répartition — ne touche pas aux statuts commande |

---

## Évolutions futures (backlog)

- **R4** — Premier colis `available` → notifier le client (push / SMS), sans modifier `orders.status`
- **R5** — `orders.status = available` positionné manuellement par l'agent relais (pas une déduction logistique)
- Historique des Link Rules déclenchées dans une table `order_lifecycle_events`
- Annulation partielle : si certains colis annulés mais pas tous → `orders.computed_status = 'partial_cancellation'`
