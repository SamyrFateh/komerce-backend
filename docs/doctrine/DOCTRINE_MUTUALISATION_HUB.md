# Doctrine — Mutualisation des coûts du Hub physique par marché

> **Version** : 1.1 — 2026-09-06
> **Statut** : doctrine spécialisée — complète `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md` et `DOCTRINE_DENSITE_VALEUR.md`
> **Périmètre** : Hub physique, loyer, personnel, manutention, stockage et coûts opérationnels associés

---

## 1. Phrase de vérité

> **Le Hub porte deux natures de coûts : le variable réellement causé par les flux, qui reste dans N1, et la structure physique de période, qui appartient à N3. Les deux ne se comptent jamais deux fois.**

La mutualisation par `market_id` sert à comprendre quelle part de la structure Hub est consommée par chaque marché. Elle ne crée pas un nouveau coût par article.

---

## 2. Frontière variable / structure

### Coûts variables Hub

Les coûts directement causés par un article, un colis ou une opération et déjà modélisés comme `cost_components` restent dans N1 lorsqu'ils sont réellement variables.

Exemples :
- contrôle qualité unitaire ;
- étiquetage unitaire ;
- packaging unitaire ou par colis ;
- opération directement facturée par unité.

Ils sont exclus du pool de structure Hub à mutualiser.

### Coûts de structure Hub

Relèvent de N3 :
- loyer et charges immobilières ;
- personnel fixe Hub ;
- capacité de stockage réservée ;
- équipements et abonnements fixes ;
- coûts fixes de fonctionnement du site.

Ils se rattachent à une **charge économique de période**, jamais à un SKU ou à un shipment comme dette individuelle.

---

## 3. Interdiction du double comptage

Invariant :

```text
coût variable Hub déjà présent en N1
+ quote-part de structure Hub en N3
= deux natures distinctes
```

Interdit : réinjecter une quote-part du loyer/personnel Hub dans `cost_components` par article tout en conservant cette même charge dans le pool de structure.

Interdit également : refacturer 100 % de la structure Hub à un marché puis réimputer cette même structure dans ses CDR produits.

---

## 4. Le Hub ne se pondère pas au poids pour sa structure physique

Pour un Hub, la ressource physique rare est l'espace occupé et la manutention réellement consommée.

La doctrine distingue :

- **manutention** : assiette par colis / opérations réellement traités ;
- **stockage** : assiette par m³ occupé sur la fenêtre ;
- **surface/capacité réservée** : assiette de capacité réellement consommée ou contractualisée lorsque mesurable.

Le poids n'est pas la clé par défaut d'un coût de stockage ou de structure Hub.

Pour les flux maritimes, la cohérence avec `DOCTRINE_DENSITE_VALEUR.md` est impérative : volume si disponible ; à défaut, répartition égale avec `confidence: low`, jamais un poids inventé comme proxy économique.

Le poids reste pertinent lorsqu'il est réellement la contrainte du segment concerné, notamment aérien ou dernier kilomètre local.

---

## 5. Clés de mutualisation spécialisées

### Manutention fixe mutualisée

Quand une partie de la capacité de manutention est structurelle, la répartition utilise le nombre de colis / opérations effectivement traités par marché sur la fenêtre canonique.

### Stockage

La clé privilégiée est :

```text
m3_jours occupés par le marché / m3_jours occupés par tous les marchés éligibles
```

Si le temps d'occupation n'est pas encore disponible, le volume occupé constaté constitue une approximation explicite de confiance inférieure.

### Fallback

En absence de mesure physique fiable : répartition égale entre unités éligibles, `confidence: low`, avec alerte de calibration. Le fallback n'acquiert jamais l'autorité d'un réel.

---

## 6. Fenêtre canonique unique

La mutualisation Hub utilise la même fenêtre glissante bornée au watermark de maturité que la couverture de marché.

Le watermark peut franchir une commande définitivement irréconciliable uniquement par disposition humaine gouvernée. Cette disposition ne transforme jamais la commande en `MATURE` et ne fournit aucune mesure Hub manquante.

Interdit : facturer ou attribuer le Hub sur le mois calendaire si le gate de couverture utilise une autre fenêtre économique.

Les vues calendrier peuvent exister pour comptabilité et trésorerie, mais ne remplacent pas la fenêtre économique canonique.

---

## 7. Imputation et refacturation

