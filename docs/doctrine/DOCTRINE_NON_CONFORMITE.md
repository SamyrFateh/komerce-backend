# Doctrine Non-Conformité Komerce

> **Version** : 1.0 — 2026-07-02
> **Statut** : document fondamental — complète la doctrine de confiance (vision §7) et DOCTRINE_ECONOMIQUE_KOMERCE.md (risk_provisions)
> **Tables porteuses** : `disputes` (existante, à activer), `scan_events`, `products.fragility`, `partners.rating`, `purchase_orders`, `unsold_items`, `store_credits`
> **Arbitrages fondateurs** : `fragility` (texte) = source unique du tag manipulation ; assurance transport = mode inconnu (bi-mode, voir §6)

---

## 1. Phrase de vérité

> **Le produit ne revient jamais à Dubaï. Le litige se règle donc en trois
> boucles découplées : l'argent avec le client, le produit en local,
> le recours avec le fournisseur.**

Corollaire économique : Dubaï est le **dernier point réversible** de la chaîne.
Un défaut découvert avant le scellé du conteneur est un geste d'entrepôt
(retour fournisseur local, remplacement dans le même départ). Le même défaut
découvert aux Comores est un litige irréversible. Chaque contrôle déplacé vers
Dubaï transforme un coût de litige en coût de manutention.

Règle d'or : **le client ne porte jamais le coût de l'impossibilité
logistique.** C'est le risque de l'importateur ; il est déjà dans le prix
(`risk_provisions`). C'est aussi l'argument commercial n°1 contre la valise :
chez Komerce, quand c'est cassé, c'est pris en charge.

---

## 2. Les trois fenêtres de responsabilité (bornées par deux photos)

```txt
  FOURNISSEUR              TRANSPORT / HUB              CLIENT
─────────────┤PHOTO DUBAÏ├──────────────────┤PREUVE COLLECTE├──────────
  défaut visible           cassé entre les      signalé après
  avant scellé             deux bornes          signature relais
      ↓                        ↓                     ↓
  refus d'embarquer        risk_provisions      fenêtre 72h,
  + avoir fournisseur      ou sinistre (§6)     barème §5, anti-abus
```

- **Borne 1 — photo au scellé Dubaï** (à construire, lot Q-1) : une photo
  par **colis** fermé, référence visible, systématique. Trois secondes dans
  le geste de scan existant. La photo **article** n'existe que si un contrôle
  est prescrit (§3). Grandes commandes : une photo par **carton maître**.
- **Borne 2 — preuve de collecte relais** (existe) : le constat se fait de
  préférence AVANT signature ; après signature, la fenêtre `DISPUTE_WINDOW_HOURS`
  s'ouvre, photos obligatoires.

Sans la borne 1, aucun des trois recours n'est prouvable. Elle est le
prérequis de toute la doctrine.

## 3. Contrôle qualité Dubaï — prescrit, ciblé, dégressif

Le contrôle actif (ouvrir, allumer, inspecter) coûte du temps agent : il est
**ciblé**, jamais universel. Le système prescrit (R2), l'agent exécute.
Un contrôle est prescrit si AU MOINS un critère est vrai :

| Critère | Source | Règle |
|---|---|---|
| Produit taggé | `products.fragility` (texte : `fragile`, `electronique`, `sensible_chaleur`…) | tag ⇒ contrôle |
| Valeur unitaire | `price_kmf` | ≥ `CHECK_MIN_VALUE_KMF` |
| Première commande de la référence | historique `purchase_orders` | toujours contrôlée |
| Fournisseur nouveau ou mal noté | `partners.rating` | < `SUPPLIER_RATING_CHECK_THRESHOLD` |

