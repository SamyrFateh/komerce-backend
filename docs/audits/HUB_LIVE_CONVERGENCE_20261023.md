# Audit de convergence — Hub Live (23 octobre 2026)

**Statut : audit initial fondé sur deux captures réelles et le code `main` ; NON VALIDÉ VISUELLEMENT SUR CHROMIUM PAR CET AUDIT.**
**Périmètre :** `/admin/hub-live` : `view=flux|overview|queue|order|execute`, desktop/mobile, navigation + workflow, lecture vs action, rôle, marché.
**Autorité et invariants :** `docs/doctrine/DOCTRINE_LOGISTICS_CONTROL_CHAIN.md`, `docs/contract/DASHBOARD_CUTOVER_2.md`, `docs/doctrine/KOMERCE_NAVIGABILITE_CONTRAT_EXECUTABLE.md`.

## 1. Constat reproduit par les captures de l'exploitant

1. `?view=queue&tab=all` présente « Hub > Commandes », « Toutes les commandes », une table CLIENT/RELAIS/STATUT/PAIEMENT et une ligne « Commandée », payée, `0/1` article affecté, 0 colis. L'onglet est indifférencié de **Commerce > Commandes** (`/admin/orders`) ; ce sont pourtant deux questions différentes. Le statut client ne prouve pas une réception physique au Hub.
2. `?view=execute` affiche une bannière « Exécuter les opérations Hub », `CG · Congo`, puis « Hub · Commander », « Répartition » et « Expédier » avec d'immenses blocs vides, une action « Répartir ce marché » visible même lorsque la file est vide.
3. Sur ces captures, le sélecteur du shell indique « Global · Tous les marchés » tandis que la surface d'exécution indique « CG · Congo » : contradiction de **contexte affiché** à clarifier. Aucune fuite ou mutation hors marché n'est démontrée par une capture seule.
4. Sur la vue Commandes la grande zone blanche, le tableau seul, l'absence de fil physique et les multiples « Commandes » à différents niveaux ne permettent pas d'identifier le prochain geste Hub.

## 2. Cause structurelle prouvée dans le code

| Élément | Source exacte | Constat |
|---|---|---|
| Onglets N3 | `public/dashboards/canonical/js/navigation-policy-v4.js`, `localTabsForDomain` | Onglets `Flux Hub`, `Suivi`, `Commandes`, `Exécution` publiés comme pairs, bien que de natures différentes. |
| Vue physique / files | `public/dashboards/canonical/js/hub-live.js` + `live-kit.js` | Surface en lecture seule `kir-page`, `kir-hero`, `lk-table`. Les files `queue` rendent les commandes clients et non une population d'unités Hub ; la queue `all` se nomme « Commandes ». |
| Exécution | `public/dashboards/canonical/js/app.js` `isHubExecutionRequest()`, `renderHubExecutionShell()` | `view=execute` court-circuite `hub-live.js` et monte `operations-workspace.js` (`mode:'execution'`) via une autre coque, avec marché obligatoire. |
| Exécution métier | `public/dashboards/canonical/js/operations-workspace.js` | Réutilisation des POST de `/api/admin/workspaces/operations/market/{code}`; sections « Commander », « Répartir », « Expédier », réception fournisseur et stock à affecter. |
| Lecture physique globale | `services/hub-dubai-projection.js` | Le Hub central sert plusieurs marchés ; PO fournisseurs peuvent être globales. Les projections `expeditions_ready` et `groupage_en_cours` sont explicitement absentes, non égales à zéro. |
| Autorité d'accès | `routes/hub-dashboard.js` | `admin`/`agent_hub` lisent au global ; `market_operator` par marchés serveur autorisés. Ne jamais remplacer l'autorité serveur par `?market=`. |
| Tests actuels | `tests/unit/hub-live-journey.test.js`, `tests/e2e/hub-live-cockpit.spec.js`, `tests/e2e/hub-live-execution.spec.js` | Des tests verrouillent aujourd'hui un onglet autonome « Commandes » et le passage à l'UI Exécution ; ils testent surtout des payloads simulés. Adapter les attentes à la nouvelle doctrine. |

