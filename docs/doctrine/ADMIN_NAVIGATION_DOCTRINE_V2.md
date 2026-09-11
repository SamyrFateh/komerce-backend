# Doctrine Canonique — Navigation Admin Komerce V2

> Statut : **contrat produit / UI cible**
> Date : 2026-09-11
> Source d'autorité produit : `docs/doctrine/DOCTRINE_AUTONOMIE_RESPONSABLE_PAYS.md`.
> Source d'autorité sécurité d'exécution : guards backend réels + `docs/admin-nav-capability-map.md`.
> Référence visuelle : mock Komerce validé le 2026-09-11 (navigation métier à deux niveaux).

## 1. Décision produit

La navigation Admin Komerce ne doit plus exposer au même niveau les domaines métier et les workspaces spécialisés.

Le shell adopte une architecture stable à **deux niveaux** :

- **Niveau 1 = domaines métier stables** ;
- **Niveau 2 = espaces / workspaces du domaine actif** ;
- **zone utilitaire = contexte Market ID + compte + Paramètres + Déconnexion**.

Deux vérités doivent rester distinctes :

1. **la doctrine produit définit ce qu'un profil doit pouvoir faire dans son périmètre** ;
2. **le backend décide si l'action est effectivement autorisée aujourd'hui**.

Le frontend ne contourne jamais un guard. En revanche, **un guard manquant n'est pas une raison pour réduire silencieusement la doctrine produit** : c'est un delta d'implémentation à fermer avant d'exposer la destination dans l'UI.

La navigation ne doit donc ni inventer un droit, ni masquer durablement une responsabilité métier obligatoire simplement parce que le backend n'a pas encore livré la capability correspondante.

---

## 2. Niveau 1 — domaines canoniques

Ordre visuel stable :

1. `Dashboard`
2. `Atelier économique`
3. `Catalogue`
4. `Commandes`
5. `Marchés`
6. `Opérations`
7. `Finance`

`Paramètres` n'est plus un domaine métier. Il sort du flux principal et rejoint la zone utilitaire à droite.

### Règle de visibilité N1

À l'état livré, un domaine N1 est visible si l'utilisateur possède au moins **une destination serveur effectivement autorisée** dans ce domaine.

À l'état cible, le domaine doit être disponible dès lors que la doctrine attribue cette responsabilité au profil et que la tranche backend correspondante est livrée.

### Règle de landing d'un domaine

Au clic sur un domaine :

1. ouvrir sa vue d'ensemble si elle est autorisée pour le profil ;
2. sinon ouvrir le premier espace N2 autorisé selon l'ordre canonique du domaine.

Cette règle évite les landings qui chargent puis terminent en `403`.

---

## 3. Principe fondamental — le Responsable pays administre son marché

Le `market_operator` n'est pas un simple lecteur de Dashboard. Il est le **responsable opérationnel et commercial de son Market ID**.

Conformément à la doctrine d'autonomie pays :

> **Le responsable pays décide et exploite son marché. Komerce central définit les frontières du système, pas la stratégie commerciale locale.**

Il doit donc pouvoir, dans ses seuls marchés autorisés :

- voir et configurer **l'exposition / configuration de son catalogue pays** ;
- piloter ses **commandes** et son activité commerciale ;
- travailler dans l'**Atelier économique** et décider ses paramètres locaux autorisés ;
- voir et configurer les éléments pays de **douane** ;
- voir et configurer / superviser les **expéditions** de son marché ;
- voir son **Hub / Relais** et son réseau local ;
- accéder à la **Finance pays** : recettes, coûts, marges, rapprochements, justificatifs et paramètres financiers locaux livrés par les features ;
- gérer les fonctions de son marché sans obtenir pour autant une autorité globale ou cross-market.

Cette visibilité de pilotage/configuration **ne transforme pas le responsable pays en agent terrain**. Les gestes physiques ou irréversibles restent des capabilities spécialisées : scan, réception terrain, encaissement, pack, seal, ship, écriture comptable sensible, etc.

### Frontière central / pays

| Domaine | Autorité centrale | Responsable pays |
|---|---|---|
| Catalogue | vérité produit globale, source catalogue, structure globale | exposition, activation et configuration du catalogue **dans son marché** |
| Prix | règles communes, invariants et moteur | décision commerciale locale + hypothèses locales dans les gates |
| Douane | règles / référentiels globaux éventuels | visibilité et configuration opérationnelle douane de son marché |
| Expéditions | règles communes / intégrations globales | visibilité, supervision et configuration des expéditions de son marché |
| Finance | consolidation globale, autorités cross-market, règles communes | Finance pays, rapprochements, justificatifs, paramètres locaux et actions explicitement déléguées |
| Hub / Relais | invariants système | pilotage du réseau de son marché ; gestes terrain restent aux agents habilités |
| Paramètres | paramètres globaux Komerce | configuration locale du marché via les surfaces market-scoped, pas via l'autorité globale |

