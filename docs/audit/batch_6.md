# Audit Lot 6 — Fichiers secondaires et legacy

---

## Komerce_Simulateur_Tarification_v5.html (38 KB)

### Sécurité
- 🟠 IMPORTANT: Pas d'authentification — le simulateur est accessible publiquement sans login, exposant la logique de tarification complète (marges, coûts hub, commissions agents)
- 🟡 MINEUR: Appel API `GET /api/payments/rates` sans header d'authentification — silencieux en cas d'échec (fallback taux statiques)
- 🟡 MINEUR: Détection localhost vs production pour API base URL (`location.hostname==='localhost'`) — logique de dev exposée en production

### Qualité du code
- 🟠 IMPORTANT: **Duplicata majeur** — Ce fichier est une variante v5 du simulateur, coexistant avec `simulateur.html` et probablement `Komerce_Simulateur.html`. Trois fichiers pour la même fonctionnalité avec des logiques de calcul divergentes
- 🟠 IMPORTANT: Formule de calcul différente de `simulateur.html` — ici `subtotal * margePct` (marge sur coût) vs `coutTotal / (1 - margePct)` dans simulateur.html (marge sur prix). **Résultats différents pour les mêmes inputs**
- 🟡 MINEUR: Taux de change codés en dur (`TAUX_AED = 138, TAUX_EUR = 492`) avec tentative de mise à jour live — les sélecteurs CSS `.rate-aed` / `.rate-eur` référencés dans le JS n'existent pas dans le HTML
- 🟡 MINEUR: Fichier monolithique (39KB) — styles + HTML + logique métier complexe dans un seul fichier
- 🟡 MINEUR: Variable `TAUX_FRET_M3` initialisée avec le taux statique mais jamais mise à jour quand les taux live sont chargés

### Endpoints API appelés
| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| GET | /api/payments/rates | Chargement taux de change live (AED/KMF, EUR/KMF) |

### Observations
- Contient des fonctionnalités absentes de `simulateur.html` : sélection source (S1 Agent Deira, S2 Grossiste, S4 Importateur Chinois), mode tenues cérémonie, Hub Opérationnel Dubai avec P&L
- Spec référencée : v6.4 — version la plus avancée du simulateur
- Thème orange (Komerce brand) vs thème bleu de `simulateur.html`
- 🔍 **Question clé** : ce fichier semble être la version la plus complète du simulateur. `simulateur.html` est probablement obsolète

---

## admin.html (46 KB)

### Sécurité
- 🔴 CRITIQUE: **XSS via innerHTML** — Toutes les données API sont injectées directement via innerHTML sans sanitisation. Si un champ API (référence commande, nom client, email) contient du HTML/JS malveillant, il sera exécuté. Exemples : `${c.reference}`, `${c.client}`, `${c.email}`, `${c.sms_suggere}` dans des template literals injectés via innerHTML
- 🔴 CRITIQUE: **URL API production codée en dur** — `const API = 'https://komerce-backend-production.up.railway.app'` expose l'infrastructure backend directement dans le code client
- 🔴 CRITIQUE: **Token obtenu mais jamais utilisé** — Le login récupère `data.token` dans `_token` mais `apiFetch()` n'envoie aucun header Authorization. Les appels API utilisent seulement `credentials: 'include'` (cookies). Si le backend attend un Bearer token, les appels échouent silencieusement ou contournent l'auth
- 🟠 IMPORTANT: **Auth guard client-side contournable** — `if (!localStorage.getItem('komerce_token') && !localStorage.getItem('kmrc_logged_in'))` peut être contourné en 2 secondes via la console DevTools : `localStorage.setItem('komerce_token','x')`
- 🟠 IMPORTANT: Email admin pré-rempli par défaut : `value="admin@komerce.km"` — révèle le format des comptes admin
- 🟠 IMPORTANT: Variable globale implicite `event` utilisée dans `switchTab()` — `event.target.classList.add('active')` dépend de `event` global (deprecated, ne fonctionne pas dans Firefox strict mode)

### Qualité du code
- 🟠 IMPORTANT: **Duplicata probable avec `Komerce_Admin.html`** — Le portal.html référence `Komerce_Admin.html` comme dashboard "Administration". Ce fichier `admin.html` semble être une version alternative/ancienne avec la même fonctionnalité
- 🟡 MINEUR: Fichier monolithique de 46KB — templates HTML massifs dans des template literals JS, difficilement maintenable
- 🟡 MINEUR: Pas de gestion d'erreur détaillée — les erreurs réseau affichent seulement `e.message` sans retry ni guidance utilisateur
- 🟡 MINEUR: Styles de boutons période (7j/30j/90j) définis inline au lieu de classes CSS

### Endpoints API appelés
| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| POST | /api/auth/login | Authentification admin (email + password) |
| GET | /api/dashboard/ops | Tableau de bord opérationnel (KPIs, SLA, logistique, alertes) |
| GET | /api/dashboard/sales?period={7\|30\|90} | Ventes, marges, top produits, clients |
| GET | /api/dashboard/retards?niveau={niveau} | Liste clients en retard avec compensations |
| GET | /api/dashboard/forecast?target_date={date}&ref_period={period}&from_date={date} | Prévisions CA et marge (3 scénarios) |

