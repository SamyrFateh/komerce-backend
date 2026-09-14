# Doctrine — Sourcing Operational Integrity

## Objet

Après le Golden E2E, l'audit opérationnel vérifie que la chaîne Sourcing reste sûre quand le réel devient imparfait : retry, capture partielle, replay, observation hors ordre, source indisponible, ambiguïté Resolution, identité Unit incomplète ou état Purchasing non prêt.

La chaîne auditée reste :

`Source → Capture → Observation → Resolution → Canonical Product / Offer / Unit → Catalog → product_sku → Canonical Unit / SOI → Purchasing readiness`.

L'audit est strictement read-only. Il n'appelle aucun fournisseur, ne publie aucun produit, n'exécute aucun `placeOrder` et ne modifie aucune variable Railway.

## Sémantique HEALTHY / ATTENTION / BROKEN

- `HEALTHY` : les invariants d'intégrité tiennent. Des observations hors ordre sont acceptées si elles restent attachées à la même identité.
- `ATTENTION` : le système reste cohérent mais demande une action ou une surveillance : capture failed/partial, source disabled, observation non résolue, `REVIEW_REQUIRED`, Unit ambiguë correctement bloquée, SOI absente ou read error.
- `BROKEN` : une règle susceptible de mélanger ou corrompre la vérité métier est violée.

Le rouge est donc réservé à la rupture d'intégrité, pas à une simple indisponibilité temporaire.

## Hard failures

Sont notamment `BROKEN` :

- une Observation avec plusieurs bindings actifs ;
- une ref `(source_id, ref_kind, ref_value)` pointant vers plusieurs identités canoniques ;
- le replay d'une même identité Source/grain/ref réparti sur plusieurs Canonical Entities actives ;
- une Canonical Unit annoncée `RESOLVED` sans ref exacte ou sans SOI versionnée ;
- une SOI `RESOLVED` dont le provider contredit le namespace/provenance de la Unit ;
- tout hard failure du Golden E2E, notamment fuite économique dans Product, perte de provenance ou mélange de namespaces.

Deux fournisseurs différents peuvent utiliser la même valeur textuelle de ref. La comparaison ne devient une collision que dans le même namespace technique et le même `ref_kind`.

## Conditions d'attention

Sont `ATTENTION`, pas `BROKEN`, tant que les gates restent fermés :

- captures `failed`, `partial` ou encore `running` ;
- source `disabled` ;
- Observation sans binding courant ;
- dernière décision `REVIEW_REQUIRED` ;
- Canonical Entity superseded encore référencée par un binding actif ;
- enfant canonique actif rattaché à un parent non actif ;
- `AMBIGUOUS_PRODUCT`, `AMBIGUOUS_UNIT`, `NO_UNIT`, `NO_SUPPLIER_IDENTITY`, `INACTIVE_UNIT` ou read error côté Unit resolver.

L'ambiguïté correctement bloquée est une exception opérationnelle, pas une corruption.

## Idempotence et ordre temporel

Une ré-observation crée une nouvelle Capture et de nouvelles Observations. Le replay de la même identité `(source_id, grain, source_ref)` doit conserver la même identité canonique.

Une Observation peut arriver avec un `observed_at` plus ancien qu'une capture précédemment traitée. Ce cas est mesuré mais n'est pas une erreur si Resolution conserve l'identité et ne réécrit pas l'historique.

Les contraintes DB sur les bindings actifs et les refs namespacées sont les premiers verrous de concurrence ; l'audit en vérifie le résultat persistant.

## Purchasing

`capability != readiness now`.

Une Unit exacte n'est pas forcément commandable maintenant. Stock inconnu, prix indisponible, adapter absent, provider indisponible ou preflight négatif restent fail-closed.

Le script d'intégrité ne construit aucune commande. `place_order_invoked=false` est un invariant du rapport.

## Exécution

```bash
node scripts/sourcing-integrity-audit.js
node scripts/sourcing-integrity-audit.js --compact
```

Le script sort un code non nul uniquement pour `BROKEN`. `ATTENTION` reste exploitable par l'exploitation et le futur Sourcing Health Dashboard sans transformer une dette de données en panne d'intégrité.

La sortie stable contient :

```json
{
  "status": "HEALTHY | ATTENTION | BROKEN",
  "integrity": {},
  "idempotency": {},
  "resolution": {},
  "catalog": {},
  "unit_identity": {},
  "purchasing_readiness": {},
  "exceptions": [],
  "hard_failures": []
}
```
