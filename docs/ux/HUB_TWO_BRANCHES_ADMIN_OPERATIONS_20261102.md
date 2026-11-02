# Hub — Deux branches, un dossier transversal (UX cible, 2 novembre 2026)

> **STATUT : mini-app à deux colonnes codée sur branche, non fusionnée, non déployée.** Route Canonical `/admin/hub` ; à gauche, dossiers PO / commandes issus des projections serveur ; à droite, le module de travail métier canonique existant. Aucun contrat financier de validation nouveau n'est livré.

## 1. Décision métier
Le Hub est piloté par sa directrice et comporte **exactement deux branches** :
- **Administrative** : besoins d'achat, fournisseurs, PO mono-marché, engagement autorisé, facture, échéance, validation de paiement, preuve de règlement, rapprochement achat/facture/réception/paiement, supervision et incidents décisionnels.
- **Opérationnelle / Hub Live** : arrivages, réception, contrôle, affectation aux commandes, préparation, colis client, KOM-BOX, expédition et remise au transitaire.

La directrice valide **séparément** l'engagement d'achat puis le paiement fournisseur. Validation du paiement ≠ paiement exécuté. La comptabilité consomme les événements financiers canoniques sans recréer une comptabilité Hub. Les agents exécutent les tâches physiques sans voir de boutons financiers.

**Un seul dossier de traçabilité**, partagé entre les vues : commande → article → ligne d'achat → PO → (preuve fournisseur, facture et paiement) / réception physique → affectation → colis client/KOM-BOX → expédition → relais → remise client.

Les commandes locales contournent le Hub ; traitement direct au relais.

## 2. Inventaire d'écran existant : preuves du code (main du 2 novembre)
| Surface | Route | Base existante / risque |
|---|---|---|
| Achats fournisseurs | `/admin/workspaces/purchasing` | `public/dashboards/canonical/js/purchasing-workspace.js`, le regroupement et les actions PO sont déjà ici ; PR #3273 modifie ce fichier. |
| Hub Live | `/admin/hub-live?view=execute` | `public/dashboards/canonical/js/operations-workspace.js` sert les vues d'exécution ; `hub-live.js` contient aussi l'ancien cockpit lecture seule. Éviter deux vérités UX. PR #3243 modifie `hub-live.js`. |
| Navigation | `navigation-policy-v4.js` | Les achats sont dans Opérations et Hub Live dans Live ; la navigation / l'accès de la directrice doivent être alignés avec les capacités autorisées. |
| Dossier | `GET /api/hub/dossier`, `GET /api/hub/trace` | `hub-procurement-dossier.js` fournit une projection en lecture seule (à étendre si les flux financiers ne sont pas présents). |
| Finance | `/admin/workspaces/accounting` | Exploiter les faits comptables/proofs existants ; **pas** de nouveau ledger improvisé dans le frontend. |

**PRs concurrentes visibles au 2 novembre :** #3273 (achats manuels / fournisseurs locaux, touche `purchasing-workspace.js`), #3271 (Relais Live), #3238 (achats), #3243 (Hub Live). Ne pas les modifier indirectement par ce chantier UX.

## 3. Structure des deux postes de travail

### Branche administrative — espace Achats fournisseurs
**Un seul poste de travail** (pas de troisième dashboard indépendant), avec filtres marché/Hub et un bandeau compact de quatre nombres décisionnels :
1. Engagements à valider ;
2. Factures à rapprocher ;
3. Paiements à valider/échus ;
4. Écarts bloquants.

Navigation locale :
- **Besoins** : articles sans engagement, regroupement mono-marché, fournisseur suggéré/non imposé.
- **Ordres d'achat** : brouillons, validation de l'engagement par directrice, achat manuel ou API, preuve d'achat. L'agent peut préparer, pas approuver à sa place.
- **Factures & paiements** : fournisseur qui facture, référence facture, devise, montant, exigibilité, pièces, avances/paiements partiels, demande de paiement → validation directrice → paiement réellement exécuté et prouvé.
- **Rapprochement** : par PO et facture, **commandé / réceptionné / facturé / payé** ; écarts avec prochaine action, avoir, solde, dette, acompte ; clôture uniquement lorsque les obligations sont traitées.
- **Supervision** : uniquement situations nécessitant une décision, ni diagnostics techniques ni doublons d'alertes.

Disposition desktop : **liste de travail à gauche, dossier actif et action principale à droite**. Une seule action dominante par situation, pas de bouton abstrait « confirmer » en achat manuel.

### Branche opérationnelle — Hub Live
**Un atelier, pas un tableau de bord financier.** Une disposition gauche → droite cohérente, avec liste des dossiers et poste d'exécution contextualisé.
- **Dossiers** : commandes importées et leurs articles, liens vers PO et réceptions, reliquats et prochaine action réelle.
- **Réceptions** : PO attendues et colis fournisseurs ; saisir quantités physiques, contrôles et preuves, sans présumer que la quantité a été emballée.
- **Préparation & KOM-BOX** : affectations, colis client, unités physiques et contenu déroulable article → commande ; contrôle de double placement.
- **Expéditions** : KOM-BOX réellement liés, expédition ouverte, preuve de remise au transitaire.
- **Écarts physiques** : quarantaine, articles manquants/incorrects et suites ; retour au dossier achat sans action financière depuis Hub Live.

