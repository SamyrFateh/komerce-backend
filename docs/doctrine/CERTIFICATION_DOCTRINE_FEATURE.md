# Certification de la Doctrine Feature (Niveau 0)

> **Statut** : ✅ **TAMPONNÉE — production-ready avec 3 réserves de câblage**
> **Périmètre audité** : `komerce-feature-doctrine` v1.0 contre les 3 dépôts réels
> (`backend.zip` 847 fichiers, `boutique.zip` 214 fichiers, `dashboards.zip` 157 fichiers)
> **Méthode** : exécution réelle des gates, pas lecture du résumé. Chaque affirmation
> ci-dessous est vérifiée par une commande tournée contre le code livré.
> **Date** : 2026-06-26

---

## Verdict en une phrase

La doctrine est **conceptuellement juste et techniquement réelle** — le Niveau 0 existe
vraiment, les 16 manifests chargent, le registre tourne contre le vrai repo. Mais
**elle décrit un câblage CI qui n'est pas encore en place** : la doctrine dit « step 1, 2, 3
du job unit », la réalité du `ci.yml` ne l'exécute pas. Le sommet de la pyramide est posé ;
il n'est pas encore branché au courant.

---

## Ce qui est VRAI et solide (vérifié)

| Affirmation de la doctrine | Vérification | Verdict |
|---|---|---|
| Le Niveau 0 existe au-dessus de la pyramide qualité | `FEATURE_DOCTRINE.md` présent, hiérarchie cohérente | ✅ |
| 16 features cartographiées (14 métier + 2 transversales) | `feature-registry-check.js` → "Features 14, transversaux 2" | ✅ |
| Tous les manifests chargent sans erreur | 16/16 `require()` OK, 0 KO | ✅ |
| 0 fichier déclaré manquant sur disque | `Fichiers manquants : 0` | ✅ |
| Les références cross-repo boutique sont réelles | 6/6 fichiers `js/b-*.js` de shared-cart existent dans `bout` | ✅ |
| Le registre documente honnêtement sa dette | section "dette connue", 50 orphelins listés | ✅ |
| `quality:gate` bloque vraiment (`--strict` → exit 1) | testé : plain=0, strict=1 | ✅ |
| `feature-guard` tourne | exit 0 sur repo propre | ✅ |
| Le manifest impose `service` / `perimeter.out` / `authority` | champs présents et vérifiés par le script | ✅ |

Le travail de Sonnet n'est pas du vent. Le registre a été construit en grepant les vrais
headers `@domain`, pas inventé. C'est la fondation correcte.

---

## Les 3 angles morts (réserves de câblage)

### 🔴 RÉSERVE 1 — La doctrine décrit un CI fantôme

**Constat vérifié** : `QUALITY_PYRAMID_DOCTRINE.md` annonce que `quality:gate` et
`feature:registry` tournent comme « step 1/2/3 du job unit ». Le `ci.yml` réel du job `unit`
exécute uniquement : `backend:audit`, `audit:gate`, puis jest. **Ni `quality:gate` ni
`feature:registry` n'y figurent.** Aucun workflow `.github/` ne référence `feature-registry`.

**Conséquence** : aujourd'hui, un développeur peut casser le registre (ajouter un fichier
orphelin, désaccorder header et manifest) et le merge passera — le gate existe mais ne
garde aucune porte. La doctrine est respectée en local par discipline, pas par contrainte.

**Correctif** (fourni ci-dessous) : ajouter 2 steps au job `unit` du `ci.yml`.

### 🟠 RÉSERVE 2 — Les références cross-repo sont documentées mais jamais vérifiées

**Constat vérifié** : `feature-registry-check.js` ne valide l'existence des fichiers que
contre l'arbre backend. Les `repos.boutique` / `repos.dash` des manifests sont du texte
libre, non audité. Les 6 fichiers boutique de shared-cart existent *aujourd'hui* — mais si
demain quelqu'un renomme `b-share-cart.js` dans le dépôt `bout`, le manifest backend
mentira sans que rien ne le signale.

**Conséquence** : la promesse « toute l'application est scannée » est vraie pour le backend,
partielle pour la boutique (couverte par `BOUTIQUE_OWNERSHIP_LIVE.md` mais non recroisée),
absente pour `dash`.

**Correctif** : soit (a) un check cross-repo qui tourne quand les 3 arbres sont présents
(checkout parent), soit (b) acter que boutique s'auto-vérifie via `gen-ownership.js` et
ne déclarer dans les manifests backend que ce que le backend peut prouver. La doctrine
choisit déjà (b) pour la boutique — il faut juste l'**écrire comme une décision**, pas la
laisser ambiguë. `dash` reste une dette assumée.

