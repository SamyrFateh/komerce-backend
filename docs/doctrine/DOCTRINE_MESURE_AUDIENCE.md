# Doctrine — Mesure d'audience first-party

> **Version** : 0.1 — 2026-09-23
> **Statut** : doctrine proposée, non implémentée
> **Feature propriétaire proposée** : nouvelle feature `audience` (possède une table et un cycle de rétention — classification à confirmer selon `FEATURE_DOCTRINE.md`)
> **Features consommatrices** : `dashboard` (lecture d'agrégats), `recommendations`, relance panier
> **Débloque** : « Taux de conversion » du mock Commerce, « Top rayons » du mock Catalogue pays

---

## 1. Phrase de vérité

On ne pilote pas ce qu'on ne mesure pas. Mais la commande reste la seule vérité sur la vente : l'audience explique le parcours, elle ne recompte jamais les ventes.

## 2. Constat dans le code (2026-09-23)

- **Aucune table de visite, de session, de vue produit ou de clic** dans le schéma.
- `recommendations` classe uniquement à partir de `orders` et `order_items`.
- Le taux de conversion (mock Commerce) est documenté comme non calculable dans `DASHBOARD_MOCK_CONFORMANCE_AUDIT_V1.md`.
- La boutique est une PWA (`public/manifest.json`, `public/sw.js`) ; le service worker ignore déjà `/api/`.

## 3. Événements retenus (V1)

| Événement | Moment | Ne contient jamais |
|---|---|---|
| `page_view` | affichage d'une page boutique | identité, téléphone |
| `product_view` | ouverture d'une fiche produit | prix recalculé côté navigateur |
| `add_to_basket` | ajout au panier | contenu complet du panier |
| `checkout_start` | entrée dans le checkout | données de paiement |

La vente elle-même **n'est pas un événement d'audience** : elle se lit dans `orders`. La conversion se calcule en joignant les sessions aux commandes, jamais en comptant des événements « achat ».

## 4. Invariants

1. **First-party uniquement par défaut.** Aucun traceur tiers ajouté sans décision explicite du propriétaire.
2. **Session anonyme.** Identifiant aléatoire, sans empreinte navigateur, sans IP brute stockée. Le rattachement à un utilisateur connecté est optionnel, jamais rétroactif.
3. **Le marché vient du serveur.** Comme partout dans Komerce, jamais d'un paramètre client.
4. **Non bloquant et léger.** Envoi groupé en tâche de fond ; un échec est silencieux et n'affecte jamais l'affichage ni le checkout. Compatible faible connexion.
5. **Robots filtrés** avant toute agrégation.
6. **Rétention bornée.** Les événements bruts expirent ; seuls des agrégats sont conservés au-delà.
7. **Le dashboard lit des agrégats.** Aucun dashboard n'interroge les événements bruts.

## 5. Hors périmètre / interdits

- Recompter les commandes, le CA ou les paniers à partir des événements.
- Stocker des données personnelles dans un événement.
- Enregistrement de session (replay), cartes de chaleur, fingerprinting.

## 6. Gates à prouver avant exposition

- **P0 juridique** : conditions d'exemption de consentement pour la mesure d'audience en droit européen (Mayotte, diaspora) — à qualifier, pas à supposer. Si l'exemption ne s'applique pas, la collecte dépend de `DOCTRINE_CONSENTEMENT_COMMUNICATION.md`.
- Preuve en conditions réelles qu'un échec d'envoi ne ralentit ni ne casse la boutique.
- Preuve que la conversion calculée concorde avec `orders` sur une période témoin.

## 7. Première tranche

Table d'événements bruts + endpoint d'ingestion groupée (validation stricte des types, marché serveur, rejet silencieux des formats inconnus), balise boutique pour `page_view` et `product_view` uniquement, agrégat journalier par marché. Aucun dashboard modifié dans cette tranche.
