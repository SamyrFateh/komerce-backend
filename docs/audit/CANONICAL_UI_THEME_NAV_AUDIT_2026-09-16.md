# Audit UI Canonical — thème + navigation

Date : 2026-09-16  
Référence visuelle validée : Catalogue Control Tower (`/admin/workspaces/catalog`) après PR #1550.  
Doctrine navigation : `docs/doctrine/ADMIN_NAVIGATION_DOCTRINE_V2.md`.

## 1. Conclusion

Le problème n'est pas un manque de composants. Le runtime Canonical possède déjà les bonnes primitives et les dashboards principaux sont structurellement convergents. L'écart vient de deux couches :

1. **le thème partagé V1 n'a pas suivi la direction visuelle finalement validée dans Catalogue** ;
2. **le Catalogue a embarqué un shell/sidebar local pour reproduire le mock**, ce qui court-circuite la navigation Canonical N1/N2 pourtant déjà définie par doctrine.

Décision :

- extraire le langage visuel du Catalogue dans `canonical-theme-v2.css` ;
- le charger après `visual-freeze-v1.css` sur toutes les surfaces Canonical ;
- ne jamais recopier la sidebar Catalogue sur les autres dashboards ;
- restaurer immédiatement le shell Canonical global sur Catalogue ;
- traiter la navigation fonctionnelle et role/capability-aware dans un lot séparé.

## 2. Inventaire des surfaces et stratégie de convergence

| Famille | Surfaces | Structure actuelle | Action V2 |
|---|---|---|---|
| Dashboards décisionnels | Pilotage, Commerce, Commandes, Opérations, Finance | `kmc-dashboard`, `kmc-decision-dashboard`, primitives communes | Thème transverse, aucune réécriture métier |
| Workspaces | Pricing, Hub/Relais, Expéditions & Douane, Sourcing, Comptabilité | `kmc-workspace-*` / `kmc-operations-workspace` | Thème transverse, mêmes actions et endpoints |
| Catalogue global | Control Tower + vue advanced | UI dédiée + données canoniques | Conserver la Control Tower, supprimer son autorité de shell/navigation |
| Marchés standalone | Accès pays, Autonomie marché, Catalogue pays | pages HTML autonomes | Charger explicitement Theme V2 |
| Drill-downs | Product 360, Order 360, Client 360 / index | primitives Entity / Canonical | Héritage du thème partagé |
| Paramètres | Settings workspace | tokens Canonical aliasés | Héritage du thème partagé |
| Action Center | workspace Canonical | `kmc-workspace-*` | Héritage du thème partagé |

## 3. Contrat visuel Theme V2

Le langage validé dans Catalogue devient la base Canonical :

- fond application `#f8fbff` ;
- ink/navy `#102143` ;
- bordures `#dfe7f2` ;
- accent principal indigo `#4f67ff` ;
- sémantiques : vert `#18b86a`, orange `#fb7a24`, rose `#df3f86`, violet `#7b61ff`, jaune `#f0b427` ;
- cartes blanches, rayon compact 8px, ombres très légères ;
- titres de page non enfermés dans de gros blocs décoratifs ;
- tables compactes et lisibles ;
- actions primaires bleues, secondaires outline ;
- aucune couleur sémantique ne change la signification métier d'un état.

`canonical-theme-v2.css` est volontairement une couche de présentation chargée après `visual-freeze-v1.css`. Cette stratégie garde le rollback trivial et évite de modifier chaque renderer.

## 4. Audit navigation — écarts à fermer au Lot B

### N-01 — shell local Catalogue

Le Catalogue masquait `.kmc-admin-navigation` puis rendait sa propre sidebar. Cette sidebar expose au même niveau `Sourcing`, `Raffinerie`, `Produits`, `Boutique`, `Analyse`, `Paramètres`, ce qui viole directement la doctrine N1/N2.

**Correction Lot A** : le Theme V2 réaffiche le shell Canonical et masque la sidebar locale. La Control Tower reste le contenu, pas l'autorité de navigation.

### N-02 — taxonomie N1/N2 à revalider bout-en-bout

La doctrine fixe N1 :

1. Dashboard
2. Atelier économique
3. Catalogue
4. Commandes
5. Marchés
6. Opérations
7. Finance

Les workspaces spécialisés appartiennent au N2 de leur domaine. Le Lot B doit tester toutes les routes réelles, les parentages et les retours de drill-down.

### N-03 — visibilité Dashboard des rôles spécialisés

`navigation.js::domainIsVisible()` force actuellement `Dashboard` visible pour tous les rôles alors que le capability map documente que les données `unified*` sont réellement servies à `admin` et `market_operator`. Les rôles spécialisés possèdent leurs workspaces propres.

**Lot B** : réaligner la visibilité et le landing sur les guards actuels, sans fabriquer de droit frontend.

### N-04 — drift entre doctrine et capability map

`ADMIN_NAVIGATION_DOCTRINE_V2.md` décrit la cible produit, tandis que `admin-nav-capability-map.md` conserve plusieurs paliers historiques. Le Lot B doit produire une matrice unique « route front → surface → domaine N1 → espace N2 → rôle/capability serveur » et en faire un test de contrat.

### N-05 — pages standalone Marchés

Les pages `access.html`, `market-autonomy.html` et `market-catalog.html` utilisent le même `navigation.js` mais ne passent pas par `index.html`. Le thème et la navigation doivent donc être explicitement testés sur ces trois entrées.

## 5. Critères de sortie

### Lot A — thème

- toutes les entrées Canonical chargent Theme V2 après Visual Freeze V1 ;
- les dashboards/workspaces héritent des mêmes tokens et densités ;
- Catalogue conserve son contenu validé mais n'a plus de sidebar d'autorité ;
- aucune API, transition métier, prix, exposition, source ou capability ne change.

### Lot B — navigation

- une seule navigation globale ;
- N1 strictement métier, N2 strictement contextuel ;
- active state correct sur chaque surface et chaque drill-down ;
- landing sans 403 pour chaque rôle livré ;
- Market ID reste transverse, jamais un domaine ;
- Paramètres reste utilitaire global ;
- matrice route/rôle/capability testée et documentée ;
- aucune destination visible si son guard serveur ne l'autorise pas.
