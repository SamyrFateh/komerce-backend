# Contrat de préparation française des textes figés dans les images

> Statut : le vérificateur pur de preuves média est implémenté (`services/catalog-media-visual-fr-proof.js`), **mais la persistance des décisions, la transcription réelle et le branchement obligatoire au garde de publication ne sont pas encore implémentés**.
> Périmètre : toute image fournisseur de catalogue, quels que soient le fournisseur, la langue et la méthode de préparation. Aucune IA particulière n'est requise.

## Règle

Une fiche française ne prouve pas que ses images sont francisées. Une image peut porter des dimensions, des avertissements, des textes marketing, des consignes ou une valeur de variante visibles uniquement dans les pixels. La présence d'une URL, d'un média en base, d'un `alt` ou d'une `source_locale` française **ne prouve jamais l'absence de texte étranger incrusté**.

1. **Conserver** le média d'origine et son identité fournisseur, sans changer la source ni l'identité commandable des SKU.
2. **Inspecter visuellement** le média, sans présumer qu'il contient ou ne contient pas de texte. L'inspection peut être faite manuellement ou par une méthode interchangeable (vision/OCR) ; toute lecture incertaine est signalée, jamais complétée par invention.
3. **Transcrire** le texte détecté, avec rattachement à `source_media_id`, zone de l'image et variante/SKU concernés s'il y a lieu. Les chiffres, unités, dimensions, marque et références sont reproduits sans extrapolation ; l'information critique illisible reste en revue.
4. **Traduire en français** les instructions et caractéristiques utiles, sans déformer les valeurs fournisseur. Les marques, codes produit et éléments de packaging peuvent rester tels quels si approprié ; cela doit être une décision éditoriale explicite, pas un oubli silencieux.
5. **Présenter au client** la traduction vérifiée, soit sous forme de média dérivé localisé après contrôle éditorial et droits d'utilisation, soit en légende/description française liée à l'image originale. Une transcription seule n'altère pas les pixels anglais.
6. **Valider** la correspondance image source ↔ texte transcrit ↔ traduction ↔ SKU, puis conserver le média d'origine, la révision et la décision humaine. La première publication globale reste soumise à ses propres gardes, distincts de cette vérification.

## Statuts conceptuels

- `NOT_INSPECTED` : texte visible inconnu ; toute image source sans preuve d'inspection commence ici.
- `NO_RELEVANT_TEXT_REVIEWED` : inspection effectuée et absence de texte client à traduire confirmée.
- `TRANSCRIBED_REVIEW_REQUIRED` : texte relevé mais traduction, fidélité ou contexte de variante non validés.
- `FR_PRESENTATION_REVIEWED` : texte utile transcrit, traduit, rattaché à la bonne variante et présenté au client après validation.
- `BLOCKED_UNREADABLE_OR_UNSUPPORTED` : texte essentiel illisible, contradiction produit/image ou méthode indisponible.

Ces statuts disposent maintenant d'un **vérificateur pur, sans dépendance à un fournisseur OCR/IA**, qui exige l'identité exacte de l'image d'origine, l'URL, l'association à la variante et une décision de revue datée et attribuée. Toute modification d'image ou de variante invalide une ancienne preuve. **Ils ne sont pas encore persistés ni appliqués par le garde catalogue existant.** L'audit `scripts/refinery-fr-cross-supplier-audit.js` se borne à mesurer les images sources présentes et à marquer honnêtement l'inspection comme non faite. Aucune déduction automatique à partir de l'URL ou du `alt`, aucun appel OCR/IA et aucune modification d'image.