La chronologie détaillée est consultable à la demande ; ne pas ajouter une série de cartes ou de KPI de bas de page. Le statut est déduit des événements autoritatifs, jamais choisi arbitrairement dans l'UI.

## 4. Contrats d'autorité / finance
- Le navigateur n'invente ni coûts, ni dettes, ni quantités ; **projection serveur**.
- Historique des validations : acteur, rôle, horodatage, montant, devise, version de l'engagement, pièce et contexte d'autorisation. Ne pas confondre auteur de la PO, approbateur et exécutant du paiement.
- Une PO engagée peut être facturée en plusieurs fois ; une facture peut être réglée en plusieurs paiements. Acompte avant réception permis et conservé comme avance / montant à rapprocher.
- Les montants ne sont pas additionnés entre devises sans conversion FX légitime (taux/source/date), conserver montants originaux.
- La réception partielle ne solde pas automatiquement les reliquats ; les remboursements / avoirs sont identifiables.
- Les coûts N1 réels (fret, douane, manutention) sont connus a posteriori au niveau expédition. **Ne pas imposer une répartition uniforme artificielle par SKU.**
- Vérifier les mécanismes existants `supplier_execution`, `supplier-payment-state`, `supplier-payment-proof-persistence`, avant d'ajouter une table/écriture.
- Les droits effectifs de la **directrice du Hub** nécessitent un contrat de capacité serveur explicite ; ne pas utiliser simplement un libellé client pour accorder des permissions.

## 5. Navigation et communication
- Toujours garder le contexte marché, fournisseur, PO / commande et retour à la liste initiale.
- Dossier commun : identifiants PO et commandes accessibles dans les deux branches, mais actions différentes suivant rôle/capacité.
- En cliquant sur un écart, ouvrir la partie responsable : financier dans Achats ; physique dans Hub Live.
- Ne pas déplacer le cash client/relais ici : il appartient à Relais Live.
- Aucun compteur « emballé / expédié / reçu » ne dérive de la simple commande payée ; vérifier la réalité sur `hub_physical_unit_placements`, expéditions et scans relais.

## 6. Découpage pour éviter les conflits Sonnet
**Phase UX intégrée isolée (cette PR) :** nouvelle route `/admin/hub`, module `hub-workstation.js` et feuille CSS, entrées du routeur et de la navigation. File réelle à gauche : lecture `GET /api/hub/dossier?market=` pour dossiers import et PO marché ; `GET /api/purchasing` pour la liste PO globale sans marché explicite. Sélection PO : `?po=` et remontage du vrai workspace achats ; sélection commande : ouverture du vrai dossier `<details data-hub-order>` dans le workspace d'exécution. Composition sans modifier les writers ni leur API. Les fichiers `purchasing-workspace.js`, `operations-workspace.js` et `hub-live.js` restent inchangés.
**Après stabilisation backend des PR Sonnet :** intégrer d'abord l'administratif dans `purchasing-workspace.js`, puis l'opérationnel dans l'écran d'exécution canonique ; garder un seul parcours Hub Live. Adapter les capacités serveur et la navigation seulement après vérification des rôles.
**Après câblage :** tests PostgreSQL de rapprochement, Playwright Chromium 1440 des deux colonnes, E2E du dossier partagé, tests des refus 403 et des doubles clics/paiements.

## 7. Recettes obligatoires
1. Agent prépare PO manuelle pour SKU API ; directrice valide l'achat, preuve d'achat hors API.
2. Facture 10 unités, réception 8, paiement différé à 30 jours : solde dû, reliquat et écarts visibles, aucune clôture prématurée.
3. Acompte payé pour 10, 8 reçus, 2 annulés : avoir ou remboursement tracé ; pas de double paiement.
4. Paiement validé mais non exécuté : la dette reste due ; un débit réel et sa preuve seuls changent l'état payé.
5. Réception Hub 8/10 → colis/box de 8 max → expédition réelle → réception relais constatée : aucun « emballé » fictif.
6. Directrice possède validations fournisseur, agent Hub ne les possède pas ; lecture et écriture contrôlées serveur.
7. Une commande locale ne déclenche aucune action Hub.
8. Pas de duplication de mouvements comptables : une seule source canonique pour chaque facture, paiement et flux physique.

## 8. Livrable visuel
**Mini-app réellement intégrée au shell Canonical** : `/admin/hub?branch=administrative` (admin) et `/admin/hub?branch=operations&market=KM` (admin/agent_hub). Branches en haut ; **liste des dossiers à gauche / espace d'action existant à droite**, avec recherche et rafraîchissement manuel de la file. Les actions du panneau droit déclenchent exclusivement les services canoniques existants. À ce stade, on conserve les onglets internes des deux workspaces : optimisation de leur présentation et réconciliation facture/paiement restent à livrer après Sonnet. La directrice du Hub n'a pas encore de capacité serveur spécifique ; aucune validation nouvelle n'est rendue opérante artificiellement.

**Critère GO :** démonstration des deux parcours sur API stabilisées, preuve réconciliation PO–facture–réception–paiement et E2E du Hub au relais. **Ce document ne vaut pas GO de production.**
