# Doctrine — Mutualisation et refacturation des coûts plateforme par marché

> **Version** : 1.0 — 2026-09-06
> **Statut** : doctrine spécialisée — complète `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md`
> **Périmètre** : Railway, Cloudinary, Twilio fixe et autres charges techniques partagées de structure

---

## 1. Phrase de vérité

> **Une charge plateforme partagée est une charge de structure de période (N3). Elle peut être ventilée par marché pour lecture ou refacturation, mais elle ne devient jamais un coût variable d'article.**

Railway, Cloudinary, la part fixe de Twilio et les services techniques équivalents sont des moyens communs nécessaires à l'exploitation de Komerce. Leur ventilation par `market_id` sert à expliquer qui consomme la structure et, si un contrat l'autorise, à déterminer une quote-part refacturable.

Cette ventilation ne crée jamais une nouvelle division dans le CDR article.

---

## 2. Imputation interne et refacturation sont deux vues d'une même vérité

**Imputation interne** : convention de lecture. Elle sert à piloter un marché et à comprendre sa consommation de structure.

**Refacturation** : mouvement d'argent réel vers une entité ou un partenaire contractuellement facturable.

Les deux vues portent sur la même charge économique de période. Elles ne peuvent pas produire deux coûts cumulables.

Invariant de conservation :

```text
Σ quotes-parts de marché = charge économique du pool partagé sur la fenêtre canonique
```

Si le mode est `partner_reinvoice`, la somme des quotes-parts facturables reste égale au pool économique refacturable, sous réserve des règles contractuelles explicites. Il est interdit de refacturer 100 % du pool puis de réinjecter le même coût dans les CDR produits.

---

## 3. Rôle opérationnel ≠ statut de facturation

Le rôle RBAC `market_operator` ne détermine jamais si une personne ou un marché est facturable.

Deux modes sont doctrinalement distincts :

- `internal_allocation` : responsable pays interne ; allocation de pilotage, aucune facture partenaire ;
- `partner_reinvoice` : entité ou partenaire avec base contractuelle explicite ; allocation susceptible de devenir une facture.

Par défaut, tant qu'aucun contrat de partenariat/facturation n'est établi, Komerce reste en `internal_allocation`.

Une modification du mode de facturation est un acte de gouvernance, pas une permission déduite du rôle utilisateur.

---

## 4. Fenêtre canonique unique

La ventilation plateforme utilise **la même fenêtre canonique que le gate de couverture du marché** : fenêtre glissante de largeur fixe, terminée au watermark de maturité.

Interdit : calculer la viabilité sur une fenêtre et la quote-part de structure sur un mois calendaire différent.

Les vues mensuelles restent possibles pour la comptabilité ou la trésorerie, mais elles ne deviennent pas une deuxième vérité économique.

---

## 5. Marchés éligibles à une assiette

Un drapeau administratif comme `markets.is_active` n'est jamais un diviseur économique.

Un marché n'entre dans une clé fondée sur l'activité que s'il présente une **activité constatée** sur la fenêtre canonique selon une règle gouvernée et versionnée.

Ainsi, créer un marché coquille ne doit jamais diluer la quote-part des autres marchés.

---

## 6. Clés de mutualisation : l'arbitrage doit être explicite

Un coût fixe partagé peut être ventilé selon plusieurs politiques légitimes. Aucune n'est neutre.

### Politique A — mutualisation pure

Répartition sur une assiette d'activité constatée (par exemple commandes payées, usage mesuré, stockage consommé selon le service).

Propriété assumée : le marché qui croît peut porter une part croissante d'une structure qui n'augmente pas au même rythme.

### Politique B — socle par marché + marginal

Chaque marché économiquement ouvert porte un socle fixe ; le reliquat est ventilé selon une assiette d'usage réel.

Cette politique reflète qu'un marché crée un coût de présence minimal avant même sa croissance.

### Invariant de gouvernance

Le choix entre ces politiques est un **arbitrage d'actionnaire / de groupe**. Il doit être daté, versionné, publié et expliqué aux marchés. Le moteur ne choisit jamais silencieusement la politique la plus favorable à un résultat.

