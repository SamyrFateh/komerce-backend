# Pricing — maturité, watermark & dispositions

> Statut : chantier technique empilé sur #1210, avant gate de couverture.
> Doctrine de référence : #1206, `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md`.

## Invariant de maturité

Une commande n'est `MATURE` que si les coûts variables qui conditionnent sa contribution disposent d'une preuve de réconciliation suffisante. Une estimation, une valeur configurée ou une absence de donnée ne devient jamais une preuve réelle ni un zéro économique.

Le watermark avance uniquement sur un préfixe temporel sans ligne non résolue. Si une commande d'un timestamp est immature, le groupe temporel entier bloque la frontière ; une commande plus récente déjà mûre ne peut pas être sélectionnée pour contourner ce blocage.

## Disposition d'une commande définitivement irréconciliable

Une commande dont la preuve ne pourra objectivement plus être reconstruite peut recevoir une disposition gouvernée. Cette disposition **ne transforme jamais la commande en `MATURE`** et ne satisfait aucun critère manquant.

Deux états seulement existent :

- `RECONCILIABLE` — état normal ; la commande suit les critères de maturité ;
- `IRRECONCILABLE_DISPOSED` — exception humaine explicite permettant au watermark de franchir cette ligne tout en conservant son immaturité économique visible.

Chaque transition est un événement append-only et porte obligatoirement :

- `reason_code` ;
- justification textuelle ;
- référence de preuve ;
- auteur ;
- date ;
- `market_id` figé depuis la commande côté serveur.

Aucune transition identique n'est enregistrée : revenir de `IRRECONCILABLE_DISPOSED` vers `RECONCILIABLE` exige un nouvel événement, une nouvelle justification et une nouvelle preuve.

## La disposition est bornée en volume

Le système publie séparément :

- `maturity_ratio` = commandes réellement mûres / cohorte ;
- `disposition_ratio` = commandes disposées / cohorte ;
- `effective_pass_ratio` = mûres + disposées / cohorte.

Une disposition ne gonfle donc jamais artificiellement `maturity_ratio`.

Le plafond de dispositions n'est pas un nombre caché dans le code. Il doit être fourni par une **politique externe gouvernée**, avec sa source et sa version.

Règle fail-closed :

- aucune disposition dans la cohorte → aucun plafond nécessaire ;
- dispositions présentes mais politique absente → `NOT_DECISIONAL` ;
- taux <= plafond externe → la maturité peut passer au gate suivant ;
- taux > plafond externe → `NOT_DECISIONAL`, même si le watermark temporel est techniquement franchissable.

Cela interdit d'utiliser la disposition comme mécanisme de nettoyage illimité du watermark.

## Vérités et gaps constatés

- `allocateProductPurchaseCosts()` utilise encore `products.cost_kmf` comme approximation ; cette source est refusée comme preuve d'achat réellement réconcilié.
- la commission relais issue de configuration décrit un coût attendu, pas son règlement ; elle ne rend pas une commande mûre.
- les frais de paiement attendus exigent une preuve réelle explicite.
- `local_distribution` reste bloquant lorsqu'aucune saisie réelle n'existe.
- `hub` provenant de `monthly_recalc` n'est jamais accepté comme preuve du Hub variable N1.
- pour un item `IMPORT`, `fulfillment_source`, rattachement shipment, clôture shipment, douane et fret doivent être réconciliés selon les critères du service.
- `risk_provision` reste N2 pour la contribution mais sa vérité est une réconciliation de période ; elle n'est pas traitée comme un décaissement réel commande.

Ces blocages sont volontaires : le watermark sert d'abord à montrer **quelle preuve économique manque réellement**.

## Ce lot ne décide toujours pas

- la largeur fixe de la fenêtre canonique ;
- le seuil de couverture ;
- la charge économique N3 de période par marché ;
- `COVERED / UNCOVERED / NOT_DECISIONAL` de couverture ;
- la politique d'ancrage prix marché ;
- la valeur numérique du plafond de disposition.

Les bornes `from/to` et la politique de plafond restent externes au moteur. Aucun défaut caché n'est introduit.
