# Audit économique du Hub Komerce (6 novembre 2026)

Ce dossier contient l'audit économique du Hub, mené sans aucun développement. Le document complet, avec ses tableaux et ses commentaires, est un Claude Doc : https://claude.ai/artifact/6B4YjGHbzat9rekoyjaxTM.
Ce fichier en reprend l'essentiel pour qu'un agent puisse reprendre le sujet sans y accéder.

## Contenu du dossier

- `sim.py` : le modèle de simulation. Les hypothèses sont explicites dans le dictionnaire `H` et ne sont **pas des coûts réels**.
  - Lancement : `python3 -I sim.py 1000`, avec le nombre de commandes en argument.
  - Le script compare quatre modèles d'achat sur le même flux aval, en moyenne sur 30 tirages.
- `sim_two_departures.py` : la même comparaison, avec deux départs par semaine au lieu d'un.

## Réponse courte

À 1 000 commandes, le gain vient de trois règles appliquées par le moteur, pas d'une nouvelle couche d'achats :

1. **Un passage d'achat par jour et par fournisseur, tous marchés confondus.** Les PO restent mono-marché. Un même fournisseur reçoit un seul envoi, un seul paiement et une seule livraison au Hub.
2. **Le calendrier de départ par corridor pilote tout.** Le transport aval pèse environ 85 % du coût logistique par commande.
3. **Les opérateurs ne décident que des exceptions.** La directrice du Hub valide l'engagement et le paiement par lot quotidien, sous plafond.

Le client paie toujours à la commande. Komerce ne préfinance donc pas les achats : le seul enjeu de trésorerie est le moment du paiement fournisseur.

## Résultats de la simulation

À 1 000 commandes sur 14 jours, 3 marchés et 8 fournisseurs communs.

| Modèle | Envois fournisseur | Coût / commande | Contribution | Heures Hub | Au-delà de 21 j |
|---|---|---|---|---|---|
| 1. Achat à la commande | 1 933 | 47,2 € | 34,8 % | 790 h | 20 % |
| 2. Regroupement quotidien | 312 | 25,4 € | 43,9 % | 250 h | 24 % |
| 3. Seuils dynamiques (150 € ou 2 jours) | 243 | 24,7 € | 44,2 % | 227 h | 27 % |
| 4. Seuils + envoi multi-marché | 113 | 20,9 € | 45,8 % | 209 h | 27 % |

Lecture du tableau :

- **Coût du capital.** Les coûts incluent environ 0,8 € par commande de coût de capital, calculé à tort sur un paiement au retrait. Ce poste disparaît puisque le client paie à la commande. Il est identique dans les quatre modèles, donc le classement ne change pas.
- **Deux départs par semaine.** À 1 000 commandes, ils coûtent +0,9 € par commande et font tomber les retards de 27 % à 11 %. À 100 commandes, ils coûtent +11,9 €.
- **Attente avant d'acheter.** Au-delà de 2 jours, elle coûte plus qu'elle ne rapporte. À 1 000 commandes, le passage quotidien suffit.

## Règles recommandées (R1 à R6)

1. **R1.** Passage d'achat quotidien : une PO par fournisseur et par marché, et un envoi commun par fournisseur.
2. **R2.** Attente maximale de 2 jours sous 300 commandes par quinzaine, puis de 0 à 1 jour au-delà. Seuil de 150 € ou palier de remise.
3. **R3.** Date limite d'achat = cut-off Hub du prochain départ, moins le délai fournisseur au 85e centile.
4. **R4.** Affectation à la réception : urgence d'abord, puis prochain départ du marché, puis ancienneté.
5. **R5.** Une commande partielle n'est scindée que si le reliquat rate le prochain départ et si la part reçue dépasse le surcoût d'un second colis.
6. **R6.** Une cadence de départ fixe par corridor, avec un deuxième départ dès que son coût marginal par commande devient inférieur au coût de retard évité.

## Feuille de route

- **Phase 0 :** certifier l'existant et saisir les frais réels.
- **Phase 1 :** R2, R3, le calendrier de départ et la mesure des frais réels.
- **Phase 2 :** l'envoi multi-marché et la ventilation des frais d'en-tête. À ne lancer qu'une fois les frais réels connus.
- **Phase 3 :** la validation par lot bornée et l'ordonnancement.

Ce que l'audit ne propose pas :

- reconstruire les PO ;
- ajouter un nouveau statut ou un nouvel écran avant mesure ;
- activer un PSP.

## Hypothèses à vérifier en priorité

1. Les frais réels par envoi fournisseur.
2. Les remises quantitatives réelles.
3. Le coût fixe d'un départ par corridor.
4. Le moment du paiement fournisseur.
5. Le coût d'un jour de retard.
