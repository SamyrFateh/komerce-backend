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


### Limites connues (revue PR-D)

- `scripts/fx-observation-cli.js` accepte `--by` en texte libre : la règle des deux personnes y est organisationnelle (deux opérateurs distincts, deux sessions). L'API admin, elle, prend l'identité de la session authentifiée. Utiliser l'API pour toute saisie courante ; le script est réservé à l'initialisation.
- Le vidage du cache `utils/rates` à l'approbation ne touche que l'instance qui l'a traitée : sur plusieurs instances, un nouveau taux est vu au plus tard après l'expiration du cache (60 s). Le jeu incomplet n'est jamais mis en cache.
- Une observation peut être datée dans le passé : elle ne modifie aucune commande existante (taux figés dans `orders.fx_snapshot`, migration 315) mais change le taux applicable à ces dates pour les conversions à `at` explicite.
- Les définitions historiques de `finance_config` (`bootstrap/startup-migrations.js`, `db/schema.sql`) créent encore `taux_change_eur_kmf NOT NULL DEFAULT 491.96` sur une base neuve : la migration 316 les rend optionnelles, aucune lecture applicative ne les utilise (garde CI). Le DROP des colonnes est prévu dans une PR séparée.
- Export financier : le taux EUR/KMF d'une commande est dérivé de ses montants figés (KMF d'origine / EUR encaissé) ; le taux AED n'est plus figé par commande.

## Amendement du 25 octobre 2026 — alimentation publique 7j/7

Les règles précédentes décrivent l'autorité à double saisie manuelle. Pour le fonctionnement courant de Komerce, **une cotation officielle publiée n'exige aucune approbation humaine** :

- KMF/XAF : parités fixes gouvernées, jamais recalculées à partir d'un cours de marché.
- EUR : pivot. Les cotations journalières BCE EUR/USD et EUR/XXX sont téléchargées automatiquement via
  `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` ; elles sont accessibles tous les jours.
  La BCE *publie de nouveaux cours uniquement les jours ouvrés* ; le week-end, la dernière cotation publiée est conservée avec sa date réelle, **sans la redater**.
- USD : la cotation BCE EUR/USD sourcée et enregistrée dans `fx_public_reference_quotes` prévaut. La dernière observation interne réellement approuvée reste un recours contrôlé si aucun cours officiel frais n'est disponible.
- AED/DJF : leurs pegs USD officiels restent distincts et immuables ; les conversions suivent EUR/USD × USD/AED ou USD/DJF.
- CNY : cours BCE EUR/CNY publié ; conversion USD/CNY dérivée par le pivot EUR à partir des deux cotations (EUR/USD et EUR/CNY), sans ratio inventé. Les autres EUR/XXX publiées sont aussi ingérées, mais **leur existence n'autorise pas automatiquement ces devises dans les opérations** : le registre de devises commerciales autorisées reste une décision métier distincte.
- La collecte est déclenchée après démarrage et toutes les 4 heures par `bootstrap/crons.js`. Elle est idempotente et append-only. Chaque jambe de conversion porte un identifiant, un cours, une date réelle et sa source ; les transactions antérieures conservent leur snapshot.
- Source inaccessible, cours périmé au-delà de 7 jours, devise non cotée ou doute sur la provenance : refus typé, sans taux fictif. La saisie manuelle à deux personnes reste réservée à une situation exceptionnelle documentée.

La BCE indique que ses cours de référence sont informatifs : **les commissions et le taux de règlement du prestataire de paiement restent des faits financiers séparés** du cours de référence et doivent être figés au moment du paiement réel.