Le problème n'est **pas réparable correctement par une surcouche CSS**. Deux routes d'affichage hétérogènes sont juxtaposées sous une même navigation.

## 3. Frontières canoniques à conserver

- **Commerce > Commandes / Order 360 :** référence commande client, paiement, état commercial, historique et filiation. Seule source canonique de vérité de commande ; Hub Live ne recrée pas un second index de toutes les commandes.
- **Achats fournisseurs :** PO, achat et confirmation fournisseur ; « Commander » dans un workspace d'opérations n'équivaut pas à un bon de commande réellement émis. Ne pas présenter la transition d'état `mark-ordered` comme une réception Hub ou une PO prouvée.
- **Hub Live :** observation des entrées fournisseur / colis, unités physiques, contrôles/quarantaine, consolidation, sorties et exceptions. **Global par défaut si l'autorisation le permet** ; segmentation marché uniquement comme filtre de lecture serveur.
- **Workspace Opérations / gestes Hub :** saisie ou action physique sur les vrais objets : réception PO exacte, allocation, colis, expédition. La décision/écriture exige une autorité et un contexte explicites. Les liens depuis Hub Live ouvrent l'espace propriétaire avec `market`, `return_to` et objet présélectionné, sans dupliquer le moteur.
- **Expéditions & Douane :** transporteur, expédition internationale, dédouanement. **Relais Live :** réception et remise locale. Ni l'un ni l'autre n'est une étape à commander depuis la file de commandes clients du Hub.
- **Chaîne physique :** purchase line / PO → supplier execution → Hub receipt → identification / contrôle → allocation ou consolidation → outbound market parcel → transport → douane → relais, reliée sans rupture aux order_items clients.

## 4. Architecture d'écran cible proposée pour validation

**Une seule coquille visuelle Hub Live (titre, onglets, filtres, valeurs, état vide) :**
1. **Vue Hub** : KPI de réceptions attendues, unités reçues, contrôles/quarantaines, départs disponibles ; fraîcheur/provenance des chiffres et alertes.
2. **Réceptions** : commandes fournisseur et lignes physiques attendues/reçues/partielles/quarantaine. Drill vers PO/rapport de réception ; action de réception dans le Workspace propriétaire, si autorisée.
3. **Unités & préparation** : unités reçues et contrôlées, allocations par marché, stocks sans affectation, éventuels groupages ; ne pas créer d'agrégat physique sans autorité backend.
4. **Départs** : unités ou colis Market prêts/expédiés si prouvés ; liens directs vers Expéditions & Douane. Les indicateurs « prêt à expédier » et « groupage transport » restent « source indisponible » tant que le serveur ne sait pas les calculer.
5. **Exceptions** : liste concentrée et filtrable (quarantaine, partiels, blocages) uniquement sur faits disponibles, avec propriétaire / prochaine action / preuve.

**Supprimer des onglets de premier niveau** « Commandes » et « Exécution ». Conserver les anciennes URL entrantes via redirection ou vue de compatibilité :
- `?view=queue&tab=all` → **Commandes canoniques**, éventuellement filtrées sur les objets réels du Hub si un filtre serveur prouvé existe ; ne pas donner une fausse liste de réceptions.
- `?view=order&order=...` → **Order 360** avec `return_to` Hub Live et contexte complet.
- `?view=execute` → **Workspace Opérations : Hub**, avec sélection du marché et éventuel filtre/cible de travail ; pas de duplication de mutation.
- Les files `to_prepare|preparation|ready|blocked` demeurent accessibles en contexte de Suivi **uniquement** si utiles et sans refaire le rôle de `/admin/orders`.

Le nombre exact d'onglets et leur ordre doivent être confrontés **aux derniers mocks validés**, pas aux maquettes archivées.

## 5. Priorités, lots et garde-fous