Le **catalogue global** et le **catalogue pays** ne doivent jamais être confondus. Donner `Catalogue` au Responsable pays ne signifie pas lui donner `requireCatalogGlobalAuthority` : cela signifie lui fournir une surface market-scoped fondée sur l'exposition produit × marché (`catalog.expose`) et les décisions locales autorisées.

---

## 4. Niveau 2 — espaces contextuels

Le niveau 2 n'apparaît que lorsqu'un domaine possède plusieurs destinations métier pertinentes.

### Domaine Catalogue

Pour `admin` :

- catalogue global / vérité produit selon l'autorité existante.

Pour `market_operator` :

- `Catalogue pays` — exposition des produits dans le Market ID, disponibilité / activation locale et paramètres locaux prévus par les features ;
- **jamais** mutation silencieuse de la vérité produit globale.

La surface market-scoped doit être livrée avant d'afficher cette destination au Responsable pays. Le service `catalog-market-exposure-service.js` constitue déjà la primitive métier à réutiliser ; il ne faut pas élargir aveuglément le workspace global admin-only.

### Domaine Opérations

Ordre canonique :

1. `Vue d'ensemble` → `/admin/operations`
2. `Hub / Relais` → `/admin/workspaces/operations`
3. `Expéditions & Douane` → `/admin/workspaces/shipping-customs`
4. `Sourcing` → `/admin/workspaces/sourcing`

Pour le Responsable pays, `Expéditions & Douane` est une responsabilité de **pilotage et configuration de son marché**. Le workspace peut garder un seul N2, mais doit rendre explicites à l'intérieur au minimum les deux sous-domaines :

- `Expéditions`
- `Douane`

Les actions physiques / spécialisées continuent d'être filtrées par capability et par rôle d'agent.

`Sourcing` reste séparé tant que sa délégation pays n'est pas explicitement tranchée ; cette doctrine ne l'accorde pas implicitement au Responsable pays.

### Domaine Finance

Ordre canonique :

1. `Vue d'ensemble` → `/admin/finance`
2. `Comptabilité / Finance pays` → `/admin/workspaces/accounting`

Le Responsable pays doit voir la **Finance de son marché**, même s'il n'est pas un comptable central : recettes, coûts, marges, rapprochements, justificatifs et configuration financière locale réellement livrée.

Les écritures, validations ou mouvements sensibles restent conditionnés à des capabilities explicites, auditables et market-scoped.

Pour les autres profils qui n'ont pas accès à la vue d'ensemble Finance mais ont accès à Comptabilité, le domaine `Finance` reste visible et son landing devient directement `Comptabilité`.

### Autres domaines

`Dashboard`, `Atelier économique`, `Commandes` et `Marchés` restent pour l'instant des destinations directes. Ils ne reçoivent un N2 que lorsqu'il existe plusieurs espaces canoniques réels et autorisés à regrouper.

---

## 5. Zone utilitaire droite

Ordre recommandé :

1. sélecteur `Market ID` / marché actif ;
2. rôle / compte courant ;
3. `Paramètres` si autorisé ;
4. `Déconnexion`.

### Market ID

Le Market ID est un **contexte transverse**, jamais un domaine métier.

Le contrôle reste visible sur les surfaces market-scopées et pilote le sélecteur canonique existant ; les APIs serveur continuent de revalider le scope.

### Paramètres

`Paramètres` global reste réservé à l'autorité globale (`admin` actuellement).

La configuration **locale** du Responsable pays ne doit pas être forcée dans ce bouton global : elle appartient aux domaines correspondants (`Catalogue`, `Marchés`, `Opérations`, `Finance`, etc.) et reste market-scoped.

---

## 6. Matrice canonique profils → navigation cible

Cette matrice décrit la **cible produit**. Si une cellule cible n'a pas encore de guard / endpoint compatible, elle devient un delta backend explicite à fermer avant affichage.

