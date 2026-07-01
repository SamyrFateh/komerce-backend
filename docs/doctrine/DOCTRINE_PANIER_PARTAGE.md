# Doctrine Komerce — Panier partagé v4 à engagements indicatifs

> **Version** : pré-2026 — non datée. Revue de conformité requise (audit 2026-07-01).

> Version 4.2 — 27 mai 2026  
> Remplace la doctrine v4.1. Étend v4.1 avec les mécaniques de cycle de vie du panier boutique (N4-CLEAR, rebuild snapshot, notifications d'update), le flow d'ajustement engagement participant, et le contrat UX des formulaires groupe.  
> Cible produit/backend : **panier ouvert en concertation, engagements indicatifs modifiables, paiements réels seulement après passage au règlement, créateur maître de la finalisation**.
>
> Important : le code actuel peut encore contenir l'ancien modèle de contribution payée avant finalisation. Les PR suivantes devront aligner backend et front.

---

## 1. Principe fondamental

Le panier partagé Komerce reste une capacité naturelle de la boutique, mais il ne doit plus être pensé comme une collecte Stripe immédiate.

Le nouveau modèle :

```txt
Panier ouvert / concertation
→ le créateur peut modifier le panier
→ les participants peuvent modifier leurs engagements indicatifs
→ le groupe converge vers une version acceptable
→ aucun paiement bloqué
→ aucune préautorisation Stripe
→ rien n'est encore figé

Passer au règlement
→ le créateur arrête une version de référence du panier
→ les engagements actifs sont verrouillés
→ une fenêtre de règlement s'ouvre

Panier en règlement
→ les participants paient réellement
→ si certains ne paient pas, le créateur ajuste, compense ou annule
→ la commande peut être finalisée malgré les écarts
```

Philosophie :

```txt
On se concerte d'abord.
On fige quand le groupe est prêt.
On règle ensuite.
Le créateur garde la main pour conclure.
```

---

## 2. Pourquoi changer

L'ancien modèle `contribution payée immédiatement` est trop lourd :

- paiement demandé avant que le panier soit réellement finalisé ;
- changement de panier difficile après paiement ;
- remboursements ou exceptions si le panier change ;
- UX participant trop engageante ;
- backend plus complexe : webhooks, surpaiement, paiements tardifs, refund queue ;
- risque de bloquer de l'argent trop tôt.

Le modèle cible est plus simple :

```txt
Engagement indicatif d'abord.
Paiement réel seulement après passage au règlement.
Finalisation pilotée par le créateur.
```

---

## 3. Identité client : téléphone + nom

Komerce ne doit pas supposer que les clients ont ou maîtrisent un email.

L'identité client doit pouvoir fonctionner avec :

```txt
nom affiché + numéro de téléphone
```

Le nom seul n'est pas fiable : plusieurs personnes peuvent avoir le même nom.

Le téléphone est le meilleur identifiant pratique, mais il n'est pas parfait : numéro mal saisi, numéro changé, téléphone familial partagé, homonymes nombreux.

Règle :

```txt
Le nom sert à reconnaître humainement.
Le téléphone sert à contacter et retrouver.
Le backend ne doit jamais supposer que le nom est unique.
```

---

## 4. Acteurs

| Acteur | Rôle |
|---|---|
| Créateur | Compose, invite, suit, passe au règlement, ajuste, finalise ou annule |
| Participant | Déclare/modifie un engagement indicatif puis paie après passage au règlement |
| Bénéficiaire local | Peut recevoir/retrouver sans piloter le panier |
| Stripe | Intervient seulement pendant le règlement réel |
| Cash / agent relais | Peut confirmer un paiement local après passage au règlement si activé |
| Backend | Trace, borne, expire, protège les transitions |
| Admin | Supervise les exceptions, remboursements ou avoirs |

---

## 5. Cycle de vie cible

### 5.1 Création

```txt
Panier boutique courant
→ Payer en groupe / Faire participer
→ titre optionnel
→ identité minimale du créateur si guest
→ token public
→ lien WhatsApp
→ onglet Groupe
```

À ce stade : aucun participant n'a payé, aucun engagement n'est exigible, le panier peut encore évoluer, et le suivi vit dans l'onglet Groupe.

#### N4-CLEAR — Vidage du panier boutique à la création

À la création réussie d'un panier partagé, **le panier boutique du créateur est systématiquement vidé**, côté serveur et côté client.

Raisons :

```txt
1. Le panier vient d'être capturé comme snapshot dans shared_cart_items.
2. Laisser le panier rempli créerait une confusion : ce panier visible
   en boutique n'est plus "son" panier, il appartient au groupe.
3. La boutique doit redevenir disponible pour un nouveau panier personnel.
```

Règle N4-CLEAR :

```txt
Si createSharedCart() réussit sans exception :
→ backend : clearCreatorBasketInTx() dans la même transaction
→ frontend : clearCart() inconditionnellement après la réponse
→ pas de condition sur clear_local_cart dans la réponse
→ état localStorage aligné sur état DB
```

Le snapshot figé (`shared_cart_items`) survit indépendamment du vidage. Il reste la référence immuable des articles du groupe.

Le créateur voit son panier boutique vide après création. C'est le comportement correct.

### 5.2 Panier ouvert : phase de concertation

Le panier ouvert est une phase de réunion de groupe.

Pendant cette phase :

- le créateur peut ajouter, retirer ou ajuster des articles ;
- les participants peuvent annoncer, augmenter, réduire ou retirer leurs engagements ;
- le groupe peut discuter hors Komerce, par exemple sur WhatsApp ou en réunion familiale ;
- l'interface peut afficher une contribution moyenne indicative ;
- aucun paiement participant n'est possible ;
- aucun argent n'est bloqué ;
- le panier n'est pas encore une commande.

Objectif : permettre au groupe de converger naturellement vers une version réaliste du panier.

#### Mécanique de modification du panier par le créateur

Après N4-CLEAR, le panier boutique du créateur est vide. Pour modifier le panier partagé, il y a deux chemins :

**Chemin A — le créateur remet des articles dans sa boutique :**

```txt
Le créateur navigue en boutique → ajoute les articles voulus
→ clique "Modifier les articles" dans l'onglet Groupe
→ les articles actuels du panier boutique remplacent le snapshot
```

**Chemin B — le panier boutique est toujours vide (cas habituel après création) :**

```txt
Le créateur clique "Modifier les articles"
→ le frontend détecte que state.cart est vide
→ appel GET /api/shared-carts/:id/as-cart-items
→ le snapshot est rechargé en mémoire comme panier boutique temporaire
→ state.cart est reconstruit depuis les items du snapshot
→ saveCart() persiste en localStorage (badge + sidebar cohérents)
→ le créateur voit ses articles comme s'il venait de les ajouter
→ modale de confirmation avec total estimé (snapshot)
→ PUT /api/shared-carts/:id/items avec { product_id, quantity }
```

Règles du rebuild snapshot :

```txt
- price_kmf dans l'objet produit reconstruit = unit_price_kmf_snapshot (déjà promoé)
- promo_pct = 0 explicite (empêche double application de remise dans renderSideCart / newTotal)
- is_promo = false explicite
- variant_label absent (non stocké dans le snapshot) → chip de variante omis, acceptable
- promo_price_kmf absent → buildCartShareURL retombe sur price_kmf → correct
- Le total affiché dans la modale est le total snapshot, pas le prix DB courant
  → le serveur recalcule toujours depuis la DB à la réception du PUT
```

#### Notifications d'update aux participants (S2-06)

À chaque `PUT /:id/items` réussi, les participants qui ont un engagement actif (`pledged`, `locked_for_settlement`) et un numéro de téléphone sont notifiés par WhatsApp (template `shared_cart_items_updated`).

Ces notifications sont **best-effort** (post-commit, `setImmediate`) : un échec de notification n'annule pas la modification du panier. Les erreurs sont tracées dans `shared_cart_events`.

```txt
Colonnes correctes : participant_phone, SPLIT_PART(participant_name, ' ', 1) AS first_name
Statuts notifiés : 'pledged', 'locked_for_settlement'
Statuts fantômes à ne pas utiliser : 'pending', 'confirmed' (n'existent pas dans l'enum)
```

### 5.3 Engagements indicatifs

Un participant peut annoncer :

```txt
Fatima : 10 000 KMF
Ali : 15 000 KMF
Nadia : 20 000 KMF
```

Ces engagements servent à piloter le panier. Ils ne sont pas un paiement, une dette gérée par Komerce, une autorisation Stripe bloquée, un solde retirable ou une garantie de paiement.

Tant que le panier est ouvert, ces engagements restent modifiables.

### 5.4 Évolution avant passage au règlement

Avant passage au règlement, le créateur peut ajouter ou retirer des articles, changer des quantités, inviter, relancer, annuler ou ajuster l'information de contribution moyenne.

Si le total change, les engagements restent indicatifs.

Le système peut afficher une aide discrète :

```txt
À participation égale : environ 12 000 KMF par participant.
```

Cette suggestion n'est jamais contraignante.

### 5.5 Passage au règlement

Le passage au règlement signifie :

```txt
Le groupe a convergé. On fige et on passe au paiement.
```

À ce moment : la version du panier est gelée pour initier le règlement, le total initial attendu est défini, les engagements actifs sont verrouillés, une fenêtre de règlement s'ouvre, les participants sont notifiés, et le créateur garde la main pour ajuster le panier en cas de défaut de paiement.

Le passage au règlement n'est pas encore la commande ferme.

### 5.6 Règlement après passage au règlement

Les paiements partiels n'ont lieu que pendant la fenêtre de règlement.

Modes possibles : Stripe, cash confirmé par agent/admin, compensation par le créateur.

```txt
Panier ouvert : engagement seulement.
Panier en règlement : paiement réel.
```

### 5.7 Finalisation

Le créateur peut finaliser quand il a une solution viable.

```txt
Cas A — Tout est payé
→ commande créée normalement

Cas B — Il manque une partie
→ le créateur compense, réduit le panier, attend ou annule

Cas C — Trop d'engagements non honorés
→ le créateur annule ou reconstruit un panier plus simple
```

Règle centrale :

```txt
Le créateur doit pouvoir finaliser quoi qu'il arrive,
soit parce que tout est payé,
soit parce qu'il compense,
soit parce qu'il ajuste la commande,
soit parce qu'il annule.
```

---

## 6. Droits du créateur

Pendant le panier ouvert, le créateur peut modifier le panier, inviter, relancer, annuler, retirer un participant de la vue active si nécessaire, ajuster l'information de contribution moyenne, puis passer au règlement.

Après passage au règlement, il peut suivre les paiements, relancer, prolonger dans une limite backend, compenser lui-même, réduire ou ajuster la commande, finaliser, annuler.

---

## 7. Cas limites à blinder

### 7.1 Engagement non honoré

Un participant s'est engagé mais ne paie pas après passage au règlement.

Le backend doit afficher l'écart et laisser le créateur décider :

```txt
relancer
attendre
compenser
retirer des articles
réduire la commande
annuler
```

### 7.2 Participant change d'avis pendant le panier ouvert

L'engagement étant indicatif, il peut être modifié ou retiré à tout moment pendant la phase ouverte. Le créateur voit l'évolution en temps réel (polling 30s).

#### Flow d'ajustement d'engagement participant

```txt
Participant ouvre le lien public du panier
→ entre son numéro de téléphone
→ GET /api/shared-carts/public/:token/commitments/by-phone
→ si engagement existant trouvé :
    formulaire prérempli (nom, montant, message)
    bouton "Modifier mon engagement"
    bouton "Retirer mon engagement"
→ si aucun engagement trouvé :
    formulaire vierge d'engagement indicatif
```

**Modification :**

```txt
PATCH /api/shared-carts/public/:token/commitments
→ upsert par participant_phone
→ statut écrit : 'updated' (distinct de 'pledged' pour traçabilité)
→ lockCommitmentsForSettlement gère 'pledged' ET 'updated'
→ le créateur voit le montant révisé dans l'onglet Groupe
```

**Retrait :**

```txt
DELETE /api/shared-carts/public/:token/commitments/:id (ou PATCH status='withdrawn')
→ statut : 'withdrawn'
→ engagement n'est plus affiché, n'est plus locké au passage au règlement
→ le créateur voit l'engagement disparaître
```

Règle : un engagement `locked_for_settlement` ne peut plus être modifié ni retiré par le participant. Toute tentative doit retourner une erreur claire (`commitment_locked`).

### 7.3 Participant ne paie pas après passage au règlement

L'engagement devient `non honoré`. Le backend ne doit pas créer une dette complexe. Il doit exposer l'état :

```txt
engagé
attendu
non payé
relancé
abandonné / remplacé / compensé
```

### 7.4 Créateur annule pendant le panier ouvert

Effet : les engagements tombent, aucun remboursement, notification participants, panier `cancelled`.

### 7.5 Créateur annule après passage au règlement sans paiement

Effet : engagements attendus annulés, aucun remboursement, notification participants.

### 7.6 Créateur annule après paiements confirmés

Effet : paiement à rembourser ou transformer en avoir selon doctrine financière, traçabilité obligatoire, visibilité admin.

### 7.7 Paiement hors délai

Le backend doit refuser si possible avant paiement. Sinon : marquer en exception, ne pas comptabiliser silencieusement, exposer à l'admin.

### 7.8 Stock indisponible à la finalisation

Le stock réel doit être revérifié à la finalisation. Si un article n'est plus disponible : retirer/remplacer, recalculer, gérer l'écart de paiement, ne jamais créer une commande avec un stock faux.

### 7.9 Surpaiement après ajustement

Si le panier final devient inférieur aux paiements confirmés :

```txt
Paiements confirmés : 100 000 KMF
Panier final : 85 000 KMF
Surplus : 15 000 KMF
```

Le surplus doit devenir avoir, remboursement ou traitement manuel explicite. Jamais absorbé silencieusement.

---

## 8. Statuts cibles

### 8.1 Panier partagé

```txt
draft
→ active
→ commitment_open
→ closed_for_settlement
→ settlement_in_progress
→ ready_to_finalize
→ converted_to_order
```

Branches :

```txt
active / commitment_open → cancelled
closed_for_settlement / settlement_in_progress / ready_to_finalize → cancelled_pending_refund si paiements confirmés
closed_for_settlement / settlement_in_progress / ready_to_finalize → expired si aucun paiement confirmé
```

Noms exacts à stabiliser côté backend.

### 8.2 Engagement participant

| Statut | Sens |
|---|---|
| `pledged` | Engagement indicatif déclaré |
| `updated` | Engagement modifié |
| `withdrawn` | Engagement retiré avant passage au règlement |
| `locked_for_settlement` | Engagement figé au passage au règlement |
| `payment_pending` | Paiement attendu pendant la fenêtre |
| `paid` | Paiement confirmé |
| `not_honored` | Engagement non réglé dans le délai |
| `covered_by_creator` | Créateur a compensé |
| `cancelled` | Engagement annulé avec le panier |

---

## 9. Règles financières cibles

```txt
1. Panier ouvert : aucun paiement requis.
2. Panier ouvert : aucun paiement Stripe bloqué.
3. Panier ouvert : les engagements sont indicatifs et modifiables.
4. Passage au règlement : les engagements actifs sont verrouillés.
5. Panier en règlement : la fenêtre de règlement ouvre les paiements réels.
6. Le créateur peut compenser ou ajuster.
7. La commande ferme naît seulement à la finalisation.
8. Tout paiement confirmé doit être tracé.
9. Aucun surplus ne doit disparaître silencieusement.
10. Aucun paiement hors délai ne doit être compté silencieusement.
11. Toute annulation avec paiements confirmés crée un traitement financier explicite.
```

---

## 10. Ce qui est interdit

Ne pas réintroduire : préautorisation Stripe avant passage au règlement, blocage d'argent pendant la phase d'engagement, workspace séparé, tontine, pot commun retirable, dette complexe imposée aux participants, finalisation impossible parce qu'un participant n'a pas payé, absorption silencieuse d'un trop-payé, création d'une commande sans décision finale du créateur.

---

## 11. Ce qui est autorisé

Compatible doctrine : panier ouvert comme phase de concertation, engagements libres et modifiables, panier modifiable avant passage au règlement, montant moyen suggéré, relances WhatsApp, retrait ou modification d'engagement avant passage au règlement, passage au règlement par le créateur, fenêtre de règlement courte, compensation par le créateur, ajustement du panier après non-paiement, annulation avant ou après passage au règlement, remboursement/avoir si paiement confirmé puis annulation, plusieurs paniers partagés actifs dans la limite backend.

---

## 12. Contrat UX — Formulaires groupe

Les formulaires du panier partagé (engagement indicatif, paiement participant, identification par téléphone) **doivent être visuellement identiques aux formulaires du checkout boutique et du suivi de commande**.

### 12.1 Pourquoi

```txt
Le panier partagé est une capacité naturelle de la boutique (doctrine §1).
Un formulaire visiblement différent rompt la cohérence et crée de la méfiance.
Un participant qui voit un formulaire "inconnu" peut hésiter à s'engager.
Le checkout et le suivi de commande ont déjà validé la confiance utilisateur.
```

### 12.2 Règles visuelles obligatoires

| Élément | Référence à respecter |
|---|---|
| Couleur de fond des inputs | identique au checkout (`k-ck-input` / `k-ck-km-input`) |
| Border-radius des inputs | identique |
| Padding interne des inputs | identique |
| Couleur de bordure (focus / erreur) | identique |
| Label (position, taille, couleur) | identique au checkout |
| Bouton principal | identique au CTA checkout (couleur, taille, font-weight) |
| Bouton secondaire / ghost | identique aux actions secondaires du checkout |
| Message d'erreur inline | même style que les erreurs de formulaire checkout |
| Espacement entre champs | identique |

### 12.3 Ce qui peut différer

```txt
- Le contenu des labels (les mots, pas le style)
- Les icônes ou emoji d'accompagnement
- Le titre de section (ex : "Déclarer mon engagement")
- Les placeholders spécifiques au contexte groupe
```

### 12.4 Implémentation

Les classes CSS `k-group-input`, `k-group-label`, `k-group-btn` doivent dériver visuellement des tokens checkout. En pratique :

```css
/* b-group-view / group-cart-flow.css */
.k-group-input   { /* même apparence que k-ck-input */ }
.k-group-label   { /* même apparence que k-ck-label */ }
.k-group-btn--primary  { /* même apparence que le bouton primaire checkout */ }
.k-group-btn--ghost    { /* même apparence que le bouton secondaire checkout */ }
```

Une divergence visible entre les deux formulaires est une non-conformité doctrine.

### 12.5 Cohérence multi-contexte

Le même contrat s'applique à tous les formulaires groupe :

```txt
- Formulaire d'engagement indicatif (participant, phase ouverte)
- Formulaire de paiement (participant, phase règlement)
- Formulaire d'identification par téléphone (retrouver un engagement)
- Formulaire de modification d'engagement
- Formulaire de création du panier partagé (titre, identité créateur guest)
```

---

## 13. Résumé exécutif

```txt
Panier partagé Komerce v4.2 =
  panier boutique réel
+ lien WhatsApp
+ N4-CLEAR à la création (panier boutique vidé, snapshot préservé)
+ panier ouvert comme phase de concertation
+ engagements indicatifs modifiables par les participants
+ rebuild snapshot pour modification du panier par le créateur
+ notifications WhatsApp sur update articles (best-effort)
+ aucune préautorisation Stripe
+ passage au règlement par le créateur
+ fenêtre de règlement réel
+ ajustement ou compensation si engagements non honorés
+ finalisation créateur
+ annulation possible
+ formulaires groupe visuellement identiques au checkout
```

La philosophie :

```txt
On ne bloque pas l'argent trop tôt.
On laisse le groupe se concerter.
On fige quand le groupe est prêt.
On donne au créateur la main pour conclure.
Le backend protège les transitions et trace les exceptions.
```
