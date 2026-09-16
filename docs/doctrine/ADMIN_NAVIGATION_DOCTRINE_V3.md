# Doctrine Canonique — Navigation Admin Komerce V3

> Statut : **contrat produit / UI cible**
> Remplace la représentation du shell définie dans `ADMIN_NAVIGATION_DOCTRINE_V2.md`.
> Les règles d'autorité, de rôle, de capability et de Market ID de V2 restent valides sauf contradiction explicite ci-dessous.

## 1. Décision produit

Komerce adopte un **shell hybride unique** pour toutes les surfaces Canonical :

- **N1 = sidebar verticale persistante** : grands domaines métier stables ;
- **N2 = onglets horizontaux contextuels** : rubriques du domaine actif ;
- **N3 = contrôles locaux de la page** : filtres, segments, sous-vues, actions et drawers ;
- **topbar transverse** : recherche globale, Market ID, notifications, compte utilisateur ;
- **zone utilitaire basse de sidebar** : Paramètres et Déconnexion selon autorité.

Le shell est identique d'un dashboard à l'autre. Le contenu change ; l'environnement de navigation ne change jamais.

## 2. Règle de séparation N1 / N2 / N3

### N1 — domaines

N1 répond uniquement à : **« dans quel grand domaine de Komerce suis-je ? »**

Ordre canonique livré :

1. Dashboard
2. Atelier économique
3. Catalogue
4. Commandes
5. Marchés
6. Opérations
7. Finance

`Analyse` est réservé comme futur domaine et ne doit pas être affiché tant qu'une surface réelle + guard serveur n'existent pas.

`Paramètres` n'est pas un domaine métier : il reste utilitaire.

### N2 — rubriques du domaine actif

N2 répond à : **« dans quelle rubrique de ce domaine suis-je ? »**

Les rubriques sont affichées sous forme d'onglets horizontaux immédiatement au-dessus du contenu de page.

Exemples cibles :

- Catalogue : `Vue catalogue | Sources | Raffinerie | Produits | Boutique`
- Atelier économique : `Portefeuille | Coûts | Prix & contribution | Simulations`
- Commandes : `Vue d'ensemble | Commandes | Clients`
- Marchés : `Accès pays | Autonomie marché | Catalogue pays`
- Opérations : `Vue d'ensemble | Hub & Relais | Expéditions & Douane`
- Finance : `Vue d'ensemble | Comptabilité`

Une rubrique N2 ne doit pas devenir un N1 uniquement parce qu'elle possède une route technique.

### N3 — contexte local

N3 ne doit jamais être promu dans la navigation globale. Il contient :

- filtres ;
- recherche locale ;
- segments de vue ;
- sélection de période ;
- états / statuts ;
- actions métier ;
- drawers / modales ;
- drill-downs.

## 3. Sidebar N1

La sidebar est la colonne vertébrale visuelle de l'Admin Canonical.

### Desktop

- largeur cible : **176 px** ;
- position fixe/sticky sur toute la hauteur ;
- fond navy canonique ;
- marque `Komerce` en haut ;
- domaines N1 au milieu ;
- Paramètres / compte / Déconnexion en bas ;
- état actif sous forme de fond clair/indigo + accent fin ;
- aucune liste technique ou UUID ;
- aucune entrée grisée pour un droit absent : la destination est simplement absente.

### Responsive

- tablette : sidebar compacte autorisée ;
- mobile : drawer latéral ou rail compact ;
- l'ordre des domaines ne change jamais ;
- aucune destination autorisée ne doit disparaître par overflow silencieux.

## 4. Topbar transverse

La topbar n'est plus une navigation métier.

Elle contient uniquement :

1. recherche globale ;
2. Market ID / marché actif si applicable ;
3. notifications ;
4. compte / rôle courant.

Le Market ID est un **contexte transverse**, jamais un N1 ou N2.

## 5. N2 horizontal

Les onglets N2 sont intégrés à la page et non à la sidebar.

Contrat :

- une seule ligne ;
- soulignement / accent indigo pour l'actif ;
- pas de gros pills lourds ;
- scroll horizontal autorisé sur petit viewport ;
- le N2 est toujours dérivé d'un domaine N1 visible ;
- un N2 absent de l'autorité serveur n'est pas affiché ;
- **aucun onglet décoratif** : chaque N2 visible doit pointer vers une route Canonical réellement rendue ou une section locale réellement présente ;
- un changement de N2 local ne recharge jamais le document complet.

## 6. Rôles et autorité

Le frontend ne crée aucun droit.

La visibilité N1/N2 est une projection des guards/capabilities serveur actuels. Les responsabilités produit non encore supportées côté serveur sont des gaps backend explicites, jamais des droits frontend inventés.

La matrice actuelle reste `docs/CANONICAL_NAVIGATION_MATRIX.md` jusqu'à sa mise à jour par ce lot.

## 7. Parentage canonique

- `/admin/pilotage` → Dashboard
- `/admin/workspaces/pricing` → Atelier économique
- `/admin/workspaces/catalog` → Catalogue
- `/admin/commerce`, `/admin/orders`, `/admin/clients` → Commandes
- pages Canonical Marchés → Marchés
- `/admin/operations`, `/admin/workspaces/operations`, `/admin/workspaces/shipping-customs`, `/admin/workspaces/sourcing` → Opérations
- `/admin/finance`, `/admin/workspaces/accounting` → Finance

Les Entity 360 héritent du parent métier de leur entrée : Order/Client 360 → Commandes, Product 360 → Catalogue.

## 8. Invariant d'expérience

> **Un seul shell Komerce. Une seule sidebar. Une seule topbar. Des onglets N2 contextuels. Le contenu change, jamais l'environnement.**

Aucun dashboard ne doit créer sa propre navigation globale parallèle.

### Navigation sans flash

Dans le runtime Admin Canonical chargé par `index.html` :

- un clic N1/N2 vers une autre route `/admin/...` Canonical ne doit pas recharger le document complet ;
- la vue courante reste visible pendant que la cible est préparée hors DOM ;
- la cible ne remplace la vue visible qu'après un rendu réussi ;
- si le rendu cible échoue, l'ancienne vue et l'ancienne URL restent l'état de référence ;
- les tabs d'ancre (`#...`) utilisent l'historique navigateur et le scroll local, sans remount complet ;
- Back/Forward doit restaurer la bonne rubrique sans revenir à un shell intermédiaire.

Les pages Canonical encore standalone peuvent conserver une navigation documentaire tant qu'elles ne sont pas intégrées au runtime unique ; cette exception doit rester explicite et bornée. **Elles doivent toutefois résoudre la session et remonter le shell V4 avec l'utilisateur authentifié et son contexte serveur avant d'être considérées conformes. Un shell anonyme ou une page Canonical sans issue de navigation est interdit.**

## 9. Critères de conformité

Le lot est conforme si :

1. toutes les entrées Canonical utilisent le même shell ;
2. N1 est vertical ;
3. N2 est horizontal et contextuel ;
4. topbar = transverse uniquement ;
5. aucun droit serveur n'est élargi ;
6. Catalogue et Atelier économique suivent exactement le même chrome ;
7. les mocks validés sont traduits en contrat de style mesurable ;
8. les tests empêchent le retour à une top-nav N1 ou à une sidebar locale par dashboard ;
9. chaque tab visible a une cible réelle prouvée ;
10. la navigation interne au runtime Canonical est atomique et sans reload document ;
11. toute entrée Canonical standalone remonte le shell après résolution de la session et ne peut jamais devenir un cul-de-sac de navigation.
