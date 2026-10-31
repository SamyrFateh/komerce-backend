# Audit Back-office Komerce — fiches 360, pages profondes, onglets et parcours
**31 octobre 2026 · périmètre Desktop 1440 × 900 · statut : AUDIT DE CODE + capture utilisateur, certification Chromium staging NON EXÉCUTÉE pour ce lot.**

## 0. Méthode et verdict
Sources vérifiées : `bootstrap/html-routes.js`, `public/dashboards/canonical/js/app.js`, `navigation-policy-v4.js`, renderers de Commandes, Commerce, Client Index, quatre Entity 360, Catalogue, Sourcing Live, Sourcing Workspace, Hub/Relais, Achats ; guards API des quatre Entity 360 ; contrats `ORDER_360_3A`, `CLIENT_360_3B`, `CLIENT_INDEX_4I`, `CANONICAL_NAVIGATION_MATRIX`; audit historique `BACKOFFICE_CANONICAL_GAP` du 10 octobre. **Ce rapport ne prétend ni à une connexion navigateur réelle ni à l'exhaustivité des erreurs runtime.** Ne confondre aucune hypothèse métier avec une anomalie prouvée.

**Verdict : RECONCEPTION NAVIGATION/PRÉSENTATION JUSTIFIÉE, MAINTIEN DES SERVICES MÉTIER.** Il existe au moins quatre couches perceptibles : sidebar, rubriques supérieures, files internes, liens inter-domaines répétés au sein des dossiers 360. Le code contient des parentages incohérents et des surfaces profondes réellement utiles.

## 1. Défaut reproductible sur la capture Order 360
Trajet : `/admin/orders` → sélectionner commande → `/admin/orders/:reference?return_to=%2Fadmin%2Forders&return_label=...`.
- **Bug prouvé par code** : `app.js::surfaceForPath()` retourne `order-360`. `navigation-policy-v4.js::SURFACE_TO_SPACE['order-360']='commerce'` (ligne 145) et `activeLocalTab('orders','order-360')` tombe sur le `return 'commerce'` final (lignes 1180–1184). Le shell affiche « Vue d'ensemble » actif, et non « Commandes », alors que la sidebar sélectionne bien Commandes. Pour `client-360`, l'onglet Clients est correctement reconnu.
- **Double autorité apparente** : la même fiche affiche la sidebar « Commandes », les trois onglets « Vue d'ensemble / Commandes / Clients », le retour contextuel « Retour aux commandes », puis dans le héros « Opérations / Client 360 / Pilotage / Finance ». Un dossier ne doit pas devenir une nouvelle navigation globale.
- **Contradiction fonctionnelle** : `orders.js:225` promet « Les actions se font dans Order 360 et Opérations », tandis que `ORDER_360_3A.md` et `routes/admin-order-360.js` garantissent un **dossier read-only**. Montrer la prochaine action avec un lien vers le workspace propriétaire, pas promettre une mutation dans le 360.
- **Éparpillement** : `order-360.js` rend 7 KPI puis Position actuelle, Parcours, Commande, Articles, Coûts, Produits de la commande, Achats, Colis, Incidents, Historique, Scans, Notifications, Factures/documents, Commentaires. Les sections vides sont elles aussi créées. « Articles » et « Produits de la commande » sont deux blocs distincts de même matière (le second sert surtout de navigation).
- **Libellés bruts** : KPI `order.status` et `order.payment.status` (p. ex. `confirmed`, `pending`) sans traduction. Si `confirmed + payment pending` porte un vrai risque ou un scénario cash admissible, seule la vérité serveur doit le trancher. La commande `AUDIT-ND5VE6-PAYMENT-PENDING` observée doit faire contrôler `simulation_scope` ; ne **pas** conclure à un bug de paiement depuis une capture.

