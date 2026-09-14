# Doctrine — Golden Sourcing E2E Multi-Source

## Objet

Le Golden prouve la continuité de la chaîne persistée :

\`Source → Capture → Observation → Resolution → Canonical Product → Offer → Unit → sourcing_candidate → promotion catalogue inactive → product_sku → Canonical Unit → Supplier Order Identity → Purchasing readiness / HARD_STOP\`.

Il s'agit d'une preuve d'intégrité et non d'un rollout. Le script est read-only, ne publie rien, n'appelle aucun fournisseur et ne possède aucune capacité \`placeOrder\`.

## Compatibilité avec les sources futures

Manual, CJ et AliExpress constituent le minimum de preuve du lot, jamais une whitelist. Allegro est évalué lorsqu'une trace staging suffisante existe. Toute source future reste compatible sans changement du core si elle respecte les contrats génériques :

- Source instance stable et namespace explicite ;
- Capture append-only ;
- Observation \`product\`, \`offer\` ou \`unit\` avec provenance ;
- refs externes namespacées par Source ;
- hiérarchie Product → Offer → Unit ;
- Supplier Order Identity opaque \`{ provider, version, payload }\` ;
- adapter enregistré pour le provider au moment d'un futur preflight.

Le core ne branche pas sur les champs provider-native. Il transmet le payload opaque à l'adapter qui le possède.

## Invariants Golden

### Identité

- Un même produit observé par plusieurs sources converge vers un Canonical Product lorsqu'une preuve forte le justifie.
- Deux produits distincts restent deux Canonical Products, même si leurs libellés se ressemblent.
- Une ré-observation crée une nouvelle Capture et de nouvelles Observations, puis conserve l'identité canonique déterministe.
- Le prix, le stock, le fret ou la disponibilité ne créent jamais une nouvelle identité.
- Deux refs identiques dans deux namespaces techniques ne sont jamais assimilées par la seule égalité du texte.
- Une Unit ambiguë reste bloquée ; aucun label ou SKU ressemblant n'est deviné.

### Autorité des grains

- Product répond « qu'est-ce que c'est ? » et ne porte aucun fait économique fournisseur.
- Offer répond « qui le propose et dans quel état commercial ? ».
- Unit répond « quelle variante fournisseur exacte ? ».
- Resolution répond « même chose ? ».
- Selection, « où acheter maintenant ? », reste hors de ce lot.
- Purchasing ne reçoit qu'une Unit exacte et une SOI opaque.

### Catalogue

La promotion Golden attendue crée uniquement un brouillon :

- \`products.is_active = FALSE\` ;
- \`products.lifecycle_status = 'candidate'\` ;
- aucun prix, stock ou statut public n'est activé par l'audit ;
- \`product_sku\` conserve la ref exacte et la SOI fournie par la source ;
- Manual/CSV sans SOI reste valide pour Sourcing et Catalog mais bloqué pour Purchasing.

### Purchasing

Les issues terminales de la preuve sont exclusivement :

- identité exacte : \`HARD_STOP\` ;
- aucune Unit, ambiguity ou SOI absente : \`BLOCKED_SUPPLIER_IDENTITY\`.

Même avec un preflight déterministe réussi et un payload construit, \`place_order_invoked\` reste \`false\`. Aucun paiement et aucune commande externe ne sont accessibles depuis le Golden.

## Script staging

\`node scripts/sourcing-golden-e2e-staging.js\`

Options :

- \`--compact\` : JSON sur une ligne.

Le script lit le corpus staging réel et échoue avec un code non nul si une preuve obligatoire manque. Il n'insère pas de fixtures et ne maquille pas un environnement incomplet. Sa sortie stable contient :

\`\`\`json
{
  "status": "PASS",
  "integrity": {},
  "resolution": {},
  "catalog": {},
  "unit_identity": {},
  "commandability": {},
  "hard_failures": []
}
\`\`\`

Puis :

\`\`\`text
INTEGRITY        PASS
RESOLUTION       PASS
CATALOG          PASS
UNIT IDENTITY    PASS
COMMANDABILITY   PASS
\`\`\`

## Hard failures

Au minimum :

- provenance perdue ;
- Observation liée à plusieurs identités actives ;
- replay séparé en identités métier différentes ;
- convergence multi-source ou distinction non prouvée ;
- conflit descriptif silencieusement écrasé ;
- fait économique présent dans Canonical Product ;
- promotion catalogue non inactive ;
- ref Unit mélangée entre namespaces ;
- Unit exacte non résolue ;
- ambiguity non bloquée ;
- SOI absente non bloquée ;
- SOI non adossée à une ref Unit exacte ;
- SOI Manual/CSV fabriquée ;
- \`placeOrder\` appelé.

## Limites explicites

Le Golden ne fait pas de Selection et ne prouve pas la disponibilité commerciale future d'une source. Une source peut être correctement ingérée et résolue tout en restant non ready maintenant. L'absence de données Allegro suffisantes est publiée comme \`GAP_NO_STAGING_DATA\`, sans affaiblir les invariants applicables à toute nouvelle source.