---

## 7. Règles par type de coût

### Railway

Railway est une charge plateforme de structure. Sa quote-part par marché est une lecture N3 de période. Elle ne devient pas `railway_cost_per_item`.

La clé de répartition doit être gouvernée et fondée sur une assiette réellement observable si elle est variable.

### Cloudinary

Interdit : division par le nombre de `markets.is_active`.

Si Cloudinary est ventilé par marché, le diviseur ne comprend que les marchés ayant une activité constatée sur la fenêtre canonique, selon la règle d'éligibilité gouvernée. Une métrique d'usage direct vérifiable peut remplacer ce prorata lorsqu'elle devient disponible.

### Twilio et services similaires

La part strictement variable directement causée par une transaction ou un message peut rester un coût variable si elle est mesurable et doctrinalement classée N1/N2. La part d'abonnement, de minimum mensuel ou de capacité réservée reste N3.

Une même facture peut donc être scindée entre variable réel et structure, mais jamais comptée deux fois.

---

## 8. Couverture par marché et vérité globale

Le **gate d'autorisation est par marché**.

```text
market_coverage_ratio = contributions réconciliées du marché
                        / charge économique de structure attribuée au marché
```

Le ratio global groupe reste publié comme vérité de modèle, mais il ne donne aucune autorisation à un marché déficitaire.

Un marché rentable ne masque donc pas silencieusement un marché sous-couvert.

---

## 9. Marché en ouverture = conquête groupe explicite

Un nouveau marché ne peut pas être `COVERED` dès son lancement. L'ouverture est traitée comme une position de conquête au niveau groupe :

- budget d'expansion explicite ;
- date de début et de fin ;
- montant consommable ;
- responsable ;
- seuil d'arrêt ;
- visibilité séparée de la structure normale du marché.

Un marché sous couverture ne consomme jamais silencieusement la marge des autres.

---

## 10. Intégrité des assiettes et séparation des rôles

Les données servant d'assiette ne doivent pas être produites par celui qui supporte la quote-part lorsqu'une source indépendante existe.

Les commandes proviennent du système de paiement et les colis / événements Hub des flux opérationnels. Un `market_operator` ne peut donc pas minorer librement son volume pour réduire sa quote-part.

Cette séparation des rôles est un invariant d'intégrité économique.

---

## 11. Gouvernance obligatoire

Sont versionnés et auditables :

- appartenance d'une charge au pool groupe ou au pool marché ;
- classification fixe / variable ;
- clé de répartition ;
- politique `mutualisation pure` ou `socle + marginal` ;
- règle d'activité constatée ;
- fenêtre canonique ;
- taux de change appliqué ;
- mode `internal_allocation` / `partner_reinvoice` ;
- toute exclusion ou reclassification de charge.

Reclasser une charge groupe vers marché, ou l'inverse, est un acte gouverné : aucun changement de périmètre ne doit améliorer artificiellement un ratio de couverture.

---

## 12. Gaps de données assumés

À la date de cette version :

- `finance_config` est global/singleton et ne porte pas encore une vérité N3 par marché ;
- `charges` ne porte pas encore une attribution gouvernée groupe / marché ;
- le modèle de charge économique de période reste à matérialiser ;
- le gate de couverture par marché n'est pas encore calculable de façon décisionnelle.

Ces gaps interdisent de facturer automatiquement un partenaire sur cette doctrine seule.

---

## 13. Ce qui ne doit pas être codé encore

- Ne pas coder la refacturation partenaire avant le ratio de couverture réconcilié.
- Ne pas ajouter `market_id` à `charges` avant arbitrage de la frontière groupe / marché.
- Ne pas dupliquer `finance_config` par marché avant séparation N2 / N3 et définition du modèle de structure par marché.
- Ne pas utiliser `markets.is_active` comme diviseur.
- Ne pas créer un coût Railway / Cloudinary « par article » pour alimenter N1 ou N2.

---

## 14. Phrase de contrôle

> **Une quote-part plateforme explique ou facture une part de structure ; elle ne fabrique jamais un coût article supplémentaire.**
