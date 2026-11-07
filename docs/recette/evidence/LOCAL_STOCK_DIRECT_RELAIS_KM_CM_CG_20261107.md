# LOCAL_STOCK — certification directe Relais KM / CM / CG (07/11/2026)

**Verdict : LOCAL_STOCK_HTTP_PASS sur les 3 marchés, 17/17 chacun (51/51).**
Ce résultat certifie le périmètre **HTTP réel staging + readback PostgreSQL**, et non le geste Chromium dans Relais Live ni l'ouverture commerciale.

## Incident découvert puis corrigé avant le GO local

Le premier run KM ([42394755113](https://github.com/SamyrFateh/komerce-backend/actions/runs/42394755113), fixture 209CA661) avait **16 PASS, 1 FAIL**. Après une réception physique directe conforme, le scan de retrait fabriquait un « rattrapage » shipped dans \`scan_events\` et alimentait \`qty_shipped\`, malgré l'absence totale de Hub/expédition. Il était donc **non certifié** et n'est pas inclus dans les 51 contrôles réussis.

Correction : [PR #3526](https://github.com/SamyrFateh/komerce-backend/pull/3526), fusionnée dans \`ebe04e7ec9abc6fef4e6d3601e1f9a2f9239ae6f\`. Un colis exclusivement LOCAL_STOCK, disponible au relais, avec scan physique canonique \`scans.relais_received\`, aucun lien/horodatage d'expédition, et des quantités entièrement reçues, **n'invente plus** les catchups Hub lors de \`customer_collected\`. Les parcours importés et les colis historiquement expédiés ne sont pas exemptés.

## Trois campagnes indépendantes certifiées

| Marché | Fixture RUN8 | GitHub Actions | Artefact original (30 jours) | Résultat |
|---|---|---|---|---|
| KM | \`BD3CE8A5\` | [42396288384](https://github.com/SamyrFateh/komerce-backend/actions/runs/42396288384) | [13583008476](https://github.com/SamyrFateh/komerce-backend/actions/runs/42396288384/artifacts/13583008476) | 17/17 — \`LOCAL_STOCK_HTTP_PASS\` |
| CM | \`7590132A\` | [42396467536](https://github.com/SamyrFateh/komerce-backend/actions/runs/42396467536) | [13583532259](https://github.com/SamyrFateh/komerce-backend/actions/runs/42396467536/artifacts/13583532259) | 17/17 — \`LOCAL_STOCK_HTTP_PASS\` |
| CG | \`338A2CD4\` | [42396651329](https://github.com/SamyrFateh/komerce-backend/actions/runs/42396651329) | [13583866199](https://github.com/SamyrFateh/komerce-backend/actions/runs/42396651329/artifacts/13583866199) | 17/17 — \`LOCAL_STOCK_HTTP_PASS\` |

Empreinte backend **vérifiée dans les trois** \`deploy-pin.json\` : \`ebe04e7ec9abc6fef4e6d3601e1f9a2f9239ae6f\`, sur l'environnement Railway staging \`superb-presence\`. Les trois campagnes ont créé et exploité **leurs propres fixtures neuves** avec paiement simulé, sans opération PSP. Les originaux JSON restent dans les artefacts GitHub Actions, soumis à rétention de 30 jours. Le présent rapport constitue la synthèse versionnée des preuves vérifiées.

## Contrôles métier exécutés (identiques sur KM, CM et CG)

- Attestation physique directe au relais avec appel HTTP authentifié et preuve explicite, \`POST /api/orders/:orderId/local-relay-receipt\` : **200** ; refus sans preuve : **400**.
- Accès du Hub, du responsable marché et du transitaire à la réception locale : **403** pour chacun ; aucune mutation physique après ces refus.
- Réception réessayée après succès : **409**, sans duplication de colis.
- Retrait par l'agent relais avec la route canonique du Workspace : **200** ; commande et unique colis en \`collected\`.
- Pour chaque fixture : 1 attestation \`scans.relais_received\`, 1 transition \`available\`, 1 transition \`collected\`; 1 allocation de stock consommée, 1 article commandé/reçu/retiré.
- **Quantités finales** des trois fixtures : \`quantity=1\`, \`qty_shipped=0\`, \`qty_received=1\`, \`qty_collected=1\`.
- **Absences vérifiées à zéro dans chaque rapport JSON** : \`purchase_lines\`, \`purchase_orders\`, \`hub_allocations\`, \`hub_units\`, \`shipment_receipts\`, \`shipped_scans\`, \`shipped_scan_events\`, \`shipping_history\`, \`cash_collections\`.
- Aucun champ \`shipment_id\`, \`shipped_at\` ou \`in_transit_at\` sur le colis direct ; l'affectation du compte de relais de recette a été restaurée en fin de chaque campagne.

## Frontières strictes du verdict

La campagne exerce **HTTP + données physiques PostgreSQL**. Elle ne prouve pas encore que l'agent peut effectuer la **réception locale directement dans Relais Live par clics Chromium**, ni les comportements métier exceptionnels : réceptions partielles, incidents, reliquats, annulations, remboursements, retours. Ce sont des gates de certification séparés.

Les tarifs transport **RECETTE de CM et CG demeurent provisoires**. Les résultats précédents des circuits import (nominal, isolation responsable marché et frontières entre rôles) restent distincts et valides ; aucune décision d'ouverture commerciale n'est donnée ici.

**Runner reproductible :** \`.github/workflows/staging-local-stock-certification.yml\` → \`scripts/recette/staging-local-stock-real-relay-cert.js\`. Lancer uniquement sur staging, avec un marché à la fois, fixture fraîche et contrôle SHA actif.
