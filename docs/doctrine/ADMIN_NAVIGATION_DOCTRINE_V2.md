# Doctrine Canonique — Navigation Admin Komerce V2

> Statut : **contrat produit / UI cible**
> Date : 2026-09-11
> Source d'autorité sécurité : **guards backend réels** et `docs/admin-nav-capability-map.md`.
> Référence visuelle : mock Komerce validé le 2026-09-11 (navigation métier à deux niveaux).

## 1. Décision produit

La navigation Admin Komerce ne doit plus exposer au même niveau les domaines métier et les workspaces spécialisés.

Le shell adopte une architecture stable à **deux niveaux** :

- **Niveau 1 = domaines métier stables** ;
- **Niveau 2 = espaces / workspaces du domaine actif** ;
- **zone utilitaire = contexte Market ID + compte + Paramètres + Déconnexion**.

Le backend reste l'autorité : **l'UI n'affiche jamais une entrée qui n'est pas autorisée par un guard serveur réel**.

La navigation ne doit jamais inventer un droit pour rendre un mock plus joli. Si un profil n'a pas de surface Canonical autorisée, le shell ne lui montre pas un faux onglet.

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

Un domaine N1 est visible si et seulement si l'utilisateur possède au moins **une destination serveur autorisée** dans ce domaine.

Un domaine ne doit donc pas être visible simplement parce qu'un rôle possède le contexte Canonical.

### Règle de landing d'un domaine

Au clic sur un domaine :

1. ouvrir sa vue d'ensemble si elle est autorisée pour le profil ;
2. sinon ouvrir le premier espace N2 autorisé selon l'ordre canonique du domaine.

Cette règle évite les landings qui chargent puis terminent en `403`.

---

## 3. Niveau 2 — espaces contextuels

Le niveau 2 n'apparaît que lorsqu'un domaine possède plusieurs destinations métier pertinentes.

### Domaine Opérations

Ordre canonique :

1. `Vue d'ensemble` → `/admin/operations`
2. `Hub / Relais` → `/admin/workspaces/operations`
3. `Expéditions & Douane` → `/admin/workspaces/shipping-customs`
4. `Sourcing` → `/admin/workspaces/sourcing`

La visibilité de chaque entrée reste strictement alignée sur les guards réels.

### Domaine Finance

Ordre canonique :

1. `Vue d'ensemble` → `/admin/finance`
2. `Comptabilité` → `/admin/workspaces/accounting`

Pour les profils qui n'ont pas accès à la vue d'ensemble Finance mais ont accès à Comptabilité, le domaine `Finance` reste visible et son landing devient directement `Comptabilité`.

### Autres domaines

`Dashboard`, `Atelier économique`, `Catalogue`, `Commandes` et `Marchés` restent pour l'instant des destinations directes. Ils ne reçoivent un N2 que lorsqu'il existe plusieurs espaces canoniques réels et autorisés à regrouper.

---

## 4. Zone utilitaire droite

Ordre recommandé :

1. sélecteur `Market ID` / marché actif ;
2. rôle / compte courant ;
3. `Paramètres` si autorisé ;
4. `Déconnexion`.

### Market ID

Le Market ID est un **contexte transverse**, jamais un domaine métier.

Le contrôle reste visible sur les surfaces market-scopées et pilote le sélecteur canonique existant ; les APIs serveur continuent de revalider le scope.

### Paramètres

`Paramètres` est visible uniquement pour les profils autorisés côté serveur (`admin` actuellement). Il ne doit plus consommer de place dans le menu métier principal.

---

## 5. Matrice canonique profils → navigation

Cette matrice décrit **les droits aujourd'hui prouvés par les guards backend**. Elle corrige volontairement le mock visuel lorsque celui-ci montre une destination non prouvée côté serveur.

| Profil | N1 visibles | N2 / destination autorisée | Landing canonique |
|---|---|---|---|
| `admin` | Dashboard, Atelier économique, Catalogue, Commandes, Marchés, Opérations, Finance | Opérations : Vue d'ensemble, Hub / Relais, Expéditions & Douane, Sourcing. Finance : Vue d'ensemble, Comptabilité. Paramètres en utilitaire. | `/admin/pilotage` |
| `market_operator` — Responsable pays | Dashboard, Atelier économique, Commandes, Marchés, Opérations | Opérations : Vue d'ensemble + Hub / Relais. Pas Catalogue, pas Expéditions & Douane, pas Sourcing, pas Finance, pas Paramètres tant que les guards ne l'autorisent pas. | `/admin/pilotage` |
| `finance` | Finance | Comptabilité uniquement. **Pas de Dashboard Canonical tant que `dashboard/unified*` ne l'autorise pas.** | `/admin/workspaces/accounting` |
| `sourcing` | Opérations | Sourcing uniquement. **Pas de Dashboard Canonical aujourd'hui.** | `/admin/workspaces/sourcing` |
| `agent_hub` | Opérations | Hub / Relais + Expéditions & Douane. Pas de Vue d'ensemble tant que le dashboard unifié n'autorise pas ce rôle. | `/admin/workspaces/operations` |
| `agent_relais` | Opérations, Finance | Opérations → Hub / Relais ; Finance → Comptabilité. Pas de Dashboard Canonical aujourd'hui. | `/admin/workspaces/operations` |
| `agent_transitaire` | Opérations | Expéditions & Douane uniquement. Pas de Dashboard Canonical aujourd'hui. | `/admin/workspaces/shipping-customs` |
| `support` | aucune surface Canonical prouvée | Reste hors du shell Canonical tant qu'un workspace Support dédié et guardé n'existe pas. Ne pas afficher un faux Dashboard. | landing Legacy / surface support existante |

