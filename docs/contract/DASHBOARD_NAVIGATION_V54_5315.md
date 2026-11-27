# Navigation canonique V5.4 — #5315, L3a.4

Source de vérité fonctionnelle : gel propriétaire du mock V5.4, #5315 commentaire 7229082512 (SHA-256 c18493c4055827fe0355a4697d6bc142fba3ddffa415722f63649d2625701a2c).

## Projection de transition

Le regroupement porte sur la sidebar existante, et non sur les autorisations ou les endpoints. Les 22 destinations de main ac0416af sont conservées exactement une fois. Le référentiel SIDEBAR_GROUPS reste unique ; la visibilité est évaluée par les mêmes rôles et capabilities serveur.

| Famille V5.4 | Destinations existantes, dans l'ordre |
| --- | --- |
| Travail | À traiter ; Hub ; Expéditions & Douane ; Relais live ; Achats fournisseurs ; Sourcing |
| Décision | Pilotage ; Commerce ; Opérations |
| Dossiers | Commandes ; Clients ; Catalogue |
| Gestion | Prix & économie ; Vue finance ; Comptabilité ; Invendus ; Responsables pays ; Utilisateurs ; Relais & prestataires ; Paramètres |
| Aide | Documentation ; Recette guidée |

Les libellés de périmètre Hub et Catalogue restent explicites. Les trois dashboards de décision portent leur nom V5.4. Les deux destinations Finance restent séparées jusqu'à la preuve de parité du poste Finance unifié ; la recette guidée reste un outil admin dans Aide. Le menu cible ne promet pas encore un stock local unifié ni un écran Marchés plus complet que l'existant.

## Invariants et limites

- Aucune route, identité, surface, capability, garde, home métier, action, lecture ou capacité legacy retirée ou élargie.
- N2 et les routes des dossiers restent inchangés ; les retours contextuels, mono-marché fixe et devises issus des lots précédents restent acquis.
- La navigation est une projection, jamais une autorité de lecture ou d'écriture.
- Les travaux sur les postes unifiés, exceptions, consolidation déléguée, couverture fonctionnelle des rubriques et élimination des doublons restent à mener dans les lots suivants. Ce regroupement n'est ni leur certification ni le GO staging.
- Tests : cardinalité, unicité des destinations, ordre des familles, droits et isolation des profils existants, cache partagé. Certification intégrée à réaliser conformément au gel.
