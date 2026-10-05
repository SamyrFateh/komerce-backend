# Backoffice Canonical — ordre d'exécution

## Chantier actif : remise à niveau des vérités métier

Ce plan prolonge les surfaces Canonical existantes. Il ne relance ni le RESET ni
la migration visuelle initiale. Référence du diagnostic ciblé : `3ff9525bb`.
Les écarts sont suivis dans `DASHBOARD_DECISION_GAPS_V1.md`, section
« Backoffice : exécution fournisseur et administration » ; aucun audit parallèle.

### Cadre conservé

- Dashboard observe ; Workspace agit via la feature propriétaire ; Entity 360
  explique ; Action Center priorise ; Administration configure et audite.
- Le shell métier N1/N2/N3 reste celui de `ADMIN_NAVIGATION_DOCTRINE_V3.md`
  et de son runtime `navigation-policy-v4.js`. Ces cinq responsabilités ne
  deviennent pas cinq nouveaux domaines de sidebar.
- Le meilleur design Legacy reste la référence visuelle. Sa représentation est
  réexprimée avec les primitives Canonical : aucun import de JS, CSS ou vue Legacy.
- Les capacités Legacy sans équivalent restent accessibles jusqu'à une bascule
  prouvée. Ne pas porter les anciennes pages une par une.
- Autorisations et scopes sont résolus côté serveur. Une destination visible
  doit avoir une surface et un guard réels ; aucune extension implicite de droits.
- Cible produit : 3 à 5 indicateurs actionnables par dashboard. Pour chacun :
  population exacte, condition ou seuil canonique, responsable, liste filtrée et
  action propriétaire. Le reporting descriptif descend dans le détail.
- Un manque de donnée n'est jamais un zéro. Un achat manuel autorisé n'est pas
  une anomalie faute d'automatisation ; une preuve absente n'est une exception
  que si le contrat du flux l'exige. Aucun seuil inventé dans le navigateur.

### Lots livrables

| Lot | Périmètre et propriétaire | Sortie vérifiable |
|---|---|---|
| 0 — cadrage ciblé | `dashboard` ; documents canoniques existants | Écarts observés séparés des points restant à qualifier ; ordre, sources, gates et limites consignés. Pas de refonte du shell. |
| 1 — projection Achats | `purchasing` ; détail PO et lecture de l'exécution fournisseur | Contrat read-only reliant PO, lignes, ordres/groupes fournisseur, paiements, rapprochements et preuves. Cas aucun ordre, plusieurs ordres et parent groupé représentés sans duplication de montants. Aucun appel fournisseur ni paiement déclenché par une lecture. |
| 2 — parcours Achats / Order 360 | `dashboard`, données de `purchasing` | Vente/lignes → PO → exécution → paiement/preuve → Hub navigables avec retour contextuel. Identifiants automatisés affichés depuis la source ; confirmation manuelle conservée seulement dans son parcours autorisé. Pas de nouvelle commande métier dans l'UI. |
| 3 — Finance et exceptions | `dashboard`, `purchasing`, propriétaires du rapprochement et des signaux à résoudre par pack | Engagement, demande, résultat du paiement, rapprochement et débit prouvé restent distincts. Montants par devise ; pas de total multi-devise implicite. Chaque exception ouvre la population exacte et le workspace propriétaire. |
| 4 — fournisseurs : administrer et comprendre | `dashboard`, `purchasing`, `supplier-connectivity` et propriétaires configuration/certification | Supplier 360 en lecture ; administration séparée pour identité, configuration non secrète, capabilities et certification. Actions existantes, guards et audit vérifiés ; aucun secret exposé. |
| 5 — Sourcing / Catalogue / Product 360 | `dashboard` et features propriétaires identifiées par les packs ciblés | Capabilities observées avec portée/environnement/preuve ; identité produit/SKU/fournisseur traçable. Vendable, achat manuel et achat automatique restent trois notions distinctes. Pas de statut de certification codé en dur par fournisseur. |
| 6 — administration transversale | Features propriétaires de chaque sous-périmètre | Matrice surface → commande → guard → audit pour utilisateurs/rôles/scopes, marchés/partenaires, taxonomie/publication, hubs/corridors, règles financières, documents et configuration. Réutiliser ce qui existe ; livrer les manques par sous-lot cohérent. Client/Market 360 évalués ici ; Partner 360 seulement si un besoin distinct est prouvé. |
| 7 — dashboards et bascule | `dashboard` | Pilotage/Commerce/Opérations/Finance limités aux décisions utiles ; compte, liste et détail cohérents sous les mêmes filtres/scopes. Retrait d'un doublon seulement après preuve de parité et maintien du retour/rollback prévu par le contrat de cutover. |

Action Center s'enrichit pendant les lots 2 à 6, avec le moteur de signaux
existant. Il oriente ; il ne répare jamais directement la donnée métier.
Les corrections de navigation se font au contact du parcours livré, sans
attendre un nouveau chantier de shell.

### Première PR applicative : projection de détail PO

Entrée : `GET /api/purchasing/po/:po_id`, aujourd'hui délégué à
`services/purchasing-grouped-service.js::getGroupedPurchaseOrder`.
Le contrat actuel retourne PO, lignes et marchés ; il ne lit pas les tables
`supplier_execution_*`. Le lot 1 ajoute une projection au périmètre purchasing,
en réutilisant les liens persistés et les gardes existantes.

Avant de modifier : pack `service` de `purchasing`, impact de la cible, puis
headers/mustCheck et schémas nécessaires. Vérifier les cardinalités, le scope,
les champs exposables et les lecteurs du contrat. Ne pas exposer de payload
provider brut ou inventer un verdict de preuve à partir d'un paiement réussi.

Preuves attendues : contrat de lecture, absence d'écriture/appel fournisseur,
PO absente/historique, aucun ordre, ordres multiples et parent groupé, paiement
ambigu, rapprochement non conclu, preuve manquante ou vérifiée. L'UI et ses
preuves desktop/mobile arrivent au lot 2. Aucun achat réel nécessaire au lot 1.

### Discipline de livraison

`pack → impact → sources nécessaires → changement → preuve ciblée → pr:preflight → PR`.
Une PR porte un contrat/parcours cohérent ; les lots peuvent nécessiter plusieurs
PR. Pas de migration, nouvelle autorité, exemption ou writer parallèle implicite.
La complétion au contact, les gates et la clôture autonome restent celles
d'`AGENTS.md`. Le lot documentaire ne vaut pas preuve d'exécution applicative,
de certification fournisseur ni de disponibilité en production.

## Séquence visuelle initiale — référence, pas file de travaux à rouvrir

1. Pilotage — fondation et preuve du langage visuel.
2. Commerce — funnel, pertes, classements, arbitrages.
3. Opérations overview — cartes workspaces, signaux, frictions, priorités.
4. Finance — trajectoire, coûts incomplets, rapprochements, alertes.
5. Hub / Relais — réseau, collecte, cash, tensions.
6. Expéditions & Douane — transit, dossiers, documents, priorités.
7. Sourcing — besoins, fournisseurs, pipeline, risques achats.
8. Commandes — lifecycle, funnel, SLA, litiges.
9. Catalogue pays — exposition, qualité, configuration locale.
10. Marchés — autonomie, droits, équipe, readiness.
11. Atelier économique — convergence visuelle sans réduire son cockpit spécialisé.

Chaque lot doit conserver les mêmes primitives lorsque la forme des données est identique et choisir une représentation métier différente lorsqu'elle est plus pertinente.
