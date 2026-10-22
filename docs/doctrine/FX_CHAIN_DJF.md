# Chaîne de change EUR→USD→DJF (amendement du freeze Currency Boundary)

Statut : GO Opus sous conditions (lot 4, 2026-10-22). Périmètre PR1 : stockage + service ; aucun branchement checkout/paiement.

- `currency_parities` reste réservée aux parités FIXES vers EUR (KMF, XAF, EUR). DJF n'y entre jamais ; `getCurrencyParity` ne lit jamais `fx_*`.
- DJF est indexé sur l'USD : `fx_pegs` n'admet que (USD, DJF) par CHECK (pas de matrice de paires). L'EUR reste le pivot : le taux DJF/EUR est dérivé à la résolution, jamais stocké.
- EUR→USD flottant : `fx_rate_observations`, saisie puis approbation par deux personnes différentes, bande de plausibilité 0,8–1,6, `as_of` ≤ création, append-only. Aucune valeur pré-remplie.
- Fraîcheur : 7 jours par défaut. Sans observation approuvée, fraîche et antérieure à la transaction → `fx_rate_unavailable` (503), sans repli sur 492/138.
- Figé par transaction : les ids des jambes (observation, peg) sont copiés dans le snapshot ; jamais recalculés.
- Arrondi : un seul, au plus proche, sur le total (DJF minor_unit = 0).
- Distinct de `finance_config` (taux EUR/KMF, AED/KMF — ADR-009) et d'`exchange_rates` : le nouveau magasin ne les remplace ni ne les alimente.
- PR2 : route de saisie finance avec validation à deux (+ alerte écart > 3 %), snapshot, paiements, control-plane. `projectAmount` et `NO_CURRENCY_PARITY` restent inchangés tant que le branchement n'est pas livré.

## Autorité de conversion unique (migration 314, PR-A)

Depuis la décision « EUR pivot, une seule autorité », `services/fx-authority.js` est le seul point de conversion
(`utils/currency.js` n'en est plus qu'un relais). Chaque devise a des « unités pour 1 EUR » faites de jambes sourcées :
KMF/XAF = `currency_parities` ; USD = observation EUR/USD approuvée et fraîche ; DJF et AED = observation × peg
(`fx_pegs`). Calcul décimal exact, un seul arrondi half-even au minor_unit ISO de la devise cible ; CNY et devises
inconnues refusées. `currency_parities` est immuable en valeur. Les jambes sont retournées pour figer le snapshot.
