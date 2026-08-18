# Doctrine Komerce — Identité légère vérifiée

> **Version** : pré-2026 — non datée. Revue de conformité requise (audit 2026-07-01).

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

La validation OTP remplace progressivement les vérifications manuelles répétées du numéro, notamment au moment du paiement cash ou du retrait relais.

Cela ne supprime pas les contrôles métier utiles, mais évite de redemander au client de prouver son numéro plusieurs fois.

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

### Utilisateur identifié mais mauvais numéro

```txt
Action engageante
→ Komerce affiche le numéro reconnu
→ l’utilisateur peut continuer avec ce numéro
→ ou choisir “Utiliser un autre numéro”
→ nouveau numéro OTP
→ JWT / identité courante mise à jour
→ reprise du flux initial
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

Le créateur doit pouvoir utiliser un autre numéro si le navigateur est partagé ou si le panier doit être rattaché à un autre WhatsApp.

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

## 10. OTP principal et numéro de secours

Le canal principal est WhatsApp / téléphone.

Mais Komerce doit éviter de bloquer un utilisateur qui ne reçoit pas le code : WhatsApp non installé, numéro inaccessible, réseau faible, téléphone prêté, changement temporaire de SIM, ou appareil partagé.

Il faut donc prévoir une option de secours :

```txt
Je n’ai pas reçu le code
→ Utiliser un autre numéro
→ envoi OTP sur le nouveau numéro
→ validation du nouveau numéro
→ rattachement de l’action à ce numéro vérifié
```

Cette option ne viole pas la sécurité si elle reste encadrée :

- seul le numéro qui reçoit et valide l’OTP devient l’identité active ;
- l’OTP est court, expiré rapidement et utilisable une seule fois ;
- les tentatives sont limitées ;
- l’ancien numéro n’est pas automatiquement validé ;
- le changement de numéro est journalisé ;
- l’action en cours est rattachée au numéro effectivement vérifié.

Le numéro de secours n’est pas un contournement de sécurité. C’est une autre preuve de possession, sur un autre numéro.

## 11. Réseaux sociaux et identité

Les réseaux sociaux peuvent être envisagés comme signaux d’identité ou options de connexion future, mais ils ne doivent pas remplacer le registre téléphone / WhatsApp dans le cœur Komerce.

### Ce qui est envisageable

Komerce peut, plus tard, proposer :

```txt
Continuer avec Facebook
Continuer avec Google
Continuer avec Apple
```

Cela peut aider à reconnaître un utilisateur ou à préremplir un profil.

Mais même avec un social login, le téléphone reste nécessaire pour :

- notifications WhatsApp ;
- commande cash ;
- suivi commande ;
- relais ;
- bénéficiaire local ;
- preuve simple de contact.

### Ce qui n’est pas recommandé comme OTP principal

Envoyer un code OTP via DM Facebook, Instagram ou TikTok n’est pas recommandé comme socle principal :

- accès API plus complexe et dépendant des plateformes ;
- permissions variables ;
- délivrabilité moins prévisible ;
- l’utilisateur peut ne pas lire ses DM ;
- comptes sociaux partagés, faux ou abandonnés ;
- dépendance forte à des règles externes ;
- moins adapté à la logistique terrain et au retrait relais.

Conclusion :

```txt
Réseaux sociaux = option future de login ou de préremplissage.
Téléphone / WhatsApp OTP = registre Komerce principal.
Numéro de secours = fallback simple et robuste.
```

## 12. Effet de confiance

L’OTP ne doit pas être présenté comme une contrainte.

Il doit être présenté comme une sécurité utile :

- retrouver son panier ;
- retrouver ses engagements ;
- sécuriser son paiement ;
- éviter qu’un autre utilise son numéro ;
- faciliter le paiement cash ;
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

Pour le secours :

```txt
Vous n’avez pas reçu le code ? Utilisez un autre numéro.
```

```txt
Le numéro qui valide le code sera utilisé pour retrouver cette commande.
```

## 13. Données minimales du profil

Le profil minimal peut contenir :

- id utilisateur ;
- téléphone normalisé ;
- pays / indicatif ;
- nom affiché si connu ;
- rôle éventuel ;
- date de vérification du numéro ;
- téléphone de secours vérifié si applicable ;
- préférences de notification ;
- historique de liens avec commandes, paniers groupe, engagements ;
- journal des changements de numéro vérifié.

Le profil minimal ne doit pas forcer :

- email ;
- mot de passe ;
- adresse complète ;
- informations administratives non nécessaires.

## 14. Règle d’implémentation front

Tout module qui a besoin d’une identité doit passer par une fonction commune.

Proposition :

```js
await requireIdentity({
  reason: 'participer au panier',
  allowOtherPhone: true,
  onSuccess: continuerLeFlux,
});
```

Cette fonction doit :

1. vérifier si un JWT / profil courant existe ;
2. si oui, afficher l’identité reconnue quand `allowOtherPhone` est activé ;
3. permettre “Continuer avec ce numéro” ;
4. permettre “Utiliser un autre numéro” ;
5. si aucun JWT, afficher le flow OTP ;
6. après OTP, reprendre exactement l’action initiale.

Aucun module métier ne doit recréer son propre faux formulaire d’identité.

## 15. Règle d’implémentation backend

Le backend doit considérer le téléphone vérifié comme racine de confiance minimale.

À la validation OTP :

```txt
normaliser téléphone
→ chercher utilisateur existant
→ créer si absent
→ marquer téléphone vérifié
→ émettre JWT httpOnly
```

En cas de numéro de secours :

```txt
normaliser nouveau numéro
→ vérifier OTP du nouveau numéro
→ rattacher l’action au nouveau numéro vérifié
→ journaliser le changement
→ émettre ou rafraîchir JWT httpOnly
```

Les endpoints engageants doivent pouvoir s’appuyer sur l’utilisateur courant au lieu de redemander nom / téléphone dans le payload.

## 16. Fallback et changement d’identité

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

Le fallback “autre numéro” est aussi utile quand le code n’arrive pas.

Formulation :

```txt
Vous n’avez pas reçu le code ? Essayez avec un autre numéro.
```

## 17. Doctrine courte

```txt
Komerce ne bloque pas la découverte.
Komerce vérifie l’identité au dernier moment utile.
Le téléphone vérifié devient le registre Komerce.
Un autre numéro peut être validé par OTP si nécessaire.
Les réseaux sociaux peuvent aider à reconnaître, mais ne remplacent pas le registre téléphone.
Une fois reconnu, l’utilisateur ne ressaisit plus ce que Komerce connaît déjà.
```

## 18. Priorité d’implémentation

### Lot 1 — Panier partagé

- Créer `requireIdentity()` ou équivalent.
- L’utiliser avant création d’un panier groupe.
- L’utiliser avant enregistrement d’un engagement.
- Réduire le formulaire d’engagement à montant + message quand l’identité est connue.
- Garder “Ce n’est pas vous ?” pour changer de numéro.
- Ajouter “Je n’ai pas reçu le code → utiliser un autre numéro”.

### Lot 2 — Checkout classique

- Appeler `requireIdentity()` avant validation finale.
- Préremplir les données connues.
- Demander seulement bénéficiaire, relais, paiement et instructions utiles.
- Remplacer la vérification manuelle répétée du numéro par le numéro déjà vérifié.

### Lot 3 — Suivi, cash et relais

- Utiliser l’identité légère pour retrouver les commandes.
- Paiement cash : rattacher l’encaissement à l’identité déjà validée.
- Retrait relais : utiliser téléphone vérifié + code de retrait.

### Lot 4 — Options d’identité futures

- Étudier login social comme aide de reconnaissance.
- Ne pas utiliser DM social comme canal OTP principal.
- Garder téléphone / WhatsApp comme registre opérationnel central.
