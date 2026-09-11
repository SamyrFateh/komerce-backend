# Note — stratégie additive

Le lot V1.1 ajoute les primitives de décision à côté de `DashboardSchema` / `dashboard-renderer` V1 au lieu de les élargir immédiatement.

Raison : les écrans non migrés continuent d'utiliser le contrat fermé `chart | table` sans régression. Pilotage réutilise son fetch, ses projections et son scope existants puis remplace seulement la représentation finale avec les primitives décisionnelles.

Une évolution ultérieure de DashboardSchema ne sera envisagée qu'après validation de plusieurs écrans et stabilisation des formes réellement communes.