### Observations
- Dashboard admin complet avec 4 onglets : Pilotage, Ventes, Retards, Prévisions
- Fonctionnalité riche : SLA tracking, P&L marge, alerte ventes à perte, LTV client, taux réachat
- Le `apiFetch` n'envoie pas le token → potentiel problème d'auth en production si les cookies ne suffisent pas
- Inclut des endpoints non vus dans d'autres fichiers : `/api/dashboard/forecast`, `/api/dashboard/retards`

---

## portal.html (15 KB)

### Sécurité
- 🔴 CRITIQUE: **Token fallback à '1'** — `localStorage.setItem('komerce_token', data.token || '1')` — si le backend ne retourne pas de token, le code stocke littéralement `'1'` comme token d'authentification. Tous les dashboards qui vérifient `localStorage.getItem('komerce_token')` accepteront cette valeur
- 🔴 CRITIQUE: **Session validée côté client uniquement** — `checkSession()` lit `localStorage.getItem('komerce_user')` sans aucune vérification serveur. Un utilisateur peut créer un faux objet user dans localStorage et accéder au portail sans authentification
- 🟠 IMPORTANT: **Aucune expiration de session** — Le token et les données user restent dans localStorage indéfiniment. Pas de TTL, pas de refresh token, pas de vérification périodique
- 🟡 MINEUR: Le logout appelle `POST /api/auth/logout` mais ne vérifie pas la réponse — même si le serveur échoue, le client est déconnecté localement

### Qualité du code
- 🟡 MINEUR: Code propre et bien structuré — meilleur fichier du lot en termes de qualité
- 🟡 MINEUR: Références à 10 dashboards différents — certains pourraient ne pas exister (Komerce_Pipeline.html, Komerce_Mobile.html, Komerce_Backend.html, Komerce_Tests.html)
- 🟡 MINEUR: Un élément de la grille (`Pipeline`) utilise `tile-label` au lieu de `tile-name` comme les autres — inconsistance CSS, probablement invisible mais style différent

### Endpoints API appelés
| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| POST | /api/auth/login | Authentification (email + password, credentials:include) |
| POST | /api/auth/logout | Déconnexion (credentials:include) |

### Observations
- Point d'entrée central pour tous les dashboards Komerce
- Répertorie tous les dashboards existants — utile comme carte du système :
  - `Komerce_Admin.html` (Admin), `Komerce_Pilotage.html` (Finance), `Komerce_Pipeline.html` (Ops), `Komerce_Hub.html` (Logistique), `Komerce_Relais.html` (Logistique), `Komerce_Simulateur.html` (Finance), `Komerce_Mobile.html` (Ops), `Komerce_Backend.html` (Tech), `Komerce_Tests.html` (Tech), `Komerce_Boutique.html` (Public)
