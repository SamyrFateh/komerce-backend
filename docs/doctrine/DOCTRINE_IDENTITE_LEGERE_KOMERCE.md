# Doctrine Komerce — Identité légère vérifiée

## 1. Résumé

Komerce ne doit pas imposer une inscription classique.

Le registre Komerce est une identité légère vérifiée par téléphone / WhatsApp :

- l’utilisateur confirme son numéro par OTP ;
- le backend crée ou retrouve son profil minimal ;
- un JWT httpOnly est posé ;
- les parcours Komerce réutilisent cette identité sans redemander inutilement les mêmes informations.

Ce mécanisme remplace le register classique.

Il doit rester simple, rassurant, mobile-first et WhatsApp-native.

## 2. Principe produit

Komerce ne demande pas plusieurs fois qui vous êtes.

Une fois votre WhatsApp confirmé, Komerce vous reconnaît automatiquement et ne demande que les informations nécessaires à l’action en cours.

L’identité légère n’est pas une barrière de navigation. Elle est déclenchée au dernier moment utile, juste avant une action engageante.

## 3. Pourquoi ce n’est pas une inscription classique

Komerce évite :

- page “Créer un compte” obligatoire ;
- email obligatoire ;
- mot de passe obligatoire ;
- formulaire long ;
- friction avant la découverte de la boutique ;
- double saisie du téléphone dans plusieurs parcours.

Komerce utilise plutôt :

- un numéro WhatsApp / téléphone ;
- un OTP ;
- un JWT httpOnly ;
- un profil minimal ;
- une reprise automatique du flux initial.

Formulation produit :

```txt
Confirmez votre WhatsApp pour sécuriser votre commande.
Komerce pourra retrouver votre panier, vos engagements et vos commandes.
```

Ne pas dire :

```txt
Inscrivez-vous.
Créez un compte.
```

## 4. Moment exact du déclenchement

L’OTP ne doit pas apparaître au début de la visite.

L’utilisateur doit pouvoir :

- découvrir la boutique ;
- consulter les produits ;
- remplir son panier ;
- recevoir ou ouvrir un lien de panier partagé ;
- comprendre le contenu d’un panier groupe.

L’identité est demandée seulement juste avant l’action engageante.

Règle :

```txt
Découverte libre.
Action engageante → identité légère si JWT absent → reprise du flux.
```

## 5. Actions engageantes

Une identité vérifiée est requise avant :

- créer un panier groupe ;
- enregistrer un engagement dans un panier groupe ;
- passer un panier groupe au règlement ;
- payer une contribution ;
- valider un checkout classique ;
- créer une commande cash ;
- lancer un paiement Stripe ;
- accéder à un suivi privé de commande ;
- retirer une commande en relais.

## 6. Flux générique

### Utilisateur non identifié

```txt
Action engageante
→ écran léger “Confirmez votre WhatsApp”
→ saisie téléphone
→ envoi OTP
→ saisie OTP
→ création ou récupération profil minimal
→ JWT httpOnly
→ reprise automatique du flux initial
```

### Utilisateur identifié

```txt
Action engageante
→ identité déjà connue
→ formulaire réduit
→ action immédiate
```

## 7. Panier partagé — créateur

Le créateur peut composer librement son panier.

Le déclenchement se fait au clic “Payer en groupe”.

```txt
Panier classique rempli
→ clic “Payer en groupe”
→ si JWT absent : OTP
→ création du panier groupe
→ ouverture de l’onglet Groupe
```

Une fois identifié, le créateur ne doit pas ressaisir son nom ou son téléphone dans l’onglet Groupe.

Pour sa propre participation, le formulaire doit être réduit à :

```txt
Montant d’engagement
Message optionnel
```

Avec un rappel rassurant :

```txt
Vous participez en tant que Samyr · +33…
```

## 8. Panier partagé — participant

Un participant peut arriver par lien public.

Il peut consulter le panier groupe avant identification afin de comprendre ce qui est demandé.

Mais avant d’enregistrer un engagement :

```txt
Lien panier groupe
→ consultation libre
→ clic “Je participe” ou saisie montant
→ si JWT absent : OTP
→ retour au formulaire réduit
→ montant + message optionnel
→ engagement enregistré
```

Le participant connu ne doit pas voir un formulaire complet nom + téléphone.

Il doit voir :

```txt
Vous êtes reconnu : Fatima Ali · +269…
Montant
Message optionnel
```

Un lien de sécurité reste nécessaire :