### 🟡 RÉSERVE 3 — Les 50 orphelins ne sont pas une catégorie homogène

**Constat vérifié** — les 50 orphelins se répartissent en 3 natures très différentes que le
script traite aujourd'hui comme un seul « warning » :

| Nature | Nombre | Gravité réelle |
|---|---|---|
| **Header ↔ manifest en désaccord** : `@domain` pointe vers une feature existante, mais le manifest ne liste pas le fichier (ex. `baskets.js` → `@domain shared-cart`, absent du manifest shared-cart) | **16** | 🔴 Élevée — c'est une incohérence, pas une dette : la feature existe, le fichier se réclame d'elle, mais elle ne le revendique pas |
| **`@domain unknown` mappable par nommage** (ex. `customs-shipment-service.js` → customs) | **22** | 🟠 Moyenne — rattachement mécanique possible |
| **`@domain unknown` non mappable, décision humaine** (ex. `routes/shares.js`, `utils/rules.js`, `utils/eco-bridge.js`) | **12** | 🟡 Faible — vraie zone grise métier |

**Conséquence** : les 16 du premier groupe ne devraient pas être de simples warnings. Quand
un fichier déclare `@domain X` et que X existe comme feature, son absence du manifest de X
est une **régression de cohérence** — exactement le genre de dérive que le Niveau 0 est
censé interdire. Les noyer dans 50 « orphelins » masque les 16 qui comptent.

---

## Correctifs fournis (prêts à coller)

Voir les 2 fichiers livrés avec cette certification :

1. **`ci.yml.patch`** — les 2 steps à insérer dans le job `unit` (lève la Réserve 1).
2. **`feature-registry-check.PATCH.md`** — l'amélioration du script pour distinguer les
   3 natures d'orphelins et faire des 16 désaccords header/manifest une **erreur bloquante**
   séparée (lève la Réserve 3). Rétro-compatible : le comptage « orphelin » global reste,
   mais une nouvelle catégorie `DOMAIN-MISMATCH` apparaît au-dessus.

La Réserve 2 est une **décision à acter**, pas un bug à patcher — je propose le texte de
décision dans la section suivante.

---

## Décision à acter (Réserve 2)

> **Périmètre de vérification du Niveau 0** : le `feature-registry-check.js` vérifie
> l'existence et la cohérence des fichiers **backend uniquement**. Les fichiers boutique
> déclarés dans `repos.boutique` sont gouvernés et vérifiés par le système d'ownership
> auto-généré du dépôt `bout` (`scripts/gen-ownership.js` → `BOUTIQUE_OWNERSHIP_LIVE.md`).
> Les manifests backend les référencent à titre de carte, sans en être l'autorité de
> vérification — pour éviter deux sources de vérité divergentes. Le dépôt `dash` n'a pas
> encore de système d'ownership : c'est une dette explicite, ré-évaluée à chaque revue
> trimestrielle de la doctrine.

Cette décision est **cohérente avec ce que le code fait déjà** — elle ne change rien, elle
rend explicite un choix aujourd'hui implicite. C'est ce qui transforme une ambiguïté en
invariant.

---

## Faisabilité « réagir 100× plus vite »

L'objectif déclaré — ajuster une feature plus vite qu'un concurrent — est **réaliste avec
cette architecture**, à condition que les 3 réserves soient levées. La mécanique qui le
permet :

1. Un agent ou un humain ouvre le registre → trouve la feature en secondes.
2. Le manifest lui donne `perimeter.in` (où agir) et `perimeter.out` (mur d'arrêt) sans
   lire une ligne de code.
3. `authority` dit s'il peut trancher seul ou doit consulter.
4. Les gates (une fois en CI) garantissent qu'il ne peut pas casser une frontière sans
   que la porte rougisse.

Le gain de vitesse ne vient pas du code — il vient de **ne jamais avoir à se demander où ça
vit et si on a le droit**. C'est exactement ce que le Niveau 0 industrialise. La fondation
est bonne. Il reste à brancher les portes.

---

## Recommandation finale

**Tamponner et merger** la doctrine telle quelle — elle est juste et la fondation est
solide. **Dans la même PR ou la suivante immédiate**, appliquer les 2 correctifs de câblage
(CI + distinction des orphelins) et acter la décision cross-repo. Sans ce câblage, on a une
excellente carte que personne n'est obligé de suivre ; avec, on a une frontière que le
système défend tout seul.

Le chantier est validé. Les angles morts sont nommés. Il n'y en a pas d'autre caché dans la
mécanique — j'ai tourné les gates, pas lu leur description.