**Échantillonnage sur volume** : pour un carton maître de N unités identiques,
on ouvre 1 unité sur `CHECK_SAMPLING_RATE` — durci pour un fournisseur nouveau,
allégé pour un fournisseur prouvé. Le coût du contrôle se concentre où le
risque vit et **diminue tout seul à mesure que la confiance se prouve**
(même logique que la calibration densité : le réel règle l'intensité).

Résultat du contrôle : `conforme` (embarque) ou `non_conforme` (n'embarque
JAMAIS → retour fournisseur local + avoir §6 + remplacement même conteneur si
possible, sinon backorder avec notification retard au client).

**Cadence inconnue assumée** : l'intensité (seuils, taux) vit en
`business_rules`, démarre volontairement légère, et se règle après une
semaine de terrain Dubaï — sans redéploiement.

## 4. Distinction des deux validations qualité

- `products.quality_validated` (existe) = la **référence** a été approuvée une
  fois (échantillon). Porte sur le produit au catalogue.
- Le contrôle Dubaï (§3) = **l'unité** qui embarque. Porte sur l'exemplaire.
Ne jamais confondre : une référence validée peut livrer une unité défectueuse.

## 5. Boucle client — compenser vite, sans exiger l'impossible

Barème (seuils en `business_rules`, geste proposé par le système, validé par
l'admin — jamais improvisé) :

| Constat | Geste | Produit |
|---|---|---|
| Défaut cosmétique, produit utilisable | Avoir wallet `COMPENSATION_COSMETIC_PCT` du prix | Le client garde |
| Non conforme mais utilisable (taille, couleur…) | Échange si stock local, sinon avoir partiel OU remplacement au prochain conteneur | Le client garde ou échange |
| Inutilisable | Remboursement/avoir total OU remplacement au prochain conteneur | Récupéré au relais → §7 |

Principes :
- Le **wallet d'abord** (`store_credits`) : instantané, zéro sortie de cash,
  ramène le client. Le remboursement cash reste possible, jamais imposé.
- Le **remplacement au prochain départ** est souvent mieux perçu qu'un
  remboursement — et remplit le conteneur (synergie précommande).
- **Anti-abus** : plafond `DISPUTE_CLIENT_MAX_PER_180D` par identité téléphone,
  photos obligatoires, croisement avec la photo Dubaï du colis. Au-delà du
  plafond : traitement manuel niveau 2.
- Support : la table `disputes` existante (photo_urls[], niveaux 1-3,
  refund_kmf/refund_eur) — le champ `origin` à ajouter (`client`, `hub_dubai`,
  `transport`) en fait le **registre unique** des incidents qualité.
  Un seul registre, trois origines : c'est lui qui nourrit `partners.rating`.

## 6. Boucle fournisseur — le recours se règle sur la commande suivante

On ne renvoie pas le produit ; on envoie le **dossier photo** (photo Dubaï ou
photos client + bornes de responsabilité) et on récupère la valeur en
**avoir sur le prochain achat** — le standard de l'import. Support : registre
`supplier_credits` (lot Q-4) lié à `purchase_orders` : émis, imputé, soldé.
Sans registre, le recours WhatsApp s'évapore.

Chaque incident d'origine fournisseur dégrade `partners.rating` ; sous
`SUPPLIER_RATING_CHECK_THRESHOLD`, contrôle systématique (§3) ; sous un
plancher, sortie du sourcing.

**Assurance transport — bi-mode** (info non disponible à ce jour) :
- *Mode provision (défaut actuel)* : la casse post-scellé est absorbée par
  `risk_provisions` — déjà chiffrée dans le prix, rien ne casse.
- *Mode sinistre* : si le transitaire confirme une couverture ad valorem
  (la composante `assurance_transport_pct` existe au pricing depuis la 043),
  un produit **photographié sain à Dubaï** et cassé à l'arrivée devient un
  sinistre déclarable — la photo est la pièce de dossier.
- Action unique : question au transitaire à la prochaine facture ; sa réponse
  choisit le mode, pas le code.

## 7. Boucle produit — recirculation locale, jamais Dubaï

Le produit récupéré (inutilisable, échangé) remonte relais → hub Moroni au
coût marginal des tournées existantes, puis entre dans le canal
`unsold_items` : vente dégradée locale, pièces, don. Un produit à −60 % en
circuit invendus vaut toujours plus qu'un fret retour impossible.

## 8. Prévention — le litige d'aujourd'hui tague demain

- 2 incidents de casse sur une référence ⇒ proposition automatique de tag
  `fragility` (validée admin) ⇒ consignes renforcées sur tous les suivants.
- Les produits taggés `fragile` restent **exclus du repack** (`repack_exempt`,
  095) : la protection prime sur l'optimisation volumétrique.
- Le taux de litige par référence entre dans l'analyse sourcing : une
  référence au-dessus d'un seuil est candidate à sortie, quel que soit son
  margin_pct.

## 9. Clés business_rules (lot Q-2/Q-3)

| Clé | Défaut proposé | Rôle |
|---|---|---|
| `CHECK_MIN_VALUE_KMF` | 25000 | Valeur unitaire déclenchant le contrôle Dubaï |
| `CHECK_SAMPLING_RATE` | 5 | 1 unité ouverte sur N (carton maître, fournisseur prouvé) |
| `CHECK_SAMPLING_RATE_NEW` | 2 | Idem, fournisseur nouveau/mal noté |
| `SUPPLIER_RATING_CHECK_THRESHOLD` | 3.5 | Sous ce rating : contrôle systématique |
| `DISPUTE_WINDOW_HOURS` | 72 | Fenêtre de signalement post-collecte |
| `COMPENSATION_COSMETIC_PCT` | 20 | Avoir wallet, défaut cosmétique |
| `DISPUTE_CLIENT_MAX_PER_180D` | 2 | Plafond anti-abus par téléphone (au-delà : manuel) |

Tous démarrent en confiance basse ; la cadence réelle de Dubaï et les
premiers litiges les calibrent.

## 10. Règles à ne pas casser

- Ne jamais demander au client de renvoyer un produit à Dubaï.
- Ne jamais faire porter au client le coût de l'impossibilité logistique.
- Ne jamais embarquer un `non_conforme` constaté à Dubaï.
- Ne jamais laisser l'agent décider quoi contrôler ou quoi compenser (R2 :
  le système prescrit, l'admin valide, l'agent exécute).
- Ne jamais créer un deuxième registre d'incidents : `disputes` + `origin`,
  point unique qui nourrit `partners.rating`.
- Ne jamais déballer un produit taggé fragile pour un repack.
- Ne jamais promettre une confidentialité ou un remboursement hors barème
  sans validation admin niveau 2.

## 11. Séquencement

| Lot | Contenu | Dépendance |
|---|---|---|
| Q-0 | Arbitrage `fragility` : sync `is_fragile`→`fragility`, dépréciation (pattern C5) | aucune |
| Q-1 | **Photo au scellé Dubaï** : `scan_events.photo_urls text[]` + upload (multer déjà en dépendance, pattern preuve de collecte) | aucune — LE prérequis |
| Q-2 | Consignes contrôle au scan : extension de `computeVolumeTasks` (V-4) en `computeHubTasks` (repack + fragile + check), résultat conforme/non_conforme | Q-0, Q-1 |
| Q-3 | Parcours litige client : routes sur `disputes` + `origin`, barème, fenêtre, anti-abus, wallet | Q-1 (photos = preuves) |
| Q-4 | Registre `supplier_credits` lié `purchase_orders` + alimentation `partners.rating` | Q-2/Q-3 (les incidents existent) |
| Q-5 | Calibration seuils sur cadence Dubaï réelle + réponse assurance transitaire | 1 semaine de terrain |
