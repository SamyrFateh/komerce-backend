# Trace des mocks dashboards Komerce V1

> Statut : **FIGÉ — références visuelles approuvées le 2026-09-11**
> Doctrine : `docs/doctrine/DASHBOARD_DECISION_VISUAL_DOCTRINE_V1.md`

Les images sont des références visuelles. Les chiffres affichés dans les mocks sont illustratifs. Les familles d’indicateurs, la hiérarchie des blocs, le type de représentation et l’intention de décision sont figés.

## Index

| ID | Écran | Référence | Gen ID |
|---|---|---|---|
| `MOCK-DASH-001` | Pilotage | `tableau_de_bord_komerce_comores.png` | `3714a9da-0f8b-4bfa-9c0b-5aea7dd0caaa` |
| `MOCK-DASH-002` | Commerce | `tableau_de_bord_commercial_komerce.png` | `4cdce773-2b63-4b38-92bd-6e72e301ff31` |
| `MOCK-ECO-001` | Atelier économique | `tableau_de_bord_économique_komerce_aux_comores.png` | `07ec441f-0f0d-4faf-b0b2-739251226326` |
| `MOCK-CAT-001` | Catalogue pays | `tableau_de_bord_catalogue_komerce.png` | `72ab8264-c94e-4b8f-b7b7-567895db942f` |
| `MOCK-ORD-001` | Commandes | `tableau_de_bord_commandes_komerce.png` | `15bced51-14be-4086-b61d-659de8415af7` |
| `MOCK-MKT-001` | Marchés | `tableau_de_bord_komerce_des_marchés.png` | `9708dbef-ae60-46d2-be99-9c2dc2f0117b` |
| `MOCK-OPS-001` | Opérations overview | `tableau_de_bord_des_opérations_komerce.png` | `adf7ddc7-1c4b-4058-aa54-64b8ef8bd0f7` |
| `MOCK-OPS-002` | Hub / Relais | `tableau_de_bord_des_opérations_komerce.png` | `5f2795d4-cbad-465b-ac74-239bd062610b` |
| `MOCK-OPS-003` | Expéditions & Douane | `tableau_de_bord_expéditions_et_douane.png` | `d0b2ebc9-bc67-4f6b-806e-39cc5c61bedf` |
| `MOCK-OPS-004` | Sourcing | `tableau_sourcing_komerce_aux_comores.png` | `759a0805-64da-48cd-83e3-086a88f4e2c3` |
| `MOCK-FIN-001` | Finance | `tableau_de_bord_financier_komercecresics.png` | `41068967-445c-4421-adce-6b5ccc8b9534` |

## Principe de lecture

Tous les mocks suivent la même séquence :

1. état et décisions importantes ;
2. KPI clés ;
3. représentation adaptée aux données ;
4. problèmes / alertes ;
5. liste de travail ;
6. actions prioritaires ;
7. fraîcheur et qualité des données.

Les vues détaillées non mockées réutilisent ce langage, avec moins de synthèse globale et davantage de détail métier.

## Règle d’implémentation

Chaque écran doit documenter dans sa PR :

`bloc visuel → information → source serveur → périmètre → représentation → destination → statut`.

Statuts possibles : `PROVEN`, `PROJECTABLE`, `BACKEND_GAP`, `UI_GAP`, `DEFERRED`.

Aucune valeur illustrative d’un mock ne doit être introduite dans le code production pour masquer une donnée indisponible.