### Point de vigilance important

Le mock de direction montrait `Dashboard` pour tous les profils afin d'illustrer visuellement la matrice. **Ce n'est pas le contrat de droits.**

Le code serveur actuel réserve les données du Dashboard unifié à `admin` et `market_operator`. Les autres rôles ne doivent donc pas recevoir l'onglet `Dashboard` uniquement parce qu'ils peuvent charger le contexte Canonical.

---

## 6. Principe capability-first

La cible n'est pas de conserver éternellement un gros `ROLE_VISIBLE_TABS` codé en dur.

### Palier immédiat

Le shell peut continuer à partir du rôle, mais le mapping doit être structuré par **domaines + espaces** et correspondre exactement aux guards existants.

### Cible

Le backend expose des capabilities suffisamment granulaires, par exemple :

- `dashboard.read`
- `pricing.read`
- `catalog.read`
- `orders.read`
- `markets.read`
- `operations.overview.read`
- `operations.hub.read`
- `operations.shipping_customs.read`
- `operations.sourcing.read`
- `finance.overview.read`
- `finance.accounting.read`
- `settings.manage`

Le frontend ne fait alors que projeter ces capabilities dans les domaines N1 et espaces N2.

**Le rôle décrit une fonction ; la capability autorise une action / surface.**

---

## 7. Contrat visuel du shell

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

## 8. Active state et parentage des surfaces

Chaque surface doit déclarer son parent N1.

Exemples :

- `/admin/workspaces/operations` → N1 `Opérations`, N2 `Hub / Relais`
- `/admin/workspaces/shipping-customs` → N1 `Opérations`, N2 `Expéditions & Douane`
- `/admin/workspaces/sourcing` → N1 `Opérations`, N2 `Sourcing`
- `/admin/workspaces/accounting` → N1 `Finance`, N2 `Comptabilité`
- `/admin/workspaces/pricing` → N1 `Atelier économique`
- `/admin/commerce` → N1 `Commandes`
- `/dashboards/canonical/access.html` et `/dashboards/canonical/market-autonomy.html` → N1 `Marchés`

Un workspace ne devient plus artificiellement un onglet N1 simplement parce qu'il existe techniquement.

---

## 9. Tests obligatoires

La refonte n'est validée que si les tests suivants existent :

1. chaque profil voit exactement ses domaines N1 autorisés ;
2. chaque profil voit exactement ses espaces N2 autorisés ;
3. aucun lien visible n'aboutit à un `403` avec le rôle correspondant ;
4. le clic sur un domaine sans overview autorisé ouvre son premier enfant autorisé ;
5. `Paramètres` n'apparaît que pour `admin` ;
6. `support` n'est pas envoyé vers un faux Dashboard Canonical ;
7. active state correct pour chaque workspace ;
8. N1 non tronqué aux largeurs desktop cibles et avec scaling navigateur / Windows raisonnable ;
9. N2 responsive sans perte de destination ;
10. changement de Market ID conserve le domaine / workspace courant quand la destination reste autorisée.

---

## 10. Plan d'implémentation

### Lot NAV-V2.1 — contrat de données

- remplacer `PRIMARY_NAV` plat par `DOMAINS` ;
- ajouter les enfants `spaces` par domaine ;
- centraliser le mapping rôle/capability → destinations ;
- calculer `visibleDomainsFor()` et `visibleSpacesFor()` ;
- calculer `landingForDomain()`.

### Lot NAV-V2.2 — shell visuel

- rendre le N1 stable ;
- rendre le N2 contextuel ;
- déplacer Paramètres dans les utilitaires ;
- conserver Market ID + rôle + déconnexion à droite ;
- supprimer le besoin de promouvoir les workspaces spécialisés en onglets N1.

### Lot NAV-V2.3 — routes / parentage

- mapper toutes les surfaces vers leur domaine + espace ;
- supprimer les anciens comportements de retour redondants sur les workspaces devenus enfants N2 ;
- conserver Retour uniquement pour les vrais drill-downs / Entity 360.

### Lot NAV-V2.4 — sécurité et tests

- tests unitaires par rôle ;
- tests de routes visibles vs guards serveur ;
- tests responsive du shell ;
- gate dédiée empêchant l'ajout d'un lien de nav sans autorisation serveur prouvée.

---

## 11. Non-objectifs

Cette refonte ne :

- n'élargit aucun droit serveur ;
- ne change aucune stratégie pays ;
- ne modifie aucune logique économique ;
- ne réintroduit aucune surface Legacy dans le shell Canonical ;
- ne transforme pas le Market ID en mécanisme d'autorisation client ;
- ne crée pas de faux Dashboard pour les rôles opérationnels.

---

## 12. Résumé contractuel

> **N1 = où suis-je dans Komerce ?**
>
> **N2 = que puis-je faire dans ce domaine ?**
>
> **Market ID = dans quel marché j'agis ?**
>
> **Le backend décide si j'ai le droit de le faire.**

Cette structure est la nouvelle référence pour toute évolution de la navigation Admin Komerce.