| Profil | N1 cibles | N2 / destination cible | Landing canonique |
|---|---|---|---|
| `admin` | Dashboard, Atelier économique, Catalogue, Commandes, Marchés, Opérations, Finance | Opérations : Vue d'ensemble, Hub / Relais, Expéditions & Douane, Sourcing. Finance : Vue d'ensemble, Comptabilité. Catalogue global. Paramètres global en utilitaire. | `/admin/pilotage` |
| `market_operator` — Responsable pays | **Dashboard, Atelier économique, Catalogue, Commandes, Marchés, Opérations, Finance** | Catalogue : **Catalogue pays**. Opérations : Vue d'ensemble, Hub / Relais, **Expéditions & Douane**. Finance : **Vue d'ensemble pays + Finance/Comptabilité pays**. Pas de Sourcing implicite. Pas de Paramètres globaux. | `/admin/pilotage` |
| `finance` | Finance | Comptabilité selon guard réel ; pas de Dashboard unifié tant que non autorisé. | `/admin/workspaces/accounting` |
| `sourcing` | Opérations | Sourcing uniquement tant que ses guards restent spécialisés. | `/admin/workspaces/sourcing` |
| `agent_hub` | Opérations | Hub / Relais + Expéditions & Douane selon guards ; gestes Hub selon capabilities. | `/admin/workspaces/operations` |
| `agent_relais` | Opérations, Finance | Opérations → Hub / Relais ; Finance → Comptabilité selon guards. | `/admin/workspaces/operations` |
| `agent_transitaire` | Opérations | Expéditions & Douane ; actions transit/douane selon capabilities. | `/admin/workspaces/shipping-customs` |
| `support` | aucune surface Canonical prouvée à ce jour | Reste hors du shell Canonical tant qu'un workspace Support dédié et guardé n'existe pas. | landing Legacy / surface support existante |

### Différence entre cible produit et état actuel

Le code serveur actuel est plus restrictif que cette cible sur plusieurs axes du Responsable pays :

- workspace catalogue global : `admin` only — **normal pour le global**, mais il manque la projection Catalogue pays ;
- workspace Expéditions & Douane : le guard actuel n'inclut pas encore `market_operator` ;
- workspace Comptabilité / Finance : le guard actuel n'inclut pas encore `market_operator` ;
- certaines vues peuvent exister mais ne distinguent pas encore assez finement lecture/configuration pays et exécution spécialisée.

Ces écarts sont des **gaps d'implémentation**, pas une décision de retirer Catalogue, Douane, Expéditions ou Finance au Responsable pays.

---

## 7. Principe capability-first

La cible n'est pas de conserver un gros `ROLE_VISIBLE_TABS` codé en dur.

Le backend doit exposer des capabilities granulaires. Exemple de projection cible :

- `dashboard.read`
- `pricing.read`
- `pricing.decide.local`
- `catalog.global.manage`
- `catalog.market.read`
- `catalog.market.configure`
- `catalog.expose`
- `orders.read`
- `markets.read`
- `operations.overview.read`
- `operations.hub.read`
- `operations.hub.configure`
- `operations.shipping.read`
- `operations.shipping.configure`
- `operations.customs.read`
- `operations.customs.configure`
- `operations.sourcing.read`
- `finance.overview.read`
- `finance.market.read`
- `finance.market.configure`
- `finance.accounting.act`
- `settings.global.manage`

Le frontend ne fait alors que projeter ces capabilities dans les domaines N1 et espaces N2.

**Le rôle décrit une fonction ; la capability autorise une action / surface ; le Market ID borne l'effet.**

Le Responsable pays reçoit les capabilities de pilotage/configuration de son marché. Les agents spécialisés reçoivent les capabilities d'exécution correspondant à leur métier.

---

## 8. Contrat visuel du shell

### Desktop

- barre N1 sombre, premium, stable ;
- `KOMERCE` à gauche ;
- maximum 7 domaines métier au centre ;
- utilitaires ancrés à droite ;
- N2 dans une ligne claire immédiatement sous N1 ;
- aucun scroll horizontal invisible pour masquer une entrée métier ;
- aucun workspace spécialisé ajouté au N1 pour résoudre un problème de place.

### État actif

- N1 actif : contraste texte + indicateur bleu fin ;
- N2 actif : pill / fond bleu clair discret ;
- éviter les gros blocs lourds qui donnent l'impression d'un bouton plutôt que d'une navigation.

### Responsive

- le N1 ne doit jamais être tronqué silencieusement ;
- le N2 peut devenir scrollable horizontalement sur petit écran car il est contextuel et local ;
- sur mobile étroit, les utilitaires peuvent être regroupés dans un contrôle compte, mais le Market ID actif reste identifiable ;
- l'ordre métier reste identique quel que soit le viewport.

---

## 9. Active state et parentage des surfaces

Chaque surface doit déclarer son parent N1.

Exemples :

- `/admin/workspaces/operations` → N1 `Opérations`, N2 `Hub / Relais`
- `/admin/workspaces/shipping-customs` → N1 `Opérations`, N2 `Expéditions & Douane`
- `/admin/workspaces/sourcing` → N1 `Opérations`, N2 `Sourcing`
- `/admin/workspaces/accounting` → N1 `Finance`, N2 `Comptabilité`
- `/admin/workspaces/pricing` → N1 `Atelier économique`
- `/admin/commerce` → N1 `Commandes`
- `/dashboards/canonical/access.html` et `/dashboards/canonical/market-autonomy.html` → N1 `Marchés`

Pour `Catalogue`, la surface globale existante reste admin-only. Une destination `Catalogue pays` doit être market-scoped avant d'être branchée au N1 Catalogue du Responsable pays.

