# Komerce V1 — quatre profils opérationnels, périmètres natifs

Décision métier du 02/11/2026. **Ce document définit la cible de démarrage et de certification**, et non une ouverture implicite de toutes les API.

| Profil | Portée | Autorité | Limites |
| --- | --- | --- | --- |
| Admin central (`admin`) | Plateforme entière | Gouvernance et configuration centrale, sous les gardes explicites déjà existants | Les actes financiers sensibles conservent leurs validations indépendantes |
| Hub central (`agent_hub`) | Logistique de tous les marchés actifs | Lecture et exécution Hub/PO/réception/colis/expédition via leurs routes métier dédiées | Jamais les droits Admin, de tarification, d'équipe marché ou de caisse |
| Responsable marché (`market_operator`) | Un ou plusieurs marchés attribués | Catalogue commercial, prix et opérations locales de ses marchés, y compris lecture de suivi logistique | Pas d'accès aux autres marchés ni de commande des opérations physiques centrales |
| Relais (`agent_relais`) | Relais physiques affectés | Réceptions, retraits, espèces et traçabilité opérationnelle dans son périmètre | Pas d'accès aux autres relais, pas de gestion Hub |

Les métiers auxiliaires déjà codés (sourcing, finance, transitaire, support) restent **des spécialisations techniques ou responsabilités distinctes** le temps de leur revue; ce document n'autorise pas leur suppression ni l'élargissement de leurs permissions.

## Règles incontournables

1. **Le Hub est central.** Il ne rejoint ni l'équipe KM ni l'équipe CM pour traiter leurs importations. `orders.market_id` et l'identification des PO mono-marché sont des faits de routage/traçabilité, jamais des grants d'accès commerciaux pour `agent_hub`.
2. **Contexte de navigation ≠ autorité d'une API.** `GET /api/admin/dashboard/context` peut fournir au Hub les codes de tous les marchés actifs dans un mode distinct `hub`, sans `dashboard.global.read` et sans projection de capacités commerciales déléguées. Toutes les actions restent protégées par leur propre guard backend.
3. **Responsable marché = périmètre marché serveur.** Aucun `market_id` fourni par le navigateur n'est autorité. La membership active et les capacités demeurent le contrôle effectif des actions commerciales.
4. **Relais = affectation physique.** Le rattachement `users.relais_id` et les contrôles indépendants de caisse et de remise restent canoniques.
5. **Commandes mixtes.** Les lignes locales évitent le Hub; les lignes importées traversent PO, réception Hub, KOM-BOX, expédition et retrait. Une commande n'est entièrement clôturée qu'une fois tous les retraits/ajustements réconciliés.

## Certification V1

- Test négatif : le Hub sans membership marché obtient son contexte `mode=hub` et tous les marchés actifs, **mais aucune autorité globale Admin**.
- Test négatif : marché hors scope refusé au Responsable marché; Relais hors rattachement refusé; Hub interdit sur gestion d'équipe, prix et sorties caisse.
- Test positif : Hub peut effectivement ouvrir ses dossiers, ses PO autorisées, constater des quantités reçues, constituer les cartons, remettre au transitaire et suivre chaque commande jusqu'au Relais.
- Recette Chromium 1440/390 avec profils réellement connectés et SHA déployé, sans redirections fictives.
- E7 : tests PSP sandbox, idempotence, annulation et remboursement partiel avant GO financier.

## Portée du premier correctif

Le premier lot ne modifie que le **contexte serveur du Hub** : retrait de sa dépendance aux `team.*` marché pour l'affichage du poste de travail. Il ne modifie ni les permissions de mutation ni les autres rôles. Les écrans et gardes des opérations physiques Hub seront vérifiés séparément avant certification.
