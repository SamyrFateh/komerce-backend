# Komerce — État opératoire du chantier

> Mis à jour : **2026-06-14**  
> Repo : `SamyrFateh/komerce-backend` — branche de référence : `main`  
> Ce fichier remplace l'ancien suivi long V4.1 comme point d'état courant. L'historique reste disponible dans Git.

---

## 1. Point d'entrée

Lire dans cet ordre :

1. [`docs/README.md`](../README.md) — index documentaire actif ;
2. [`docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](../doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md) ;
3. [`docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](../implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md) ;
4. les docs techniques listées dans `docs/README.md` seulement si la zone touchée l'exige.

Ne pas reprendre le chantier depuis un ancien audit, un ancien prompt ou un document non listé dans `docs/README.md`.

---

## 2. Doctrine produit active

Le panier partagé est **Boutique First**.

```txt
Tout commence dans la boutique.
Tout se comprend dans la boutique.
Tout revient dans la boutique.
```

Règle : Komerce ne construit pas une cagnotte ni un workspace financier. Komerce matérialise un achat réel, visible, plafonné au reste dû.

---

## 3. État actuel — panier partagé

État de référence après réalignement documentaire :

- Entrée participant : `/boutique/?p=TOKEN`.
- Deux natures : `ready_to_pay` et `needs_validation`.
- Bouton argent : `Régler ma part`.
- Participant : lecture seule, snapshot produit, aucun ajout/modification/suppression.
- Paiement : seulement si le panier est en phase payable.
- Retour paiement : retour dans la boutique avec message de succès/annulation.
- Statuts humains : `En préparation`, `Ouvert au paiement`, `Fermé`, `Finalisé`, `Annulé`.

---

## 4. Dettes ouvertes à surveiller

- Vérifier en réel les tests manuels Cas A à E du guide d'implémentation.
- Vérifier que les anciens documents V4.1 ne sont plus utilisés comme source active.
- Vérifier que les textes créateur ne réintroduisent pas un vocabulaire de financement collectif.
- Vérifier que les crons et états internes V4.1 restent silencieux côté participant.

---

## 5. Tests prioritaires

Voir le détail dans [`docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](../implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md).

Résumé :

1. **Cas A — Prêt à payer** : création, lien, bouton `Régler ma part`, paiement, retour boutique, reste mis à jour.
2. **Cas B — À valider ensemble** : consultation sans paiement, ouverture plus tard, apparition du bouton.
3. **Cas C — Lecture seule** : fiche article snapshot, aucun bouton d'action.
4. **Cas D — Statuts** : aucun statut technique visible.
5. **Cas E — Dépassement du reste** : maximum annoncé et borné avant paiement.

---

## 6. Règle de mise à jour

Ce fichier doit rester court.

S'il dépasse son rôle d'état courant, déplacer le détail vers un document actif référencé dans `docs/README.md`, ou laisser l'historique dans Git.

Aucun nouveau document ne doit devenir opératoire sans être ajouté à `docs/README.md`.