- Confirme que `Komerce_Boutique.html` est le seul dashboard public (pas d'auth)
- Design soigné avec Google Fonts (DM Sans) — seul fichier à charger une police externe

---

## simulateur.html (26 KB)

### Sécurité
- 🟡 MINEUR: Aucun appel API — simulateur 100% offline, pas de risque réseau
- 🟡 MINEUR: Pas d'authentification requise — accessible publiquement, expose la logique de tarification

### Qualité du code
- 🔴 CRITIQUE: **Version obsolète avec formule de calcul divergente** — Utilise `prixFinal = coutTotal / (1 - margePct - stripePct)` (marge calculée sur le prix de vente) alors que v5 utilise `margeKmf = subtotal * margePct` (marge calculée sur le coût). **Les deux simulateurs donnent des résultats différents pour les mêmes paramètres**, ce qui est dangereux pour la tarification
- 🟠 IMPORTANT: **Fonctionnalités manquantes vs v5** — Pas de sélection de source (S1/S2/S4), pas de Hub Dubai, pas de mode tenues cérémonie, pas de taux live. Version clairement incomplète
- 🟠 IMPORTANT: **Agent fee codé en dur à 5%** — `agentKmfUnit = achatKmfUnit * 0.05` n'est pas configurable (contrairement à v5 qui a un champ input)
- 🟡 MINEUR: Catégorie supplémentaire `alimentaire` (Alimentation & Épices) absente de v5 — feature perdue ?
- 🟡 MINEUR: Contient des recommandations de prix (compétitif/recommandé/premium) — fonctionnalité absente de v5 qui pourrait être utile
- 🟡 MINEUR: Navigation header pointe vers `/` (Boutique), `/admin.html`, `/simulateur.html` — liens non cohérents avec le reste de l'écosystème (pas de portal.html)

### Endpoints API appelés
| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| *(aucun)* | — | Simulateur entièrement offline |

### Observations
- 🗑️ **Candidat à la suppression** — Version plus ancienne et moins complète que `Komerce_Simulateur_Tarification_v5.html`
- Contient cependant 2 features absentes de v5 : catégorie `alimentaire` et scénarios de prix (compétitif/recommandé/premium)
- Thème bleu vs thème orange de v5 — identité visuelle incohérente
- La coexistence de 3 simulateurs (ce fichier, v5, et probable Komerce_Simulateur.html) est problématique pour la maintenance

---

## Komerce_Web.html.old (58 KB)

### Sécurité
- 🟠 IMPORTANT: **Fichier .old servi publiquement** — Un fichier backup ne devrait jamais être accessible via le serveur web. Il expose l'ancienne version du code avec potentiellement des vulnérabilités corrigées depuis
- 🟠 IMPORTANT: **Parsing URL non validé** — `new URLSearchParams(window.location.search).get('panier')` injecté directement dans le DOM via `textContent` (safe) mais le paramètre `de` est aussi lu sans validation
- 🟡 MINEUR: Utilisation de `alert()` pour les confirmations utilisateur — UX pauvre et potentiel vecteur de confusion
- 🟡 MINEUR: Collecte de numéros de téléphone (gift modal) sans validation de format ni protection
- 🟡 MINEUR: Lien WhatsApp construit avec `window.open` — URL `https://komerce.km/panier/{code}` référence un domaine potentiellement inexistant

### Qualité du code
- 🔴 CRITIQUE: **Fichier mort (.old) à supprimer** — Le suffixe `.old` indique clairement un backup. Ce fichier de 58KB est servi inutilement en production, augmente la surface d'attaque et la taille du déploiement
- 🟠 IMPORTANT: **Fonctionnalité mock/placeholder** — Le panier partagé génère des codes aléatoires côté client (`genCode()`), le gift modal fait un simple `alert()` de confirmation. Aucun backend n'est connecté pour ces features
- 🟠 IMPORTANT: **Script externe référencé** — `<script src="/komerce-api.js"></script>` chargé à la fin — tout le comportement API dépend de ce fichier externe (achats, paniers, etc.)
- 🟡 MINEUR: Date codée en dur : "Lundi 23 mars 2026" dans la section promos
- 🟡 MINEUR: Prix produits codés en dur dans le HTML (data-kmf attributes) — pas de chargement dynamique
- 🟡 MINEUR: Programme fidélité affiché avec des données statiques (2/5 commandes) — UI sans backend
- 🟡 MINEUR: Points relais codés en dur (Mutsamudu Centre, Domoni, Bambao, Sima)

### Endpoints API appelés
| Méthode | Endpoint | Contexte |
|---------|----------|----------|
| *(aucun directement)* | — | Toute l'API est déléguée à `/komerce-api.js` |

### Observations
- 🗑️ **À supprimer immédiatement** — Fichier backup de l'interface boutique principale, remplacé par `Komerce_Boutique.html` et/ou `Komerce_Web.html`
- Contient le front-end e-commerce complet : hero, promos, catalogue, destinataire, panier partagé, programme fidélité
- Fonctionnalités intéressantes présentes : détection devise par timezone, panier partagé WhatsApp, mode cadeau
- Sert de référence pour comprendre les features prévues mais c'est du code mort

---

## Résumé du lot 6

### Compteurs
- 🔴 Critiques: 7
- 🟠 Importants: 12
- 🟡 Mineurs: 19
- Endpoints uniques: 7

### Endpoints uniques identifiés
| # | Méthode | Endpoint |
|---|---------|----------|
| 1 | POST | /api/auth/login |
| 2 | POST | /api/auth/logout |
| 3 | GET | /api/payments/rates |
| 4 | GET | /api/dashboard/ops |
| 5 | GET | /api/dashboard/sales |
| 6 | GET | /api/dashboard/retards |
| 7 | GET | /api/dashboard/forecast |

### Fichiers candidats à la suppression
| Fichier | Raison | Remplacé par |
|---------|--------|-------------|
| `Komerce_Web.html.old` | Backup explicite (.old) | `Komerce_Boutique.html` ou `Komerce_Web.html` |
| `simulateur.html` | Version obsolète, formule divergente | `Komerce_Simulateur_Tarification_v5.html` ou `Komerce_Simulateur.html` |
| `admin.html` | Probable duplicata | `Komerce_Admin.html` (référencé dans portal.html) |

### Problème systémique : Incohérence des simulateurs
Trois fichiers de simulateur coexistent avec des logiques de calcul **incompatibles** :
1. `Komerce_Simulateur_Tarification_v5.html` — Marge = `subtotal × margePct` (sur coût)
2. `simulateur.html` — Marge = `coutTotal / (1 - margePct)` (sur prix de vente)
3. `Komerce_Simulateur.html` — À auditer (probable 3ème variante)

→ **Même produit, mêmes paramètres → prix final différent** selon le simulateur utilisé. Risque élevé d'erreurs de tarification.

### Problème systémique : Authentification fragile
Le système d'auth repose sur `localStorage` avec :
- Token fallback à `'1'` (portal.html)
- Aucune validation serveur de la session (portal.html checkSession)
- Auth guard client-side contournable (admin.html)
- Token obtenu mais jamais envoyé dans les headers API (admin.html)

→ **Toute la sécurité côté client est illusoire** — la vraie protection doit être côté serveur sur chaque endpoint API.