```txt
Ce n’est pas vous ? Utiliser un autre numéro
```

## 9. Checkout futur

Le checkout classique doit utiliser la même logique.

Il ne doit pas devenir un second monde avec formulaire invité lourd.

```txt
Boutique
→ panier
→ checkout
→ choix bénéficiaire / relais / paiement
→ si JWT absent : OTP avant validation finale
→ retour checkout prérempli
→ confirmation commande ou paiement
```

L’utilisateur connu ne doit pas ressaisir ce que Komerce sait déjà.

Exemple :

```txt
Vous commandez avec :
Samyr · +33…

Bénéficiaire aux Comores :
Nom
Téléphone local

Relais :
Choisir un relais

Paiement :
Carte / Cash
```

Le checkout demande seulement les informations propres à la commande : bénéficiaire, relais, mode de paiement, instructions éventuelles.

## 10. Effet de confiance

L’OTP ne doit pas être présenté comme une contrainte.

Il doit être présenté comme une sécurité utile :

- retrouver son panier ;
- retrouver ses engagements ;
- sécuriser son paiement ;
- éviter qu’un autre utilise son numéro ;
- faciliter le retrait en relais ;
- éviter de ressaisir ses informations ;
- assurer que les notifications arrivent au bon WhatsApp.

Formulations recommandées :

```txt
Confirmez votre WhatsApp pour sécuriser votre participation.
```

```txt
Votre numéro permet de retrouver vos commandes et vos engagements.
```

```txt
On vous reconnaîtra automatiquement la prochaine fois.
```

## 11. Données minimales du profil

Le profil minimal peut contenir :

- id utilisateur ;
- téléphone normalisé ;
- pays / indicatif ;
- nom affiché si connu ;
- rôle éventuel ;
- date de vérification du numéro ;
- préférences de notification ;
- historique de liens avec commandes, paniers groupe, engagements.

Le profil minimal ne doit pas forcer :

- email ;
- mot de passe ;
- adresse complète ;
- informations administratives non nécessaires.

## 12. Règle d’implémentation front

Tout module qui a besoin d’une identité doit passer par une fonction commune.

Proposition :

```js
await requireIdentity({
  reason: 'participer au panier',
  onSuccess: continuerLeFlux,
});
```

Cette fonction doit :

1. vérifier si un JWT / profil courant existe ;
2. si oui, retourner l’identité connue ;
3. si non, afficher le flow OTP ;
4. après OTP, reprendre exactement l’action initiale.

Aucun module métier ne doit recréer son propre faux formulaire d’identité.

## 13. Règle d’implémentation backend

Le backend doit considérer le téléphone vérifié comme racine de confiance minimale.

À la validation OTP :

```txt
normaliser téléphone
→ chercher utilisateur existant
→ créer si absent
→ marquer téléphone vérifié
→ émettre JWT httpOnly
```

Les endpoints engageants doivent pouvoir s’appuyer sur l’utilisateur courant au lieu de redemander nom / téléphone dans le payload.

## 14. Fallback et changement d’identité

Komerce doit rester familial et souple.

Un même téléphone ou navigateur peut être utilisé par plusieurs personnes.

Il faut donc toujours garder une option :

```txt
Ce n’est pas vous ? Utiliser un autre numéro
```

Cette action doit :

- relancer le flow OTP ;
- rattacher l’action au nouveau numéro vérifié ;
- ne pas casser le panier en cours.

## 15. Doctrine courte

```txt
Komerce ne bloque pas la découverte.
Komerce vérifie l’identité au dernier moment utile.
Le téléphone vérifié devient le registre Komerce.
Une fois reconnu, l’utilisateur ne ressaisit plus ce que Komerce connaît déjà.
```

## 16. Priorité d’implémentation

### Lot 1 — Panier partagé

- Créer `requireIdentity()` ou équivalent.
- L’utiliser avant création d’un panier groupe.
- L’utiliser avant enregistrement d’un engagement.
- Réduire le formulaire d’engagement à montant + message quand l’identité est connue.
- Garder “Ce n’est pas vous ?” pour changer de numéro.

### Lot 2 — Checkout classique

- Appeler `requireIdentity()` avant validation finale.
- Préremplir les données connues.
- Demander seulement bénéficiaire, relais, paiement et instructions utiles.

### Lot 3 — Suivi et relais

- Utiliser l’identité légère pour retrouver les commandes.
- Renforcer le retrait relais avec téléphone vérifié + code de retrait.
