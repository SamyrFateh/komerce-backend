# Doctrine — Portail interne Komerce unifié

Statut : **ACTIVE / CANONIQUE**  
Domaine : `dashboard` / accès interne  
Décision : 2026-09

## 1. Une seule porte d’entrée

Komerce possède une seule porte d’entrée pour tous les utilisateurs internes :

```text
/admin
```

Le terme « Admin » désigne ici le **portail interne Komerce**, pas seulement le rôle `admin`.

Administration centrale, opérateurs pays, Hub, Relais, Transitaire, Finance, Sourcing, Support et futurs rôles internes utilisent le même point d’entrée et le même shell Canonical.

Les routes spécialisées (`/admin/workspaces/...`, Entity 360, etc.) restent des destinations et des deep-links, pas des systèmes d’accès séparés.

## 2. Flux canonique

```text
/admin
  ↓
session absente ?
  ↓ oui
authentification utilisateur + mot de passe
  ↓
session authentifiée
  ↓
résolution serveur du contexte utilisateur
  ↓
identité + rôle + scopes + Market ID(s) + capabilities
  ↓
construction du shell Canonical
  ↓
affichage uniquement des onglets, workspaces et actions autorisés
```

Une URL ne confère jamais un droit et ne détermine jamais à elle seule un marché.

## 3. Authentification ≠ autorisation

La connexion authentifie l’identité. Elle ne doit pas porter sa propre matrice métier parallèle.

Après authentification :

- le runtime Canonical vérifie que le compte appartient au portail interne ;
- le serveur résout le rôle, les scopes et les Market IDs autorisés ;
- la navigation visible reflète les permissions réelles ;
- toute lecture ou mutation sensible est revalidée côté serveur.

Le frontend ne devient jamais une frontière de sécurité.

## 4. Contexte serveur

Le modèle cible est conceptuellement :

```text
user
role
scope
allowedMarkets
defaultMarket
capabilities
navigation
```

Les structures réelles peuvent rester réparties entre `/api/auth/me`, AdminContext et les projections des workspaces tant que :

1. le serveur reste l’autorité ;
2. le navigateur ne fabrique aucun scope ;
3. les Market IDs proviennent du serveur ;
4. la navigation ne promet jamais une surface que le guard serveur refuse ;
5. les capabilities d’action sont contrôlées à nouveau lors de la mutation.

À terme, la navigation doit préférer des capabilities serveur suffisamment granulaires au filtrage uniquement basé sur `user.role`.

## 5. Navigation unique, contenu contextuel

Le shell est le même pour tous. Seuls les onglets et actions changent.

| Profil | Surfaces principales possibles |
|---|---|
| `admin` | Pilotage, Commerce, Atelier économique, Catalogue, Marchés, Paramètres, Opérations, Expéditions & Douane, Sourcing, Comptabilité |
| `market_operator` | Pilotage marché, Commerce marché, Atelier économique, Marchés, Opérations autorisées |
| `agent_hub` | Opérations Hub, Expéditions & Douane selon guard |
| `agent_relais` | Opérations Relais, Comptabilité/dépôts selon guard |
| `agent_transitaire` | Expéditions & Douane |
| `finance` | Comptabilité / Finance autorisée |
| `sourcing` | Sourcing |
| `support` | Surface Support Canonical à finaliser ; aucune fausse autorisation ne doit être inventée entre-temps |

Cette table décrit l’UX, pas la frontière de sécurité.

## 6. Market ID et périmètre

### Utilisateur mono-marché

Le marché autorisé découle du contexte serveur. L’utilisateur ne choisit pas arbitrairement son pays avant de commencer à travailler.

Exemples : manager Cameroun, Hub Cameroun, Relais Cameroun.

### Utilisateur multi-marchés / central

Le shell peut proposer un sélecteur Market ID parmi les marchés autorisés.

Un workspace d’action market-scopé n’agit jamais en contexte global si son contrat exige un marché explicite.

## 7. Landing canonique

`/admin` est l’unique URL à communiquer aux utilisateurs internes.

Après authentification, le portail choisit la première surface réellement autorisée et utile :

| Rôle | Landing cible |
|---|---|
| `admin` | `/admin/pilotage` |
| `market_operator` | `/admin/pilotage` |
| `finance` | `/admin/workspaces/accounting` |
| `sourcing` | `/admin/workspaces/sourcing` |
| `agent_hub` | `/admin/workspaces/operations` |
| `agent_relais` | `/admin/workspaces/operations` |
| `agent_transitaire` | `/admin/workspaces/shipping-customs` |
| `support` | surface Canonical Support à finaliser |

Les deep-links restent valides : sans session, l’utilisateur s’authentifie puis revient sur la destination si son contexte l’autorise ; sinon le shell l’envoie vers sa landing autorisée.

## 8. Hub, Relais et autres rôles terrain

Hub et Relais ne sont plus pensés comme des portails distincts.

Le Workspace Operations conserve la séparation des responsabilités :

- Hub : commander, répartir, expédier, affecter l’inventaire selon capabilities ;
- Relais : encaisser, réceptionner, remettre au client selon capabilities ;
- Admin : capacités prévues par les guards ;
- MarketScope : toujours vérifié indépendamment du rôle.

