# Komerce — Design Catégories v2
*Architecture cible · marché comorien / diaspora*

---

## Principe directeur

Le catalogue est pensé pour **la diaspora comorienne qui achète pour la famille restée au pays**.
Chaque catégorie passe un test unique : *est-ce qu'on met ça dans un colis envoyé à Moroni ?*

**Règle logistique absolue :** léger, expédiable, sans SAV complexe.

**Règle UX absolue :** les sous-catégories reflètent une intention d'achat, pas une taxonomie produit.

> ⚙️ **Souplesse backoffice** : labels, icônes, ordre d'affichage et sous-catégories sont
> modifiables depuis l'admin sans toucher au code — via `GET /api/categories`.
> Le fallback hardcodé ci-dessous reste la source de vérité jusqu'à migration DB.

---

## Rail — 8 chips

```
[ Tout ] [ Soldes 🏷️ ] [ Mode & Beauté 👗 ] [ Maison 🏠 ] [ Tech 📱 ] [ Bricolage 🔧 ] [ Personnalisé ✨ ] [ Auto 🔩 ]
```

Tient sur une ligne desktop sans scroll. Deux filtres transverses, six piliers.

---

## Filtres transverses

| key | label | filterType | Rôle |
|-----|-------|------------|------|
| `all` | Tout | — | Affiche l'ensemble du catalogue |
| `Soldes` | Soldes | `promo` | Filtre les produits avec remise active |

---

## Les 6 piliers

---

### 1. Mode & Beauté 👗
**key :** `Mode & Beauté` · **dbKeys :** `['Mode', 'Beauté', 'Sport']` · **chip :** `#FDE8CD`

Ancrage culturel n°1 — tenue, soins et bien-être regroupés par logique d'achat féminin/familial.
Enfant & Bébé absorbé ici : l'achat mère/enfant est émotionnel, pas catégoriel.

| key | label | icon |
|-----|-------|------|
| `Femme` | Femme | 👗 |
| `Homme` | Homme | 👔 |
| `Enfant` | Enfant & Bébé | 🍼 |
| `Beauté` | Beauté & Bien-être | 💄 |

> Hijab, Boubou, Chaussures → Femme / Homme
> Soins, Cheveux, Maquillage, Vitamines, Parapharmacie → Beauté & Bien-être

---

### 2. Maison 🏠
**key :** `Maison` · **dbKeys :** `['Maison', 'Solaire', 'Énergie', 'Enfant', 'Jouets']` · **chip :** `#F3E7D3`

Le foyer au sens large — confort, cuisine, enfants, énergie légère.
Petit solaire intégré (lampes, power banks) : confort quotidien, pas énergie B2B.
Scolaire et jouets ici — la diaspora équipe la maison ET les enfants.

| key | label | icon |
|-----|-------|------|
| `Confort` | Confort & Énergie | 🔋 |
| `Cuisine` | Cuisine | 🍳 |
| `Déco` | Déco & Rangement | 🖼️ |
| `Enfants` | Enfants & Scolaire | 🧸 |

> Lampes, power banks, ventilateurs → Confort & Énergie
> Jouets, cahiers, cartables → Enfants & Scolaire

---

### 3. Tech 📱
**key :** `Tech` · **dbKeys :** `['Tech', 'Phones', 'Téléphonie']` · **chip :** `#E0F0E8`

Téléphonie absorbée — la diaspora envoie des téléphones, c'est quasi culturel.
Léger, forte marge, forte demande récurrente.

| key | label | icon |
|-----|-------|------|
| `Phones` | Téléphones | 📱 |
| `Audio` | Audio & Accessoires | 🎧 |
| `Montres` | Montres & Gadgets | ⌚ |

> Ordi exclu — trop lourd logistiquement pour la phase 1.

---

### 4. Bricolage 🔧
**key :** `Bricolage` · **dbKeys :** `['Bricolage', 'Quincaillerie']` · **chip :** `#E8EDF0`

Quincaillerie locale aléatoire aux Comores — la diaspora finance la rénovation de la maison familiale et cherche des produits fiables introuvables à Moroni.
Frontière stricte : léger et installable sans technicien.

| key | label | icon |
|-----|-------|------|
| `Outillage` | Outils & Fixation | 🔧 |
| `Electricité` | Électricité & Plomberie | ⚡ |
| `Sécurité` | Serrures & Sécurité | 🔐 |

---

### 5. Personnalisé ✨
**key :** `Créations personnelles` · **dbKeys :** `['Sur-mesure', 'Créations', 'Personnalisé']` · **chip :** `#FCE8D4`

Le Grand Mariage comorien est l'événement social le plus important — familles entières, tenues assorties, cadeaux personnalisés. Demande groupée, récurrente, haute valeur émotionnelle.
Modèle : print-on-demand (Printify / Gelato) pour valider, atelier Moroni pour l'urgence.

| key | label | icon |
|-----|-------|------|
| `Cérémonie` | Tenues de cérémonie | 👑 |
| `Cadeau` | Cadeaux personnalisés | 🎁 |
| `Impression` | Impression & Design | 🖨️ |

---

### 6. Auto 🔩
**key :** `Auto` · **dbKeys :** `['Auto', 'Moto', 'Pièces']` · **chip :** `#E8E4F5`

Parc concentré sur Toyota (Vitz, Hilux, Hiace, Land Cruiser) — sourcing ultra-ciblé possible.
Pièces d'usure = LTV naturelle. Frontière stricte : pièces légères uniquement.
Sourcing prioritaire : **Valeo Service Middle East — Jebel Ali Free Zone, Dubaï.**

| key | label | icon |
|-----|-------|------|
| `Filtres` | Filtres & Entretien | 🔧 |
| `Freinage` | Freinage & Sécurité | 🛑 |
| `Éclairage` | Éclairage & Électrique | 💡 |
| `Moto` | Moto | 🏍️ |

---

## Catégories dissoutes

| Catégorie | Absorbée dans |
|-----------|--------------|
| Solaire (pilier) | Maison → Confort & Énergie |
| Enfant & Famille (pilier) | Mode & Beauté + Maison |
| Sport | dbKey rétrocompat Mode & Beauté uniquement |
| Ordi | Exclu phase 1 — logistique trop lourde |
| Panneaux solaires complets | Exclu — B2B / ONG hors scope |

---

## Backoffice — ce qui est modifiable sans code

Via `GET /api/categories` (table `boutique_categories` + `boutique_subcategories`) :

- ✅ Label affiché (ex : renommer "Bricolage" en "Bricolage & Outillage")
- ✅ Icône / emoji section
- ✅ Ordre d'affichage (`display_order`)
- ✅ Activer / désactiver un pilier du rail (`show_in_rail`)
- ✅ Ajouter / retirer une sous-catégorie
- ✅ Couleur chip (si exposée en variable)

Non modifiable sans code (intentionnel) :

- ❌ `key` — identifiant technique stable, lié au routing et au filtrage produits
- ❌ `dbKeys` — mapping rétrocompat produits existants
- ❌ `filterType` — logique applicative (promo, etc.)

---

## Prochaines étapes

1. **`shop-schema.js`** — mettre à jour le fallback hardcodé avec les 6 piliers compactés
2. **`categories.css`** — ajouter couleurs chip `Bricolage` (#E8EDF0) et `Auto` (#E8E4F5)
3. **Migration DB** — table `boutique_categories` alignée sur cette architecture
4. **Sourcing par pilier** — Dubai · Turquie · Chine selon catégorie
