# Doctrine — Avis clients vérifiés

> **Version** : 0.1 — 2026-09-23
> **Statut** : doctrine proposée, non implémentée
> **Feature propriétaire proposée** : nouvelle feature `reviews` (possède une table et un cycle de modération — classification à confirmer selon `FEATURE_DOCTRINE.md`)
> **Features consommatrices** : `catalog` / boutique (affichage), `recommendations`, `dashboard`
> **Dépend de** : `DOCTRINE_CONSENTEMENT_COMMUNICATION.md` (pour solliciter un avis)

---

## 1. Phrase de vérité

La confiance est le premier frein à l'achat en ligne sur nos marchés. Un avis n'a de valeur que s'il vient d'un vrai client qui a vraiment reçu l'article.

## 2. Constat dans le code (2026-09-23)

- **Aucune table d'avis, de note ou de témoignage** dans le schéma ; aucune route.
- Le retrait au relais est tracé et sécurisé (code secret, tentatives limitées) : c'est la preuve d'achat la plus forte dont Komerce dispose.
- Le média passe déjà par le pipeline catalogue existant.

## 3. Séparation des objets

| Objet | Rôle | Ce qu'il ne fait pas |
|---|---|---|
| Avis | Note + texte d'un acheteur vérifié sur un produit | N'est pas un canal de réclamation |
| Litige (`disputes`, owner `orders`) | Traiter un problème de commande | Ne se publie jamais |
| Réponse marchand | Réponse publique à un avis | Ne modifie pas l'avis |

## 4. Cycle de vie

```txt
Commande retirée → éligible → avis soumis → PENDING (modération)
→ PUBLISHED | REJECTED (motif obligatoire) → éventuellement WITHDRAWN par l'auteur
```

## 5. Invariants

1. **Achat vérifié uniquement.** Seul l'acheteur d'une ligne de commande **retirée** peut noter ce produit. Un avis par produit et par commande.
2. **Pas d'avis acheté.** Aucune récompense (fidélité, wallet, remise) conditionnée au contenu ou à la note d'un avis.
3. **Pas de censure des avis négatifs.** Un rejet n'est possible que pour un motif de politique écrit (injure, données personnelles, hors sujet), jamais parce que la note est basse.
4. **Seuil d'affichage.** Une note moyenne n'est affichée qu'au-delà d'un nombre minimal d'avis ; en dessous, on affiche les avis sans moyenne.
5. **Le problème va au litige.** Un avis signalant un défaut propose au client d'ouvrir un litige ; la résolution suit le circuit `orders` / `refunds` existant.
6. **Pas de données personnelles publiées.** Prénom et initiale au plus ; aucun téléphone, aucune adresse.
7. **Marché explicite.** Un même produit vendu dans plusieurs marchés : l'avis porte le marché de la commande ; l'affichage par défaut suit le marché du visiteur.

## 6. Hors périmètre / interdits

- Import d'avis depuis un fournisseur ou une place de marché externe présentés comme des avis Komerce.
- Note calculée côté navigateur.
- Sollicitation d'avis sans consentement `SOLLICITATION_AVIS`.

## 7. Gates à prouver avant exposition

- Preuve en base réelle : un non-acheteur, un acheteur non retiré et un second avis sur la même commande sont refusés.
- Politique de modération écrite et validée avant la première publication.

## 8. Première tranche

Table d'avis + contrôle d'éligibilité serveur + soumission par le client depuis son historique de commandes + modération admin. Affichage public dans une tranche suivante, une fois quelques avis réels modérés.