### P0 — Contrat de contexte, navigation et vérité
- À tout instant, afficher sans ambiguïté `Global` ou `Marché X` ; si l'exécution exige un marché et que le shell est global, **demander une sélection explicite**, jamais « CG » implicite.
- Un seul propriétaire d'onglets et d'en-tête ; supprimer l'illusion de quatre modules équivalents.
- Supprimer le double index client « Commandes du Hub » comme destination primaire ; relier à `/admin/orders` et Order 360 avec retour contextualisé. Conserver les références de commande comme provenance physique, pas population Hub primaire.
- Aucun changement d'autorisation ni de scope serveur ; aucun POST de test sur la base partagée.

### P1 — Chaîne métier et tâches actionnables
- Partir des **PO, lignes d'achat et unités physiques**, pas de `orders.status` seul pour prétendre qu'une réception Hub est à exécuter.
- Dans l'exécution actuelle, conditionner l'affichage/état de « Répartir ce marché » à l'éligibilité prouvée ; si file vide, pas de bouton d'action trompeur.
- Vue synthétique en haut : travail à faire, nombre, exception, propriétaire, clic vers l'espace d'exécution concerné.
- Distinguer zéro observé, aucun fait, autorité absente, donnée inconnue, étape non applicable. Reprendre `gaps` de `hub-dubai-projection` sans compléter avec données fictives.

### P2 — Cohérence visuelle desktop et mobile
- Même header/nav/espacements que les autres écrans canoniques (couleurs Komerce actuelles, aucun bloc de deux hauteurs d'écran sans travail).
- Densité compacte quand la file est vide, pas de carte monumentale contenant une seule phrase.
- Table responsive : colonnes limitées à l'essentiel, noms lisibles ; détail latéral ou panneau. Écran 1440 et 390, pas de débordement horizontal de page.
- En tête de chaque sous-vue : répondre à une question précise, éviter le jargon technique et la répétition « Hub · ... » sans sens.

### P3 — Preuve et recette avant GO
- Produire matrice **source → KPI → objet → action → autorité → permission → écran** ; vérifier les véritables gaps serveur.
- Étendre les tests unitaires et Playwright : navigation, retours, market scope, rôles (admin / agent_hub / market_operator), files vides, états inconnus, absence de duplicate POST, chaîne PO→unité→colis→Order 360.
- Recette Chromium réelle sur Railway **après SHA déployé** desktop 1440, mobile 390, écrans Global/KM/CM/CG/DJ autorisés, lecture seule en staging partagé.
- Comparaison pixel/fonctionnalité aux **mocks récents** (si non accessibles, mentionner la limite, ne pas utiliser les archives comme oracle).
- Pas de fusion sans CI verte, revue fonctionnelle et verdict d'écran documenté ; pas de RESET, purge, production payment ou données factices en staging partagé.

## 6. Séquencement d'implémentation

1. **PR H1** : navigation, ownership des routes, scope explicite, compatibilité des anciennes URL et tests de retour.
2. **PR H2** : re-projection des populations physiques (PO/units/colis), contrats et marqueurs d'indisponibilité ; backend gap séparé si source manquante.
3. **PR H3** : harmonisation du langage visuel et responsive des sous-vues ; application aux états vides et files.
4. **PR H4** : scénarios Playwright/Chromium réels, preuves desktop/mobile, GO/NO GO métier. Ne pas confondre PASS Jest et réception utilisateur.

## 7. Critère final

Depuis Hub Live, l'opérateur doit savoir en quelques secondes :
- **Qu'est-ce qui arrive physiquement ?**
- **Qu'a-t-on reçu et contrôlé ?**
- **Qu'est-ce qui est en quarantaine ou non affecté ?**
- **Qu'est-ce qui peut partir, vers quel marché, et qu'est-ce qui bloque ?**
- **Où agir et avec quel droit ?**

L'utilisateur ne doit jamais se demander si « Commandes » désigne les commandes clients ou les PO, ni pourquoi « Exécution » change de produit visuel, ni pourquoi un filtre Global se transforme silencieusement en Congo.