## 2. Inventaire des surfaces (routes et destination)
| Catégorie | Routes | Utilité / verdict |
|---|---|---|
| Pilotage | `/admin/pilotage`, `/admin/action-center` | **GARDER** cockpit général et file des signaux ; distincts de l'exécution |
| Commerce | `/admin/commerce` | **GARDER** analyses ventes/produits, pas commandes opérationnelles détaillées |
| Commandes | `/admin/orders` | **GARDER MAIS SIMPLIFIER** liste universelle, 6 files N3 ; fiche compacte en panneau ou drill |
| Clients | `/admin/clients` | **GARDER** recherche client, pas deuxième dashboard Commerce |
| Order 360 | `/admin/orders/:orderReference` | **GARDER** dossier d'investigation read-only, présentation condensée |
| Client 360 | `/admin/clients/:clientPhone` | **GARDER** identité, historique commandes, valeur client, marchés, timeline ; facettes global-only sous autorité |
| Product 360 | `/admin/products/:productRef` | **GARDER** fiche preuve/activité/stock/prix ; **NE PAS DUPLIQUER** la correction Catalogue ou la décision Prix marché |
| Supplier 360 | `/admin/suppliers/:supplierId` | **GARDER** preuve fournisseur, mappings, PO, exécution, paiements, profondeur depuis Sourcing/Achats uniquement (admin) |
| Économie | `/admin/workspaces/pricing`, `/admin/workspaces/catalog` | **GARDER** Prix & coûts et Catalogue maître, fonctions différentes |
| Opérations | `/admin/operations`, `/admin/workspaces/operations`, `/admin/workspaces/shipping-customs`, `/admin/workspaces/purchasing` | **GARDER** supervision, Hub/Relais, douane, achats ; supprimer la redondance des files |
| Live & sourcing | `/admin/import-runtime`, `/admin/workspaces/sourcing`, `/admin/hub-live`, `/admin/relais-live` | **CONSOLIDER LES POINTS D'ENTRÉE** ; monitoring différent du métier d'exécution |
| Marchés (standalone) | `/dashboards/canonical/access.html`, `market-autonomy.html`, `market-catalog.html` | **GARDER** contrôle accès et publication/prix marché, tester le shell hors index |
| Finance | `/admin/finance`, `/admin/workspaces/accounting` | **GARDER** vue décisionnelle et espace d'exécution comptable |
| Administration | `/admin/users`, `/admin/providers`, `/admin/settings` | **GARDER** utilitaires, pas onglets du commerce |
| Techniques profondes | `/admin/golden-e2e`, `/admin/demo` | **RÉSERVER AUX TESTS/DIAGNOSTICS** ; éviter une entrée métier permanente |
| Legacy encore requis | `/admin/customs`, `/admin/suppliers`, `/admin/sales`, `/admin/transitaire`, `/admin/sante`, `/admin/shared-carts`, `/admin/simulator` | **AUDITER PARITÉ AVANT FERMETURE** ; 7 points d'entrée Legacy déclarés par `html-routes.js` |
| Alias / rollback | `/admin/pricing*`, `/admin/products`, `/admin/categories`, `/admin/catalog-approval`, `/admin/sourcing*`, `/admin/alerts`, `/admin/problems`, `/admin/hub-relais`, `/admin/inventory`, `/admin/invoices`, etc. | **REDIRIGER**, ne jamais rendre une deuxième expérience ; `?legacy=1` = témoin de rollback, pas onglet |
| Route suspecte | `/admin/markets` | **GAP** : pas de route HTML explicite dans `html-routes.js` ; vérifier si un ancien lien ouvre la boutique par fallback |

### Dossiers 360 : matière à conserver et disposition
- **Order 360** : résumé statut/paiement/total ; position et prochain geste ; articles + lien produit dans une même liste ; destination et colis ; sections repliées Achats, Coûts, Incidents, Historique, Scans, Messages, Factures, Commentaires. Masquer les rubriques réellement vides derrière « Aucune pièce supplémentaire », sans falsifier zéro.
- **Client 360** : identité/contact masqué selon contexte ; valeur client/dernier achat/commandes ; liste des commandes vers Order 360 ; historique/événements ; facettes compte sensibles global-only. Supprimer les liens universels Commerce/Pilotage/Opérations du héros.
- **Product 360** : identité/stock/activité et chaîne des marchés ; preuves, coûts observés et fournisseurs en détails ; seul Catalogue modifie le produit et seul le Responsable marché décide prix/exposition.
- **Supplier 360** : identité/certifications + mappings ; PO/exécution/preuves sous détails, sans duplicata du workspace Achats.