**Imputation Hub par marché** : lecture interne de la consommation de structure.

**Refacturation Hub** : mouvement financier réel uniquement si le marché est juridiquement / contractuellement en mode partenaire facturable.

Invariant de conservation :

```text
Σ quotes-parts Hub attribuées aux marchés
= charge économique du pool Hub de la fenêtre
```

Aucun euro, AED ou KMF de structure Hub n'est créé ou détruit par la clé de répartition.

---

## 8. Couverture par marché

La quote-part Hub N3 attribuée au marché alimente le **dénominateur de sa couverture de période**, pas son coût variable article.

```text
market_coverage_ratio = contributions réconciliées du marché
                        / charge économique de structure attribuée au marché
```

Le ratio global Hub/groupe est publié pour pilotage, mais ne masque jamais le statut d'un marché donné.

---

## 9. Marché en ouverture

Un marché nouveau peut consommer du Hub avant d'avoir un volume suffisant pour couvrir sa structure.

Cette situation n'est pas masquée dans les autres marchés : elle est financée par un **budget de conquête groupe explicite**, daté et consommable.

La quote-part normale du marché reste visible afin de mesurer le chemin vers l'autonomie économique.

---

## 10. Prorata et incitation

Un prorata purement volumique ou transactionnel peut faire porter une part croissante de structure au marché qui réussit, alors même que la structure fixe n'augmente pas proportionnellement.

Deux politiques sont doctrinalement admissibles :

1. **mutualisation pure** : répartition selon consommation réelle ;
2. **socle par marché + marginal** : coût de présence minimal par marché puis part variable selon consommation.

Le choix est un arbitrage de groupe/actionnaire. Il n'est jamais caché dans une formule technique et doit être daté, versionné et explicable au `market_operator`.

---

## 11. Intégrité des données d'assiette

Le `market_operator` ne doit pas pouvoir produire lui-même les mesures qui réduisent sa quote-part.

Les volumes, colis, événements de scan et rattachements Hub proviennent des flux opérationnels et des agents habilités. La séparation des rôles protège l'intégrité économique de l'assiette.

Toute correction manuelle d'une mesure d'assiette doit être tracée avec auteur, motif, avant/après.

Une disposition de maturité ne peut jamais servir à fabriquer un volume, un `m3_jours`, une opération ou un coût Hub absent.

---

## 12. Gouvernance obligatoire

Sont gouvernés :

- frontière coût variable / structure ;
- frontière groupe / marché ;
- clé de manutention ;
- clé de stockage ;
- fallback et niveau de confiance ;
- politique de mutualisation ;
- fenêtre canonique ;
- périmètre des marchés éligibles ;
- mode d'imputation ou refacturation ;
- toute reclassification de charge Hub.

Déplacer un coût variable N1 vers N3, ou l'inverse, est un changement de doctrine économique et doit être audité.

---

## 13. État de matérialisation et gaps actuels

Les snapshots N2/N3, la maturité, le watermark anti cherry-picking et les dispositions gouvernées sont désormais matérialisés dans le moteur économique.

Restent ouverts :

- la structure de charge économique par marché n'est pas matérialisée ;
- `charges` ne distingue pas encore formellement pool groupe / pool marché ;
- les mesures `m3_jours` ne sont pas garanties disponibles ;
- `finance_config` reste global ;
- la largeur de fenêtre et les seuils décisionnels restent à gouverner ;
- le gate de couverture par marché n'est pas encore décisionnel.

La doctrine prescrit donc la cible sans prétendre que les données actuelles permettent une facturation fiable.

---

## 14. Ce qui ne doit pas être codé encore

- Ne pas ajouter une quote-part Hub fixe dans le CDR article.
- Ne pas utiliser le poids comme proxy de stockage Hub.
- Ne pas ajouter `market_id` à `charges` avant arbitrage groupe / marché.
- Ne pas facturer un partenaire sur une quote-part non réconciliée et non explicable.
- Ne pas dupliquer `finance_config` par marché avant modèle de structure validé.
- Ne pas traiter une disposition de maturité comme une preuve d'assiette Hub.

---

## 15. Phrase de contrôle

> **Le variable Hub suit le flux et reste dans N1 ; le fixe Hub suit la période et reste dans N3. La ventilation par marché explique la structure, elle ne la transforme jamais en coût article.**
