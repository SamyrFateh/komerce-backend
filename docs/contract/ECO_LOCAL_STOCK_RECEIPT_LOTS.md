# ECO #5280 — lots économiques LOCAL_STOCK

Le stock physique reste sous l'autorité W3. Une réception identifiée par SKU et bon de livraison dans l'audit existant constitue le lot physique ; pas de reconstruction des anciens stocks. La réception et son audit sont atomiques. Le responsable pays garde seul le droit de déclarer les réceptions, sans extension des droits admin W3.

La Direction rapproche le montant total KMF réellement réglé, justificatif obligatoire, puis atteste le lien physique entre chaque ligne vendue et le lot dans Rentabilité. La clôture ne modifie ni le stock, ni les prix, ni les charges de structure. La ventilation cumulative conserve le total au centime lorsque toutes les unités sont rattachées. La même vente ne peut être rattachée deux fois.

Le lecteur vérifie à nouveau SKU, marché, quantité, allocation locale consommée, paiement, remise au client et absence de remboursement/litige actif. Le prix de revient utilise l'achat attesté une seule fois, plus les coûts variables justifiés. Un coût absent n'est jamais un zéro. Trois lots distincts admissibles sur 90 jours sont nécessaires ; aucune expédition internationale n'est inventée.

Limites conservatrices du candidat : une ligne doit être rattachée intégralement à un seul lot attesté ; un panier mixte local/import ne devient pas décisionnel via ce lecteur local. Ces cas restent visibles comme non certifiés, sans inférence FIFO ou extrapolation. Les anciennes réceptions sans SKU ne sont pas valorisées rétroactivement. Le contrôle de droits, les écritures concurrentes, la conservation au centime et les parcours Chromium/API/PostgreSQL doivent être rejoués sur le SHA candidat avant fusion.