Même principe pour Transitaire, Finance et Sourcing.

## 9. Authentification renforcée / OTP — extension prévue

Le portail unifié doit pouvoir recevoir une seconde étape d’authentification sans changer son architecture.

Deux usages sont prévus :

1. **confirmation de session / nouvel appareil** : après utilisateur + mot de passe, demander un OTP avant d’ouvrir la session interne ;
2. **step-up authentication** : demander un OTP uniquement avant une action sensible, par exemple gestion des utilisateurs et droits, délégation pays, paramètres critiques, activation de prix, finance ou opérations à fort impact.

L’OTP est une **preuve supplémentaire d’identité**, jamais une source de rôle, de Market ID ou de capability.

Le choix du canal OTP et la politique d’activation feront l’objet d’un chantier sécurité séparé. Le delta actuel ne doit pas dépendre de cette future étape.

## 10. Legacy et anciennes entrées

Pendant la convergence :

- les anciennes URLs peuvent rediriger vers leur surface Canonical équivalente ;
- `?legacy=1` peut rester un rollback explicite lorsqu’il existe déjà ;
- aucun nouveau développement métier ne doit recréer un portail parallèle ;
- toute nouvelle surface interne doit s’intégrer au shell Canonical et à sa navigation contextuelle.

La cible finale est : **un shell interne, une authentification, une politique de contexte, plusieurs capabilities**.

## 11. Invariants non négociables

1. **Une porte d’entrée interne : `/admin`.**
2. **Authentifier d’abord, autoriser ensuite.**
3. **Le backend reste l’autorité de rôle, scope, marché et mutation.**
4. **L’URL n’accorde aucun droit.**
5. **Le frontend ne fabrique jamais un Market ID ni une capability.**
6. **La navigation visible est un sous-ensemble des permissions serveur réelles.**
7. **Un workspace d’action market-scopé agit toujours sur un marché explicitement autorisé.**
8. **Aucun rôle métier ne nécessite un portail parallèle.**
9. **Les deep-links sont des destinations, pas des systèmes d’authentification distincts.**
10. **Un fallback Legacy silencieux ne remplace jamais une surface Canonical attendue.**
11. **Un futur OTP renforce l’identité ; il ne modifie jamais les droits métier.**

## 12. État du delta — chantier 2026-09-09

### Déjà acquis avant ce chantier

- `/admin` sert déjà `public/dashboards/canonical/index.html`.
- `canonical/js/app.js` accepte déjà `admin`, `market_operator`, `finance`, `sourcing`, `agent_hub`, `agent_relais`, `agent_transitaire`, `support`.
- les landings métier existent déjà dans `ROLE_DEFAULT_LANDING` pour Finance, Sourcing, Hub, Relais et Transitaire.
- `navigation.js` filtre déjà les onglets selon les rôles et les guards serveur connus.
- Operations, Shipping/Customs, Sourcing et Accounting existent déjà comme workspaces Canonical.
- les workspaces d’action sont déjà market-scopés et réautorisés côté serveur.
- les deep-links non authentifiés conservent déjà leur destination via `?next=`.

### Delta livré par ce chantier

1. **Login commun** — la page de connexion ne maintient plus une allowlist locale limitée à `admin` + `market_operator`; elle authentifie puis laisse le runtime/API appliquer les droits.
2. **Entrée simple `/admin`** — après login, l’utilisateur est envoyé vers la landing métier déjà déclarée ; un deep-link explicite reste conservé.
3. **Session déjà ouverte** — le boot Canonical applique la même landing depuis `/admin` avant de charger un contexte inutile ou interdit au rôle.
4. **Finance** — le rôle `finance` peut résoudre le contexte Canonical nécessaire au Workspace Comptabilité ; les endpoints de données Dashboard restent protégés séparément par `requireMarketDashboardReadRole(['admin','market_operator'])`.
5. **Tests** — la landing `/admin` et la séparation « contexte disponible ≠ dashboard autorisé » sont couvertes.

### Delta fonctionnel restant, volontairement séparé

- `support` n’a pas encore de surface Canonical dédiée ni d’accès prouvé à un contexte métier utile : ne pas afficher un faux onglet ni élargir artificiellement un guard.
- la projection serveur de capabilities reste trop grossière pour remplacer partout `ROLE_VISIBLE_TABS`; la migration capability-driven est une amélioration ultérieure.
- l’OTP est prévu par cette doctrine mais constitue un chantier sécurité ultérieur.

## 13. Références

- `docs/admin-nav-capability-map.md` — routes, rôles et guards vérifiés.
- `docs/contract/OPERATIONS_WORKSPACE_4A.md` — séparation Dashboard / Workspace, MarketScope et responsabilités Hub/Relais.
- `public/dashboards/canonical/js/app.js` — boot, session, contexte et landings.
- `public/dashboards/canonical/js/navigation.js` — navigation role-aware.
- `public/js/login.js` — authentification commune.
- `bootstrap/html-routes.js` — `/admin` et routes Canonical stables.
