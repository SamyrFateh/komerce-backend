# C2 — Dette historique de réception physique (diagnostic)

- Requête (lecture seule) : `scripts/diagnostics/order-physical-coverage-exceptions.sql` — référence, état, quantité manquante, preuve déclarative disponible, PO, prochaine action.
- Environnement staging/production : **non vérifié** (aucun accès DB depuis la session de remédiation ; rien exécuté). Nombre d'exceptions : **non vérifié**.
- Aucune réécriture automatique des statuts. Les commandes déjà en `preparation` ou au-delà restent telles quelles (le gate ne contrôle que l'ENTRÉE en `preparation`).
- Nouvelle progression physique d'une commande historique non couverte : refus `PHYSICAL_RECEPTION_INCOMPLETE` (409) avec le manquant par ligne ; remédiation explicite = réceptionner la matière réelle via `POST /api/scans/hub/receive` (accepte les PO historiques). Aucune réception n'est inventée ; `purchase_orders.received_qty` n'a plus valeur de preuve (visible en `declared_received_quantity`).
- Sans conséquence pour les PO déjà `hub_received` par déclaratif tant que la commande est déjà avancée ; une commande encore en `confirmed`/`ordered` avec un reçu uniquement déclaratif doit être réceptionnée physiquement pour avancer.
