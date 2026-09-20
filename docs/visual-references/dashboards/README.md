# Komerce — 11 maquettes de dashboards validées (11 septembre 2026)

**Source d'autorité** : [DASHBOARD_MOCK_TRACE_V1.md](../../contract/DASHBOARD_MOCK_TRACE_V1.md), [manifeste JSON](../../contract/DASHBOARD_MOCK_TRACE_V1.json), [doctrine UX](../../doctrine/DASHBOARD_DECISION_VISUAL_DOCTRINE_V1.md).

Ces onze captures PNG sont les **références visuelles originales** ; chiffres de démonstration, pas des données de production. Ne pas les recréer ni inférer des règles métier depuis leurs nombres. Conserver la hiérarchie des informations, l'intention décisionnelle, et les permissions/Market ID définis dans la doctrine.

| N° | Mock ID | Écran | Fichier visuel original |
|---:|---|---|---|
| 01 | MOCK-DASH-001 | Pilotage | [01_Pilotage.png](01_Pilotage.png) |
| 02 | MOCK-DASH-002 | Commerce | [02_Commerce.png](02_Commerce.png) |
| 03 | MOCK-ECO-001 | Atelier économique | [03_Atelier_economique.png](03_Atelier_economique.png) |
| 04 | MOCK-CAT-001 | Catalogue pays | [04_Catalogue_pays.png](04_Catalogue_pays.png) |
| 05 | MOCK-ORD-001 | Commandes | [05_Commandes.png](05_Commandes.png) |
| 06 | MOCK-MKT-001 | Marchés | [06_Marches.png](06_Marches.png) |
| 07 | MOCK-OPS-001 | Opérations — vue d'ensemble | [07_Operations.png](07_Operations.png) |
| 08 | MOCK-OPS-002 | Hub / Relais | [08_Hub_Relais.png](08_Hub_Relais.png) |
| 09 | MOCK-OPS-003 | Expéditions & Douane | [09_Expeditions_Douane.png](09_Expeditions_Douane.png) |
| 10 | MOCK-OPS-004 | Sourcing | [10_Sourcing.png](10_Sourcing.png) |
| 11 | MOCK-FIN-001 | Finance | [11_Finance.png](11_Finance.png) |

**Note de provenance / nommage** : dans la première archive de récupération, trois noms de fichiers étaient intervertis : le visuel « Faire tourner le hub et les relais » était nommé 07_Operations, « Sécuriser l'approvisionnement » était nommé 08_Hub_Relais et « Piloter les opérations du marché » était nommé 10_Sourcing. Le présent index rétablit la correspondance entre **contenu réel de l'image**, écran et Mock ID, sans retoucher les PNG.

**Statut de cette branche** : le présent index peut être ajouté avant les fichiers binaires. Vérifier que les 11 liens PNG sont fonctionnels et que la PR contient effectivement les 11 fichiers **avant de fusionner**. Les captures ne sont pas présentes sur `main` tant que la PR n'est pas mergée.