Un workspace ne devient plus artificiellement un onglet N1 simplement parce qu'il existe techniquement.

---

## 10. Tests obligatoires

La refonte n'est validée que si les tests suivants existent :

1. chaque profil voit exactement ses domaines N1 effectivement livrés ;
2. chaque profil voit exactement ses espaces N2 effectivement livrés ;
3. la matrice de tests signale comme **gap** toute capability cible Responsable pays non livrée ;
4. aucun lien visible n'aboutit à un `403` avec le rôle correspondant ;
5. le clic sur un domaine sans overview autorisé ouvre son premier enfant autorisé ;
6. `Paramètres` global n'apparaît que pour l'autorité globale ;
7. `support` n'est pas envoyé vers un faux Dashboard Canonical ;
8. active state correct pour chaque workspace ;
9. N1 non tronqué aux largeurs desktop cibles et avec scaling navigateur / Windows raisonnable ;
10. N2 responsive sans perte de destination ;
11. changement de Market ID conserve le domaine / workspace courant quand la destination reste autorisée ;
12. `market_operator` ne peut jamais lire / muter un autre marché ;
13. `market_operator` Catalogue pays ne peut jamais muter la vérité catalogue globale ;
14. `market_operator` peut lire/configurer ses flux Expéditions/Douane sans obtenir automatiquement les gestes terrain ;
15. `market_operator` peut lire sa Finance pays sans obtenir automatiquement les autorités comptables globales.

---

## 11. Plan d'implémentation

### Lot NAV-V2.0 — fermer les gaps d'autonomie pays

Avant d'afficher les nouvelles destinations au Responsable pays :

- fournir une surface / API **Catalogue pays** market-scoped, fondée sur les primitives d'exposition existantes ;
- séparer dans Expéditions & Douane les capabilities de lecture/configuration pays des actions spécialisées terrain ;
- ouvrir au Responsable pays la lecture/configuration market-scoped nécessaire de `shipping-customs` ;
- fournir au Responsable pays une vue **Finance pays** market-scoped et séparer lecture/configuration locale des actes comptables sensibles ;
- ajouter les tests d'isolation inter-marchés et d'audit correspondants.

### Lot NAV-V2.1 — contrat de données

- remplacer `PRIMARY_NAV` plat par `DOMAINS` ;
- ajouter les enfants `spaces` par domaine ;
- centraliser le mapping capability → destinations ;
- calculer `visibleDomainsFor()` et `visibleSpacesFor()` ;
- calculer `landingForDomain()`.

### Lot NAV-V2.2 — shell visuel

- rendre le N1 stable ;
- rendre le N2 contextuel ;
- déplacer Paramètres globaux dans les utilitaires ;
- conserver Market ID + rôle + déconnexion à droite ;
- supprimer le besoin de promouvoir les workspaces spécialisés en onglets N1.

### Lot NAV-V2.3 — routes / parentage

- mapper toutes les surfaces vers leur domaine + espace ;
- brancher la destination Catalogue pays sans élargir le catalogue global ;
- supprimer les anciens comportements de retour redondants sur les workspaces devenus enfants N2 ;
- conserver Retour uniquement pour les vrais drill-downs / Entity 360.

### Lot NAV-V2.4 — sécurité et tests

- tests unitaires par rôle et capability ;
- tests de routes visibles vs guards serveur ;
- tests responsive du shell ;
- gate dédiée empêchant l'ajout d'un lien de nav sans autorisation serveur prouvée ;
- gate dédiée empêchant qu'une responsabilité cible du Responsable pays disparaisse silencieusement de la matrice.

---

## 12. Non-objectifs et frontières

Cette refonte :

- n'accorde jamais une autorité cross-market au Responsable pays ;
- ne transforme pas le Responsable pays en agent Hub, relais, transitaire ou comptable ;
- ne donne jamais accès à la mutation du catalogue global sous couvert de Catalogue pays ;
- ne réintroduit aucune surface Legacy dans le shell Canonical ;
- ne transforme pas le Market ID en mécanisme d'autorisation client ;
- ne contourne jamais un guard backend.

Elle **doit en revanche** rendre effectivement accessibles les responsabilités pays prévues par la doctrine d'autonomie : Catalogue pays, Opérations, Douane, Expéditions, Finance pays, Atelier économique, Commandes, Marchés et pilotage.

---

## 13. Résumé contractuel

> **N1 = où suis-je dans Komerce ?**
>
> **N2 = que puis-je faire dans ce domaine ?**
>
> **Market ID = dans quel marché j'agis ?**
>
> **Le Responsable pays décide et configure son marché.**
>
> **Les agents exécutent les gestes spécialisés.**
>
> **Le backend borne et audite chaque action.**

Cette structure est la nouvelle référence pour toute évolution de la navigation Admin Komerce.