## 3. Audit exhaustif des onglets repérés par code
| Surface | Rubriques visibles / mécanisme | Problème ou décision |
|---|---|---|
| Commerce global | `Vue d'ensemble / Commandes / Clients` dans `navigation-policy-v4.js::LOCAL_TABS.orders` | **Conserver ces 3 au niveau liste**, retirer la barre sur les 360 ; actif cohérent au clic |
| Commandes | `Toutes les files`, `Cash à confirmer`, `À commander`, `En attente réception Hub`, `Préparer le colis`, `À suivre/bloquées` dans `orders.js::TABS` | **Conserver comme filtres/segments N3**, pas seconde navigation métier ; bouton d'action propriétaire clair |
| Sourcing Live | `Suivi`, `Passages`, `Sources`, `Exceptions source` ; sous-vues `overview/exceptions/history/population/item/source/control/handoff/passages/sources` | **Réduire le rail utilisateur** à suivi des imports + exceptions nécessitant décision ; détails techniques sous « Informations » |
| Sourcing Workspace | `Sources & imports`, `Exceptions source`, `Fournisseurs` dans `sourcing-workspace.js` | **Chevauchement avec Live** ; pas 2 écrans pour résoudre la même exception ; conserver gestion source sous propriétaire Sourcing |
| Catalogue global | `Registre produits`, `Assortiment approuvé`, `Taxonomie boutique` dans `catalog-workspace.js` | **Maître unique des corrections**. Assortiment = filtre du registre ; Taxonomie = réglage ponctuel non utilisé pour chaque produit |
| Hub Live | `Flux Hub`, `Suivi`, `Exécution` | **Séparer observation et actes** ; éviter double « Exécution » avec Hub/Relais workspace |
| Relais Live | `Suivi`, `Colis` | Conserver si action attendue bien distincte ; mêmes états source autoritatifs |
| Hub & Relais workspace | vues `WORKSPACE_VIEWS / EXECUTION_VIEWS` + KPI des 7 files | **Rationaliser** autour des gestes physiques ; ne pas dupliquer les KPI Live |
| Achats fournisseurs | `À préparer`, `En cours`, `Historique` + fiche PO profonde `?po=...` | **Conserver**, une PO s'ouvre dans le même espace en conservant retour |
| Marchés | `Accès pays`, `Autonomie marché`, `Catalogue pays` selon rôle | **Conserver**, pas d'exposition marché dans le Catalogue global |
| Paramètres | `Règles`, `Taxes`, `Dimensions`, `Historique` | Onglets de configuration locale, pas menu N1/N2 |
| Order/Client/Product/Supplier 360 | pas de sous-onglets de dossier : longues sections et nav transverses dans héros | **3 zones max + détails repliables**, sans nouveaux onglets métier |

## 4. Incohérences d'architecture et d'habilitation
- **Deux modèles de navigation dans un même module** : `DOMAINS/SURFACE_TO_SPACE` (ancien N1/N2) et `SIDEBAR_GROUPS/LOCAL_TABS` (coque hybride). `buildHeader()` crée le premier, `applyHybridShell()` remplace le contenu : maintenir le double parentage multiplie les divergences.
- **Documentation dérivée obsolète** : `CANONICAL_NAVIGATION_MATRIX.md` décrit par exemple Sourcing sous Opérations, 7 N1 sans Live ; runtime `navigation-policy-v4.js` donne un groupe Live distinct. La visibilité de Clients pour `market_operator` est désormais pilotée par `client.read`, contrairement à une ligne du document historique. Choisir UNE matrice générée depuis runtime+guards.
- **Liens de fiche non conditionnés au contexte** : les en-têtes Order 360 (`Opérations`, `Pilotage`, `Finance`), Client 360 (`Commerce`, `Pilotage`, `Opérations`), Product 360 (`Commerce`, `Catalogue`, `Sourcing`, `Pricing`) codent des destinations sans preuve de capacité sur ces liens. Les routes API demeurent gardées, mais le clic peut mener à une destination non autorisée : test roles/capabilities obligatoire.
- **Contexte** : `return_to` est validé par `safeReturnTarget`, et le retour Order 360 depuis Commandes fonctionne sur la capture. Auditer chaîne `Commerce/Signal/Opérations → 360 → Client/Product/PO → retour original` avec marché, période, page et filtre. Le `clientPhone` dans l'URL nécessite prudence pour visibilité/logs ; ne pas exposer un lien non autorisé.
- **Données de tests** : contrôler `orders.simulation_scope` pour les références `AUDIT-*` vues dans les listes réelles. Si `NULL`, ce ne sont pas des tests isolés au sens des KPIs ; audit ciblé, jamais purge indiscriminée.

