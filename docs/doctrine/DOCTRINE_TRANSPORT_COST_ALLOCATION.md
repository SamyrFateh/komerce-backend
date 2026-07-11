# Doctrine Komerce — Allocation des coûts de transport

## Objet

Komerce ne transforme pas un coût réel de transport en forfait arbitraire par kilogramme. Un opérateur facture un lot et ses composantes ; Komerce ventile ensuite chaque composante réelle selon une clé économique explicite, versionnée et auditable.

## Principe canonique

COÛT RÉEL DU LOT → COMPOSANTES → CLÉ PAR COMPOSANTE → QUOTE-PART

Un rail ne possède pas une clé universelle. Il détermine les clés admissibles et leur état de calibration.

## Composantes initiales

`FREIGHT`, `AWB`, `HANDLING`, `SECURITY`, `FUEL_SURCHARGE`, `CUSTOMS`, `OTHER`.

La composante décrit la nature économique du coût. Elle ne remplace pas les cost types comptables existants.

## Clés initiales

- `CHARGEABLE_WEIGHT` : maximum du poids réel et du poids volumétrique.
- `ACTUAL_WEIGHT` : poids réel.
- `VOLUMETRIC_WEIGHT` : poids volumétrique seul.
- `VOLUME` : volume réel.
- `PARCEL_COUNT` : nombre de colis.
- `ORDER_COUNT` : nombre de commandes.
- `DIRECT_ASSIGNMENT` : imputation directe à une cible déterminée.
- `EQUAL_SPLIT` : répartition neutre explicite, uniquement comme fallback documenté.

## Doctrine par rail

### SEA_STANDARD

Le fret maritime reste alloué par volume réel lorsque le snapshot existe. En absence de volume, le fallback reste égal et explicitement marqué faible confiance. Le poids ne devient jamais une clé maritime implicite.

### AIR_EXPRESS

Le corridor `DXB → ADD → HAH` est reconnu. Le fret aérien consolidé doit être ventilé selon `CHARGEABLE_WEIGHT` lorsque le facteur volumétrique contractuel est calibré.

Tant que ce paramètre opérationnel n'est pas stabilisé dans Komerce, la clé est connue mais son exécution pour `AIR_EXPRESS` reste `PENDING`. Aucun facteur ne doit être inventé par le runtime du rail.

Les composantes fixes ou quasi fixes, par exemple AWB ou certains frais de handling, peuvent utiliser `PARCEL_COUNT`, `ORDER_COUNT` ou `DIRECT_ASSIGNMENT` selon la facture réelle et la règle d'exploitation retenue.

## Invariants

1. Coût réel avant allocation : une allocation ne crée pas le coût source.
2. Une composante possède une clé explicite ; aucune clé n'est déduite silencieusement du rail.
3. Pas de prix aérien universel au kilogramme dans le moteur de coûts réels.
4. Une calibration manquante bloque la composante concernée.
5. La somme des quotes-parts conserve le coût source, sous réserve de l'arrondi géré par le moteur.
6. Composante, clé, rail et confiance restent auditables.
7. Rail connu ne signifie pas rail commercialisé.

## Statut initial

SEA_STANDARD : `FREIGHT → VOLUME`, fallback `EQUAL_SPLIT / low`.

AIR_EXPRESS : `FREIGHT → CHARGEABLE_WEIGHT / PENDING`. Les clés de `AWB`, `HANDLING`, `SECURITY` et `FUEL_SURCHARGE` sont configurables et seront affinées à partir des coûts réels observés.
