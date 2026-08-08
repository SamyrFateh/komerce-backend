# Komerce — Liste partagée

> **Version** : 2026-08 — alignée sur le modèle minimal post-migrations 123/124/125.

## Doctrine intemporelle · Boutique First

> **Chacun gère sa négo. Komerce sait matérialiser l'achat.**

Ce document n'est pas une spécification. Les specs vieillissent, les routes changent, les statuts se renomment. Ceci est la direction. Quand un choix se présente et qu'on hésite, on revient ici.

---

## 1. La phrase

**Une liste partagée n'est pas un checkout partagé.**

C'est une sélection publiée, figée, accessible par lien. Tout lien partagé ouvre d'abord la boutique. Le paiement n'est jamais le point d'entrée : il est une action possible *à l'intérieur* de la vue panier.

**La négociation appartient aux humains. La matérialisation appartient à Komerce.**

Qui paie, combien, pourquoi, dans quel ordre, après quel coup de téléphone : c'est la famille, la diaspora, les liens qui existaient déjà avant nous. Komerce n'arbitre pas, ne relance pas, ne tient pas de cagnotte, ne gère pas de campagne. Komerce s'arrête là où commence l'intime, et reprend là où commence l'achat.

Komerce sait faire une chose : **transformer une intention en un objet réel, visible, et livré.**

---

## 2. Ce que c'est — et ce que ce n'est pas

C'est une sélection qu'on partage avec ceux qui nous aiment.

Ce n'est pas une plateforme de financement. Pas un portefeuille. Pas une cagnotte. Pas un transfert d'argent. Pas un arbitre des comptes familiaux.

La liste montre des articles vrais, à des prix vrais, qui arriveront vraiment. On ne paie pas un concept ni une promesse : on achète sa ligne d'un snapshot réel.

Komerce ne collecte pas pour atteindre un objectif abstrait. Komerce encaisse une commande standard.

---

## 3. La personne au centre

Tout se décide dans un seul instant.

Quelqu'un qui n'a jamais entendu parler de Komerce ouvre un lien reçu par WhatsApp, sur un téléphone modeste, sur un réseau lent, et on lui demande de sortir de l'argent pour un pays à l'autre bout du monde.

C'est le creuset. La confiance se gagne ou se perd là. Toute décision de design, de copie, d'architecture se juge à cette aune : **est-ce que ça rassure l'inconnu au moment où il s'apprête à payer ?**

C'est pour cette personne qu'on ouvre la boutique en premier. On ne la met pas devant un formulaire de paiement : on la met devant un magasin. Le magasin est le mécanisme de confiance.

---

## 4. Les trois concepts

```
PANIER → LISTE → ACHAT
```

**Panier personnel** — privé, vivant, modifiable, indépendant de toute liste reçue.

**Liste partagée** — snapshot publié, figé dès sa création, accessible par lien, jamais éditable après publication.

**Achat** — commande Komerce standard ; peut porter sur une ligne disponible de liste ou sur toutes ses lignes disponibles ; ne crée aucun moteur financier collectif.

---

## 5. Ce qui n'existe plus

Supprimé définitivement, sous quelque nom que ce soit :

- cagnotte, contribution, engagement, montant libre participant ;
- modification d'une liste publiée ;
- panier collectif éditable ;
- checkout collectif spécifique ;
- « À valider ensemble » / ouverture différée des paiements ;
- ajustement post-publication.

---

## 6. Le modèle d'état

```
personalCart           = indépendant, vivant, privé
ownedOpenSharedList    = 0..1   (liste OPEN créée par l'utilisateur)
displayedSharedList    = 0..1   (liste OPEN occupant le slot partagé)
saved/receivedLists    = 0..N   (références, jamais des copies)
```

**Règle V1 (provisoire, réversible).** Tant que les listes ne sont pas nommables, un utilisateur ne peut posséder qu'une seule liste en état OPEN. Garantie par contrainte DB (index partiel). Si le besoin de plusieurs listes simultanées apparaît, le modèle évoluera avec nommage + sélection.

---

## 7. Le side-cart universel

```
[ Mon panier ] [ Liste partagée ]
```

Second onglet présent **uniquement** si une liste OPEN est affichée. Absent si aucune liste n'est affichée, ou si la liste est CLOSED/CANCELLED.

`Mon panier` n'est pas une fermeture de liste : changer d'onglet ne déclenche aucun appel de lifecycle.

Organisateur et participant utilisent le **même renderer**. Seule la matrice d'actions varie.

Une liste CLOSED ou CANCELLED ne peut jamais occuper le slot partagé. Une liste CLOSED reste dans `Mes listes` / historique — jamais dans le side-cart.

---

## 8. Ouvrir une liste = mécanique universelle

Quatre entrées, une seule opération :

```
publication par le créateur
ouverture d'un lien reçu
ouverture depuis Mes listes
restauration au reload
        ↓
afficher cette liste OPEN
dans le slot Liste partagée
```

---

## 9. Deux intentions, jamais mélangées

`PERSONAL_CART` ou `SHARED_LIST`. Un checkout liste n'absorbe jamais le panier personnel. Les deux intentions restent séparées jusqu'à la création de commande.

**Acheter** = acheter une ligne disponible choisie.

**Acheter le reste** = raccourci volontaire permettant d'acheter en une commande toutes les lignes encore disponibles.

**Reste disponible** = valeur informative des lignes non encore achetées. Ce montant n'est jamais une somme due.

---

## 10. Irréprochable

Comme on ne fait qu'une seule chose, cette chose porte tout. Irréprochable ne veut pas dire tout faire. Ça veut dire, sans exception :

- la liste arrive vite ;
- les articles sont clairs ;
- l'état (disponible / déjà acheté) ne ment jamais ;
- le paiement réussit ou échoue sans ambiguïté ;
- l'acheteur sait toujours ce qu'il a payé et ce qu'il recevra.

C'est la confiance. Le reste est du design.
