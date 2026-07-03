# Doctrine Annulation Komerce

> **Version** : 1.1 — 2026-07-02 (resserrement : commande ferme dès l'achat fournisseur)
> **Statut** : document fondamental — complète DOCTRINE_NON_CONFORMITE.md (l'annulation est un choix du client ; la non-conformité est un défaut du produit — deux régimes qui ne se mélangent jamais)
> **Code porteur** : `routes/orders/cancel.js`, `services/order-status-machine.js`, `routes/hub-mark-ordered.js`
> **Changelog v1.1** : F2 devient une demande discrétionnaire wallet-only (plus un droit), F3 fermée (force majeure hors barème), badge « Remboursable / Ferme » dans le suivi, barèmes multiples supprimés.

---

## 1. Phrase de vérité

> **La générosité vit avant l'achat fournisseur, et meurt à l'achat
> fournisseur. Avant `ordered` : 100 %, sans discussion. Après : la
> commande est ferme.**

Justification structurelle : sur un cycle long Dubai–Comores, chaque commande
annulable tardivement est une option gratuite que le client détient sur la
trésorerie de Komerce pendant trois semaines. Un commerce local peut être
laxiste — son cycle est court. Komerce, structurellement, ne peut pas.
Et culturellement : on peut toujours **assouplir** une règle ferme ; on ne
peut jamais **durcir** une règle laxiste sans casser la confiance. On démarre
ferme.

## 2. La promesse client — deux phrases, zéro tableau

> *« Annulation gratuite et remboursement à 100 % tant que votre produit
> n'est pas acheté — et 24 h minimum, quoi qu'il arrive.
> Une fois votre produit acheté, votre commande est ferme. »*

C'est tout ce que le client doit savoir. Simple à expliquer au téléphone,
au relais, sur WhatsApp — par n'importe qui, sans tableau de pourcentages.

## 3. Le badge de suivi — la règle rendue visible

Le suivi de commande porte en permanence un badge d'état d'annulation, et
**son basculement est la pédagogie** :

| Moment | Badge affiché | Réalité |
|---|---|---|
| Avant `ordered` (ou dans le plancher 24 h) | 🟢 **Remboursable — annulation gratuite** | bouton annuler actif, 100 % |
| Dès `ordered` | 🔒 **Commande ferme — produit acheté** | bouton annuler retiré, remplacé par « demander une annulation » |

Le franchissement du jalon déclenche une notification (« Votre produit a été
acheté à Dubaï — votre commande est maintenant ferme ») : le client voit la
règle vivre en temps réel au lieu de la découvrir au moment de cliquer.
Pas de surprise = pas de litige de principe.

## 4. Les fenêtres

| Fenêtre | Jalon | Régime |
|---|---|---|
| **F1 — Remboursable** | avant `ordered`, plancher 24 h | **Droit** : annulation en un clic, 100 %, wallet ou cash au choix. Aucune justification demandée, aucune limite de fréquence — ça ne coûte rien, plafonner serait punir la confiance. |
| **F2 — Ferme, achetée** | `ordered` → scellé conteneur | **Demande, pas un droit** : bouton « demander une annulation » → file admin. Accordée au cas par cas ; si accordée : **wallet uniquement** (`CANCEL_REQUEST_WALLET_PCT`, 100 par défaut). Le cash ne ressort jamais après paiement fournisseur — la trésorerie ne fait pas l'aller-retour. Produit revendable → retour stock/catalogue. |
| **F3 — Ferme, embarquée** | scellé → arrivée | **Fermée.** Le produit arrivera, la commande sera honorée. Force majeure réelle (décès, départ définitif du territoire) : geste commercial exceptionnel, admin niveau 2, hors barème et **hors affichage** — un barème publié pour l'exception crée la règle. |
| **F4 — Arrivée** | `available` au relais | Pas de l'annulation : circuit no-show (relances, délai de garde, puis `unsold_items`). |

`collected` reste terminal : après collecte, tout relève de la doctrine
non-conformité.

## 5. Cas particuliers

- **Payeur ≠ destinataire** : tout remboursement (F1) ou avoir (F2 accordée)
  retourne au **payeur**, jamais au destinataire.
- **Paniers partagés v4.2** : un engagement indicatif non payé se retire
  librement (c'est sa définition) ; une commande issue d'un panier payé suit
  les fenêtres ci-dessus.
- **Multi-articles** : chaque article suit la fenêtre de SON état — un
  article non encore `ordered` reste remboursable pendant que l'autre est
  ferme. Frais fixes remboursés uniquement en annulation totale F1.
- **Sur-mesure / spécifique** : mêmes règles — l'achat fournisseur arrive
  simplement plus vite, et le badge bascule avec lui. Pas de régime spécial :
  le badge dit la vérité, ça suffit.

## 6. Gestion responsable — qui décide quoi

| Acteur | Pouvoir |
|---|---|
| Client | Annule librement en F1 ; demande en F2 ; rien en F3/F4 |
| Système | Affiche le badge, exécute le remboursement F1, route la demande F2, notifie les bascules |
| Admin | Accorde/refuse les demandes F2 (motif tracé), gestes force majeure F3 en niveau 2 |
| Agent (hub/relais) | **Rien** — jamais d'arbitrage terrain (R2) |

Compteur informatif (jamais bloquant) : demandes F2 par téléphone sur 180 j,
visible admin — l'outil du jugement humain, pas une sanction algorithmique.

## 7. Synergies

- Une F1 ou F2 accordée avant scellé **libère des dm³** : le produit sert la
  liste d'attente ou la précommande (doctrine densité de valeur).
- Les motifs d'annulation F1 nourrissent le sourcing : une référence
  sur-annulée avant achat est un signal de prix ou de délai perçu.

## 8. Clés business_rules (simplifiées — 3 clés au lieu de 8)

| Clé | Défaut | Rôle |
|---|---|---|
| `CANCEL_FREE_WINDOW_HOURS` | 24 (existante) | Plancher de protection : droit plein garanti même si achat rapide |
| `CANCEL_REQUEST_WALLET_PCT` | 100 | Avoir wallet quand une demande F2 est accordée |
| `CANCEL_PARTIAL_REFUND_PCT` | 80 (existante) | **Dépréciée** — fallback du code jusqu'au patch A-2, puis retrait (pattern C5) |

## 9. Règles à ne pas casser

- Ne jamais faire payer une annulation avant `ordered` (F1 = 100 %, toujours).
- Ne jamais retirer le plancher 24 h : c'est une promesse, pas un paramètre.
- Ne jamais sortir du cash après paiement fournisseur — wallet uniquement.
- Ne jamais publier de barème pour la force majeure F3 : geste hors barème,
  hors affichage, niveau admin 2, motif tracé.
- Ne jamais rembourser le destinataire à la place du payeur.
- Ne jamais laisser un agent arbitrer (le système affiche, l'admin décide).
- Ne jamais afficher un badge qui ne dit pas exactement ce que le code fait :
  le badge EST le contrat.
- Ne jamais mélanger annulation (choix client) et non-conformité (défaut
  produit).

## 10. Séquencement

| Lot | Contenu | Dépendance |
|---|---|---|
| A-1 | Cette doctrine + 1 clé nouvelle (`CANCEL_REQUEST_WALLET_PCT`) | aucune |
| A-2 | Patch `orders/cancel.js` : F1 par état (`ordered_at` OU plancher 24 h) → 100 % ; refus propre au-delà avec message « commande ferme — faire une demande » | A-1 |
| A-3 | Badge Remboursable/Ferme sur le suivi + notification de bascule à `ordered` | A-2 |
| A-4 | Demande F2 : bouton → file admin (accord = avoir wallet tracé, refus = motif) ; compteur informatif 180 j | A-2 |
| A-5 | Dépréciation `CANCEL_PARTIAL_REFUND_PCT` (pattern C5) | A-2 + 2 semaines |

**Note d'implémentation A-2** : le jalon F1→F2 est `ordered` (la machine à
états le porte déjà via hub-mark-ordered) — le patch remplace le calcul
horloge par ce jalon, en conservant l'horloge comme plancher. Le jalon
F2→F3 (scellé) ne sert qu'à fermer les demandes F2 : à lire côté
`customs_shipments`, à vérifier au moment du code.
