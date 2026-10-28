# Komerce CJ498 — contre-épreuve déterministe sans IA (28/10/2026)

**Statut : EXPÉRIMENTATION, PAS DE CERTIFICATION MÉTIER.**

## Provenance vérifiable

- Corpus : **498 produits authentiques CJ**, SHA256 `9ff18f6f902f2e72fc893a90da96b61058c77028d55e941381631fc9fb8116de`.
- Verdits V1 : 63 AUTO_CLASSIFIED / 240 CATEGORY_CLASSIFIED / 195 REVIEW_REQUIRED ; contrôles d'identités source et V1 par le code shadow existant.
- Script : `scripts/cj-deterministic-family-probe.js`.
- CI sans LLM : `Catalog object family V2 — shadow-only proof`, run **40685322179**, SUCCESS.
- Archive CI : `catalog-object-shadow-v2-40685322179` (rapport, 117 familles, 498 affectations, CSV de validation).

## Résultats observés (et seulement observés)

| Mesure | Résultat |
|---|---:|
| Titres normalisés distincts | 479 |
| Groupes de titres identiques | 15 (34 produits, 19 répétitions excédentaires) |
| Groupes lexicaux **candidats**, non validés | **117** |
| Produits rattachés à un groupe candidat | **332/498** |
| Produits sans groupe candidat | 166 |
| Produits V1 en revue rattachés à un groupe | **130/195** |
| Produits V1 en revue non rattachés | 65 |
| Groupes candidats comprenant des produits en revue | **61** |
| Groupes traversant plusieurs segments Discovery | **9** |
| Groupes avec parents V1 contradictoires et connus | 0 (ne vaut pas preuve) |

**Simulation optimiste :** si les 61 groupes de revue étaient réellement homogènes et approuvés d'un seul geste, les 130 produits groupés demanderaient 61 validations et les 65 non groupés en demanderaient 65, soit **126 décisions** contre 195 validations individuelles supposées : baisse théorique **35,38 %**.

Ce n'est PAS un gain humain mesuré : la V1 peut déjà permettre des décisions groupées ; certaines familles lexicales sont fausses ; une scission, une exception et la lecture des exemples ont un coût.

### Cas dangereux détectés dans le corpus

- `mobile phone` : regroupe des smartphones et des accessoires (sangle, coque), malgré des placements parfois proches.
- `remote control` : n'est pas un type d'objet suffisamment précis.
- `non slip`, `long sleeve`, `short sleeve` : propriétés, pas objets.
- `stainless steel sublimation` : matériau + procédé, pas nécessairement l'objet principal.
- `fuel filter` : doit distinguer le filtre, sa clé, un kit, un appareil ayant un filtre.
- Au moins **9** familles traversent plusieurs segments de découverte. Ces segments sont des indices de risque, jamais des vérités terrain.

L'absence de contradiction entre deux parents V1 connus ne signifie pas homogénéité : les V1 non classés n'ont aucun parent à comparer et peuvent dissimuler des erreurs.

## Limites expérimentales obligatoires

1. La fréquence des n-grammes est calculée sur les **498 produits**, y compris le holdout. Cette exploration **ne peut pas** certifier la généralisation ni servir telle quelle à une évaluation indépendante : figer les heuristiques sur la calibration, puis tester sur le holdout et un autre fournisseur.
2. Les 117 groupes sont **lexicaux**, pas des types canoniques. Les synonymes ne fusionnent pas ; les matériaux/attributs peuvent produire des faux groupes.
3. Les 195 REVIEW_REQUIRED ne correspondent pas forcément à 195 interventions humaines effectives. Le ratio 35,38 % n'est qu'un scénario hypothétique.
4. Aucune précision, validité de propagation, économie de temps, robustesse multi-fournisseurs ou amélioration du classement n'est certifiée.
5. Aucune écriture dans le catalogue ni appel IA/API payant. Ollama **non nécessaire** pour ce test.

## Ce que l'exercice permet de trancher avec Opus

- L'agrégation lexicale seule apporte un réservoir de candidats mais **n'a pas démontré** l'objectif de -50 % d'effort humain.
- Le goulot d'étranglement devient : **reconnaître l'objet principal** et **écarter les caractéristiques** (`non slip`, `stainless steel`) pour ne pas propager des erreurs.
- Prochain test le moins coûteux : contrôle humain rapide des **61 groupes** touchant la revue (en commençant par les 9 transverses), mesurer nombre de groupes homogènes, d'exceptions et de minutes. Ensuite comparer avec des types d'objet validés, **sans LLM si c'est suffisant**.
- Pour un benchmark honnête : soumettre à Opus les résultats et exemples, demander une méthode de réduction des 65 isolés, et concevoir un test **sur évaluation gelée** avant toute promotion.

## Contrat de sécurité et sortie

Aucune étiquette autoritative n'est produite. Un groupe ne classe jamais un produit. La PR shadow reste en brouillon et ne touche ni `main`, ni le staging, ni le Catalogue. La classification opérationnelle V1 reste indépendante.