## 5. Parcours opérateur cible — moins d'écrans, zéro perte métier
1. **Commerce → Commandes** : liste unique + filtres d'état ; sélectionner la ligne ouvre dossier Commande (vue profonde ou panneau contextuel) ; en-tête « Commande {ref} », état réel, anomalie et **prochaine action** propriétaire.
2. **Dossier Commande** : 4 signaux maximum `Paiement / État commande / Affectation-colis / Livraison`; liste des articles avec référence cliquable ; client cliquable ; bouton contextuel « Traiter dans [Hub / Finance / Achats / Relais] » uniquement si droit serveur ; preuves/historique repliés. **Retour aux Commandes** rétablit filtres/marché/page.
3. **Clients → Client 360** : liste/recherche ; fiche client avec commandes consultables ; retour à la liste, sans nav concurrente « Pilotage/Commerce ».
4. **Sourcing Live → Catalogue maître → Prix marché → Publié** : l'API source et les étapes automatiques restent sans gestes superflus ; seul défaut ou manquant se résout dans Catalogue ; dernier prix et interrupteur de publication restent dans Catalogue marché, pas dans Product 360.
5. **Hub/Relais** : vision globale d'avancement et écarts ; transitions physiques au propriétaire, QR assisté ; liens de commande conservent le point de départ.

## 6. Ordre de correction et preuves de sortie
| Priorité | Action | Preuve nécessaire |
|---|---|---|
| **P0** | Requalifier la commande `AUDIT-ND5VE6-...` et toute cohorte `AUDIT-*` par `simulation_scope` ; ne pas confondre tests et activité réelle | Inventaire SQL en lecture seule, aucun vrai ordre touché |
| **P1-A** | Une seule fonction `parentTabForSurface` incluant `order-360 → orders` ; suppression ou neutralisation N2 global sur 360 ; fil d'Ariane + retour contextualisé | Tests unitaires des 4 dossiers 360 et contrôles `aria-current`, captures desktop |
| **P1-B** | Alléger Order 360 et Client 360 ; supprimer les liens universels du héros ; permissions vérifiées pour « Traiter dans… » | Preuve serveur + UI no-403, fonctions métier inchangées |
| **P1-C** | Retirer duplication de Sourcing et des autres rails N2/N3 ; une liste unique Catalogue et un circuit correction | Matrice clic → résultat de bout en bout avec de vrais produits |
| **P1-D** | Harmoniser États, alertes, gestes/owners, traduire `confirmed/pending` sans altérer le modèle métier | API→UI vérité conservée, pas de fausses actions ni faux zéros |
| **P2** | Consolider anciens points d'entrée/alias/Legacy, aligner documentation et matrice des droits | Génération contrôlée de routes ↔ N1/N2 ↔ capability ↔ parent |
| **CERTIFICATION** | Chromium staging **1440×900**, chaque rôle autorisé, pages directes et liens découverts, clic onglets ET boutons, rechargement, retour, erreurs JS/API 4xx/5xx, fenêtres vides, garde écriture, SKU fournisseur réel et ordres réels, SHA initial/final | Rapport captures + JSON `tests/staging-canonical/real-navigation.spec.js` étendu : suite existante explore `a[href]` mais ne garantit pas actif N2, choix des tabs boutons ou densité 360 |

### Gates
- Authentification de test disponible pour `admin`, `market_operator` avec/sans `client.read`, `sourcing`, `agent_hub`, `agent_relais`, `finance` ; les 403 attendus ne deviennent pas des faux écarts.
- Zéro mutation depuis le navigateur d'audit. Une vue 360 ne change jamais paiement, prix, statut, produit ou stock.
- Une entité = un dossier ; une action = un propriétaire ; un statut = une seule source serveur.
- Aucun GO visuel sans la **capture Chromium authentifiée** sur le SHA réellement déployé.


