# ADR-004 — Cohérence du taux douane terrain

**Date :** avril 2026
**Statut :** Implémenté
**Contexte :** Étape B du plan post-audit. Faire en sorte que les marges affichées partout reflètent le vrai taux douane terrain calculé depuis les envois (Point 1, ADR-001).

---

## Problème détecté

Avant cette ADR, plusieurs incohérences :

1. **`routes/dashboard.js` lisait une vue `customs_taux_mensuel` qui ne fonctionne pas** : elle est définie sur `customs_history.customs_delta_pct` qui n'existe pas dans le schéma de la migration 018. Le code masquait l'erreur avec un `try { } catch { }`, donc en prod le taux était **toujours** le fallback `customs_rate_default_pct = 42%`.

2. **Le router `admin-customs-shipments.js` (Point 1) stockait les `customs_share_kmf`** dans `customs_shipment_parcels` mais **ne propageait jamais** ces valeurs vers `orders.cost_douane_kmf`. Conséquence : désactiver un envoi mettait à jour `is_active` mais les marges restaient figées.

3. **Conflit avec l'engagement métier** : tu avais demandé "désactiver = retirer la ventilation et recalculer les marges réelles". Le code ne le faisait pas.

## Décisions

### 1. Source de vérité unique : la vue `customs_effective_rates`

`routes/dashboard.js` (endpoint `/api/dashboard/pilotage`) lit désormais `customs_effective_rates` (créée par migration 034), avec une cascade de fallback :

```
customs_effective_rates (last_30d → last_90d → last_365d) → finance_config.customs_rate_default_pct
```

Le champ `couts.source_taux` exposé dans la réponse indique précisément la source utilisée (`'last_30d'` | `'last_90d'` | `'last_365d'` | `'finance_config_fallback'`).

### 2. Propagation automatique vers `orders.cost_douane_kmf`

Nouveau helper `propagateCostDouane(client, parcelIds)` dans `admin-customs-shipments.js` :

```js
async function propagateCostDouane(client, parcelIds) {
  // 1. Identifier les orders concernées
  // 2. Recalculer cost_douane_kmf = SUM(customs_share_kmf) des envois ACTIFS uniquement
  // 3. Recalculer margin_real_pct si les coûts sont renseignés
}
```

Appelé dans **4 endpoints** :
- `POST /` (création envoi + ventilation initiale)
- `POST /:id/deactivate` (désactivation → met `cost_douane_kmf = 0` si plus aucun envoi actif)
- `POST /:id/activate` (réactivation → recalcule depuis les nouvelles allocations)
- `DELETE /:id` (suppression définitive → recalcul aussi)

### 3. La vue `customs_taux_mensuel` reste inutilisée

On ne supprime pas la vue (qui peut exister en prod sans causer de problème), mais plus aucun code ne la lit. On pourra la supprimer dans un futur ménage de schéma.

## Logique de propagation

```
Pour CHAQUE order qui a au moins un parcel modifié :
  cost_douane_kmf = SOMME des customs_share_kmf de tous ses parcels
                    qui sont liés à un envoi customs_shipments.is_active = TRUE

  Si total_kmf > 0 ET (cost_transport_kmf > 0 OU cost_douane_kmf > 0) :
    margin_real_pct = (total_kmf - cost_transport_kmf - cost_douane_kmf) / total_kmf × 100
```

**Conséquence opérationnelle** :
- Quand tu **crées** un envoi avec ventilation → les commandes liées voient leurs marges baisser proportionnellement
- Quand tu **désactives** un envoi → les commandes liées voient leurs marges remonter (douane retirée)
- Si une commande a des colis venant de **plusieurs envois** (rare mais possible), la part de douane = somme des parts actives

## Cas particuliers

- **Commande sans aucun colis lié à un envoi** : `cost_douane_kmf` reste à NULL → marge théorique standard
- **Tous les envois d'une commande désactivés** : `cost_douane_kmf` = 0 → marge "sans douane attribuée"
- **Race condition** : la propagation est faite dans la même transaction que l'écriture ventilation → atomique

## Fichiers modifiés

- `routes/dashboard.js` — endpoint `/pilotage` lit `customs_effective_rates` au lieu de `customs_taux_mensuel` (cassé)
- `routes/admin-customs-shipments.js` — ajout helper `propagateCostDouane()` + appels dans POST/activate/deactivate/DELETE

Aucune nouvelle table. Aucune nouvelle migration. Le schéma reste celui d'ADR-001.

## Hygiène collatérale (Étape A)

- **Suppression** de `public/js/ct-views-ops.js` : 0.3 KB de mort-vivant tagué `[DEPRECATED]` qui n'était plus chargé nulle part
- **Vérification** doublon `simulator` vs `pricing` : faux positif. Le premier est un simulateur de **flux** (avancement automatique des commandes), le second un simulateur de **pricing** (calcul de prix). Rôles distincts, à conserver.

## Tests à faire après déploiement

1. Créer un envoi customs_shipment avec 2 colis → vérifier que les commandes liées voient leur marge baisser
2. Désactiver l'envoi → vérifier que les marges remontent
3. Réactiver l'envoi → vérifier que les marges rebaissent
4. Vérifier `/api/dashboard/pilotage` → champ `couts.source_taux` doit être `'last_30d'` (si données récentes) au lieu de `'finance_config_fallback'`

## Dépendances

- ADR-001 (Historique Douane) : pose la table `customs_shipments` et la vue `customs_effective_rates`
- ADR-003 (Comptabilité v2) : la vue Comptabilité affiche les marges réelles qui dépendent maintenant de cette propagation

Cet ADR est ce qui fait que **les chiffres se parlent enfin** : un envoi enregistré → propagé en marge réelle → visible dans le dashboard et la comptabilité, comme tu l'avais formulé : "chiffres qui se parlent, variables qui se reflètent".
