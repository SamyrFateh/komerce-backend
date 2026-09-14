# Doctrine — Sourcing Final Authority & Health

## Objet

Ce document clôt le chantier technique Sourcing après le Golden E2E multi-source et le gate d'intégrité opérationnelle.

La chaîne de vérité finale est :

`Source → Capture → Observation → Evidence → Candidate Retrieval → Resolution → Canonical Product → Canonical Offer → Canonical Unit → sourcing_candidate → promotion catalogue inactive → product_sku → Canonical Unit → Supplier Order Identity → Purchasing readiness / HARD_STOP`.

Le Sourcing répond à deux questions :

1. **qu'est-ce que c'est ?** — Resolution + Canonical Product/Offer/Unit ;
2. **peut-on préparer un achat sans ambiguïté ?** — Canonical Unit + Supplier Order Identity + Purchasing gate.

Il ne répond pas à :

- où acheter maintenant — **Selection** ;
- où réceptionner / consolider / router physiquement — **Hub** ;
- quelle destination pays attribuer au flux physique — **Hub / Logistics** ;
- exécuter une vraie commande fournisseur — side effect Purchasing encore fermé par **HARD_STOP**.

## Autorités finales

| Sujet | Autorité |
|---|---|
| vérité source | Observation immuable + provenance |
| identité multi-source | ResolutionDecision + active ResolutionBinding |
| chose elle-même | Canonical Product |
| vérité commerciale fournisseur | Canonical Offer |
| variante commandable exacte | Canonical Unit |
| identité d'achat | Canonical Unit + Supplier Order Identity |
| lecture catalogue Product | progressive canonical preferred avec fallback legacy sûr |
| Selection fournisseur | hors autorité Sourcing |
| commande fournisseur réelle | HARD_STOP |
| routage Hub | hors autorité Sourcing — domaine suivant |

Aucun provider n'est codé comme vérité métier dans le core. Manual, CSV, CJ, AliExpress, Allegro ou une source future doivent converger par les mêmes contrats génériques.

## Retirement matrix

### KEEP

- Source / Capture / Observation / Evidence ;
- ResolutionDecision / ResolutionBinding / CanonicalEntity ;
- projections Canonical Product / Offer / Unit ;
- `sourcing_candidates` et promotion catalogue inactive ;
- Canonical Unit + Supplier Order Identity purchasing gate ;
- Golden E2E ;
- operational integrity audit ;
- Workspace Sourcing Canonical.

### DEPRECATE

- Catalog Product route canary ;
- Catalog Product read cutover trial ;
- Parallel Product read comparison.

Ils restent utiles comme preuves de migration et de rollback, mais ne sont plus des autorités runtime finales.

### REMOVE_LATER

- scripts shadow/projection/read-comparison/cutover de migration ;
- comparateurs Offer/Unit dédiés à la transition.

Suppression uniquement après une fenêtre d'observation suffisante et preuve runtime durable. Pas de suppression opportuniste dans le lot de clôture.

### REMOVE_NOW

Aucun composant. La clôture d'autorité ne doit pas créer une dette de rollback en supprimant des preuves encore utiles.

## Health Dashboard

Le backend expose la santé dans le **payload canonique existant** :

`GET /api/admin/workspaces/sourcing`

sous la clé `health`. Aucune seconde surface `/health` n'est créée : le Workspace Sourcing reste une projection backend unique et le navigateur ne recalcule rien.

La hiérarchie est :

`ÉTAT → AGRÉGATS → EXCEPTIONS → DRILL-DOWN → RAW`.

### États

- `HEALTHY` — invariants intacts ;
- `ATTENTION` — exception opérationnelle correctement bloquée ou donnée à revoir ;
- `BROKEN` — invariant d'intégrité rompu ou risque réel de mélange.

**Rouge ne signifie jamais “performance faible”. Rouge signifie risque d'intégrité.**

Le dashboard ne recalcule aucune vérité dans le navigateur. Il rend le verdict backend.

### Signaux rouges minimum

- une Observation avec plusieurs bindings actifs ;
- une ref namespacée pointant vers plusieurs Canonical Entities ;
- replay de la même identité Source séparé sur plusieurs identités canoniques ;
- Unit résolue sans identité fournisseur exacte ;
- contradiction provider / provenance ;
- rupture Golden E2E.

### Signaux ATTENTION

- captures failed/partial/en cours ;
- Source désactivée ;
- Observations non bindées ;
- `REVIEW_REQUIRED` ;
- ambiguity correctement bloquée ;
- identité fournisseur bloquée avant Purchasing ;
- erreur de lecture Canonical Unit.

Une ambiguity bloquée est une **protection qui fonctionne**, pas une corruption.

## Tendance

Aucune tendance n'est fabriquée à partir d'un snapshot instantané. Tant qu'aucun historique de santé n'est persisté, le payload retourne :

`trend.status = UNKNOWN`.

Le jour où une tendance est nécessaire, elle doit provenir de snapshots persistés et horodatés, jamais d'une inférence navigateur.

## Frontière avec le Hub

Le Sourcing s'arrête lorsque l'identité d'achat est déterministe et que le Purchasing peut évaluer la readiness.

Le prochain domaine peut alors prendre la main sur le flux physique :

`Purchase Order / inbound supplier line → Hub receipt identity → destination market → consolidation → parcel / shipment routing`.

Le Hub ne doit jamais redéduire l'identité produit depuis un libellé fournisseur. Il doit recevoir des références déterministes issues de la chaîne déjà sécurisée : Canonical Unit, supplier identity, commande fournisseur et destination explicite.

Cette séparation est volontaire : **Sourcing décide ce qu'est la chose ; le Hub trace où cette chose physique doit aller.**
