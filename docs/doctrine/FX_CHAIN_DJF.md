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

## Gouvernance de l'observation EUR/USD (PR-D)

- **Une seule entrée flottante** : l'observation EUR/USD (`fx_rate_observations`, append-only). Les parités KMF/XAF sont fixes (`currency_parities`), le peg USD/DJF et USD/AED est daté (`fx_pegs`).
- **Saisie puis approbation par deux personnes différentes** (identités normalisées : trim + minuscules ; le saisissant ne peut pas approuver ; contrainte aussi en base).
  - API (admin) : `POST /api/admin/finance-config/fx-observations` puis `POST /api/admin/finance-config/fx-observations/:id/approve`, `GET` pour lister.
  - Hors interface : `node scripts/fx-observation-cli.js enter|approve|list` (voir l'en-tête ; aucun taux par défaut).
- **Aucun taux inventé** : le taux, sa source (ex. taux de référence BCE) et sa date viennent d'une source publiée ; fraîcheur maximale 7 jours, date d'approbation ≤ date de la transaction.
- **Alerte d'écart** : un écart > 3 % avec la précédente observation approuvée crée une alerte `fx_observation_gap` (l'approbation reste possible).
- **Retiré** : l'édition de `finance_config.taux_*` et `PUT /api/pricing/rates` répondent 410 ; `exchange_rates` n'est plus qu'un journal historique en lecture seule.
- **Garde CI** : `tests/unit/fx-no-competing-authority.test.js` interdit tout repli 492/138, ratio 0,92 et lecture directe de `finance_config.taux_*` hors liste justifiée.
- **Procédure d'initialisation (staging)** : la personne A saisit le taux publié (avec sa source et sa date), la personne B l'approuve ; sans cela, toute conversion USD/DJF/AED est refusée (503) par conception.

