# Certification canonique des imports fournisseurs — contrat réutilisable

**Statut :** contrat de preuve et étalonnage unitaire validés, certification terrain croisée en cours.

## Principe

La réception et le classement boutique ne dépendent pas de la disponibilité d'un taux de change.
Ne jamais fabriquer de taux, publier un produit, valider une marge ni simuler une décision de vente
pour faire passer un import. Les catégories douanières et les contrôles de transport restent des
gardes internes ; ils ne sont pas la taxonomie commerciale affichée.

**Frontières de preuve distinctes :**

1. **Réception source** : 20 objets réels du fournisseur, avec 20 identités différentes,
   contrat pivot valide et zéro rejet à la lecture du connecteur.
2. **Traçabilité canonique** : le KIR identifie le bon fournisseur ; source_total=20 ;
   vingt événements terminés avec un candidat effectivement relié ; exactement
   vingt candidats persistés et réconciliés par identité fournisseur.
3. **Classification commerciale indépendante** : réexécuter le moteur depuis
   nom et taxonomie du fournisseur, sans reprendre une décision humaine enregistrée
   ni une suggestion de découverte historique ; exiger 20 AUTO_CLASSIFIED,
   zéro REVIEW_REQUIRED, EXPLICIT_REVIEW ou conflit historique.
4. **Change différé et données économiques** : en l'absence du taux officiel,
   chaque candidat est conservé avec WATCH, fx_gate AWAITING_OFFICIAL_QUOTE,
   purchase_price_kmf=NULL, aucun prix ou montant inventé. Un taux valide
   permet le calcul économique ultérieur ; ce test **ne certifie pas le prix**.
5. **Isolation catalogue** : l'import de preuve ne crée ni n'active aucun produit
   boutique. Les contrôles prix/exposition marché/publication/achat/paiement sont
   certifiés **séparément**, jamais par contagion du 20/20 de classification.

## Deux preuves complémentaires

- **Audit du passé — lecture seule** : inventorier les KIR, compter import,
  événements, candidats et motifs de rejet, rejouer indépendamment la classification.
  Un KIR marqué COMPLETED n'est jamais une validation métier suffisante.
- **Contre-épreuve active — staging** : après approbation opérateur et empreinte
  d'identité de la base, capter un lot fournisseur borné et réel ; vérifier
  l'unicité *avant* écriture, appeler une seule fois l'orchestrateur canonique,
  conserver les artefacts et vérifier toutes les portes. Pas de publication.
  Interdire tout accès DB production ou modification de la base source.

## Contrat machine

`scripts/lib/supplier-import-proof-gates.js` est pur, sans SQL ni connaissance
des connecteurs. Ses entrées couvrent provider, expected, source, run, events,
candidates, classification, publishedDelta. Ses portes sont : source, import,
trace, candidates, fx_deferral, boutique_classification, publication.

Son verdict ne peut être `CLASSIFICATION_CERTIFIED_NOT_SELLABILITY` que lorsque
**toutes** les portes sont satisfaites. Le détail des portes en échec est
exposé ; aucune erreur ne se transforme en succès par un booléen de CI.

Étalonnage unitaire dans
`tests/unit/supplier-import-proof-gates.test.js` :

- nominal 20/20 ;
- nominal avec 20 FX différés, sans calcul de prix ;
- 20/20 erreurs du type CJ KIR-000012 : refus ;
- événement manquant : refus ;
- 19/20 classes : refus ;
- conflit historique : refus ;
- identité fournisseur dupliquée : refus ;
- prix inventé ou sourcing TEST avec FX en attente : refus ;
- publication non attendue : refus ;
- mauvaise autorité fournisseur, taille de KIR et marqueur FX incohérents : refus.

## État et prochaines preuves réelles

- **AliExpress** : KIR-000009 ; 20/20 produits classifiés sur staging
  par replay indépendant. Ce résultat ne prouve pas la boutique.
- **CJdropshipping** : KIR-000012 ; 20 reçus, 20 événements en erreur,
  0 candidats. Cause enregistrée : absence de taux USD/KMF approuvé.
  Une contre-épreuve *nouvelle* sur le code actuel doit prouver la conservation
  des candidats en WATCH et leur classification.
- **Autres fournisseurs** : utiliser le même contrat et les mêmes invariants,
  sans copie de règles métier ni seuil de fiabilité impossible à atteindre.
  Le `expected` est configurable (20 pour les campagnes courantes).

**GO transversal :** deux fournisseurs différents certifiés dans un parcours
réel récent, avec preuve par identité produit, plus les contre-exemples verts
de l'évaluateur. La certification multi-fournisseur n'est pas encore acquise.