## 7. Coordination explicite avec les chantiers simultanés (état GitHub du 31/10/2026)

**Ordre d'intégration : code courant `main` → branches métier en cours → navigation partagée → fiches 360 → Chromium.**
Ce document n'autorise aucune réécriture des workspaces métier déjà décidés.

| Domaine | Référence vérifiée | Contrat gelé / précaution |
|---|---|---|
| Catalogue marché | PR #3185 fusionnée ; PR #3189 (droits Admin) fusionnée | Prix local, corridor, plancher et interrupteur publication décidés par marché. Ne pas déplacer ces actions vers Product 360, Catalogue global ou Moteur économique. |
| Sourcing → Raffinerie → Catalogue global | PR #3204 fusionnée, `docs/contract/SOURCING_CATALOGUE_MASTER_20261031.md` fait autorité | Une correction produit au Catalogue, Raffinerie diagnostic uniquement, Sourcing propriétaire des faits source. Ne pas ressusciter une file Raffinerie ni des éditions concurrentes. |
| Sourcing Live — navigation actuellement travaillée | Branche `fix/sourcing-live-actions-navigation-20261031`, divergente de `main`, touche `navigation-policy-v4.js` et `import-runtime.js` | Lire `docs/audits/SOURCING_LIVE_UX_AUDIT_20261031.md` sur cette branche ; sa cible est Sources / Passages / détail KIR (Suivi), jamais sept onglets. **Ne pas réécrire son menu dans cette PR 360.** Pas de commande de source depuis un KIR historique. |
| Catalogue — édition de catégorie | Branche `fix/catalogue-economic-category-direct-editor-20261031`, divergente, touche `catalog-workspace.js` et `index.html` | Laisser au Catalogue maître la correction contextuelle des catégories ; pas de doublon dans Product 360. Rebaser ou intégrer avant tout changement au shell commun. |
| Moteur économique | PR #3191, #3206, #3213 et #3217 fusionnées ; PR #3220 ouverte **draft** | Préserver les **trois colonnes non superposées**, édition en ligne de la charge concernée, dernière valeur visible, provenance groupe/marché, N3 audité. PR #3220 touche `index.html` / CSS / JS pricing / routes et schéma ; **éviter ces fichiers** depuis une branche navigation. |
| Hub/Relais | cockpits et workspaces distincts dans le runtime ; parcours physique/QR en cours de conception métier | Conserver les gestes physiques et preuves de transition. Une refonte du shell ne fusionne pas les services ni leurs droits. La décision de supprimer le domaine `Live` est **suspendue**, pas acquise, tant que les parcours Hub/Relais/Sourcing ne sont pas vérifiés. |
| Audit 360 | PR #3221 uniquement documentaire ; audit Chromium staging #3222 déclenché, résultat non encore attesté | Premier lot exécutable : Order 360 et Client 360, **sans éditer** `pricing-economic-cockpit.js`, `catalog-workspace.js`, `market-catalog.js`, `import-runtime.js`. Le fichier `navigation-policy-v4.js` ne doit être modifié qu'après intégration/rebase de la branche Sourcing Live. |

### Périmètre réduit du premier lot 360

- Page Commandes / fiche Order 360 / Client 360 : corriger onglet parent actif, conserver le `return_to` et les filtres, condenser les en-têtes, rendre les détails secondaires dépliables.
- Exploiter les facettes API existantes et respecter les rôles/capabilities ; **ne changer aucun calcul de statut/paiement/marge ni le contenu de la commande**.
- Aucune modification des flows Prix, Catalogue, Sourcing, Hub, Relais ni de leur index HTML pendant ce premier lot.
- Si la branche Sourcing Live est encore non intégrée : commencer par le renderer 360 et tests, puis faire le patch minimal du menu une fois son propriétaire stabilisé.
- Le chapitre « supprimer le domaine Live » du plan exploratoire est **à requalifier** ; préserver le Live opérationnel en cours, n'envisager son déplacement qu'après la preuve parcours et sans nouveau doublon.
- Démo/staging : aucune commande `AUDIT-*` interprétée comme commande réelle sans audit de `simulation_scope`.

**Critère coordination** : fichier partagé modifié par un seul lot à la fois, rebases explicites et aucun merge qui écrase la finition d'une autre équipe.
