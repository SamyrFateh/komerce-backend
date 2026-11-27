# Doctrine — Atelier économique Komerce

> **Statut : FIGÉ — contrat UI de pilotage économique V7/V6**
> **Date : 2026-11-26**
> **Surface : Pricing Workspace / Atelier économique**
> **Validation propriétaire :** [#5280](https://github.com/SamyrFateh/komerce-backend/issues/5280). Contrat cible, non preuve de livraison.

## 1. Règle de surface et parcours

L'Atelier économique est un workspace unique de gestion et de décision. Les valeurs dérivées sont non éditables et calculées côté serveur. La présentation V7 remplace les trois blocs de charges et la longue arborescence de l'ancien contrat ; les deux autres onglets conservent le V6.

**Socle commun :** un cockpit canonique partagé Hub/marchés selon habilitation, exactement trois onglets : Centres de coûts / Activité / Rentabilité. En-tête navy, accents teal, fonds clairs, cartes compactes, statuts contextualisés et montants alignés. Filtres marché et période communs, données synchronisées côté serveur. Direction : consolidation EUR et filtre tous marchés ; responsable : uniquement périmètre autorisé et écritures locales selon capacités ; quotes-parts centrales en lecture seule côté marché. Pas de double saisie ni de second cockpit. Desktop responsive 1280/1440/1920 sans scroll horizontal ni repaint destructeur. Marchés dynamiques, devise locale ; fixtures indépendantes KM/CM/CG/DJ/YT exclusivement staging isolé, sans activation commerciale.

**Onglet 1 — Centres de coûts V7 (seule modification visuelle par rapport au V6)**
- Niveau 1 : quatre KPI budget, engagements ouverts, charges constatées hors achat marchandises, disponible (budget − engagé − réalisé). Vue synthétique par cartes de centres (exemples : relais local, transport et douane, Hub central, services centraux), grille compacte deux colonnes, réalisé mis en évidence, budget et engagements, barre réalisé/engagé/disponible, situation/écarts et action Gérer ou Consulter selon habilitation. Filtre des centres en écart.
- Niveau 2 : ouvrir un centre dédié avec fil d’Ariane et retour Tous les centres ; KPI du seul centre ; familles présentées en sélecteurs/onglets contextuels ; une seule famille active avec tableau de ses postes (budget, engagé restant, réalisé, situation). Pas d'arborescence géante centre/famille/poste sur la même page. Familles et centres extensibles selon référentiel.
- Niveau 3 : détail contextualisé du poste (ressource, responsable, nature fixe/variable/mixte, direct/mutualisé, preuve, statut de connaissance, disponible, historique). Saisie d'une charge constatée, d'un engagement ou d'une révision budgétaire ; création de poste dans la famille active ; justificatif/motif obligatoire ; possibilité de solder partiellement un engagement lié sans double compte ; contrôles de montants et droits. Ressources intégrées dans leur centre/famille, aucun menu supplémentaire. Les coûts opérationnels et quotes-parts sont alimentés par leur source propriétaire, pas ressaisis.
- Le prototype V7 était autonome : dans l'implémentation, relier ses saisies à la même source canonique que les deux autres onglets ; conserver le contexte sans mélange de marchés.

**Onglet 2 — Activité V6 strictement conservée**
- KPI expéditions arrivées/clôturées, poids et volume, articles et COMBOX, fret + douane constatés.
- Tableau des expéditions de période : référence/rail, poids, achats, fret + douane, coût/kg, volume et articles ; total pondéré. Réconciliation achats + fret/douane + autres charges = coût complet de période ; variabilité min/max et valeur pondérée du coût logistique/kg. Clôture physique distincte de la clôture économique et régularisations tardives. Aucune ressaisie opérationnelle. Conserver présentation, structure, navigation et interactions V6.

**Onglet 3 — Rentabilité V6 strictement conservée**
- KPI ventes nettes, contribution variable, résultat économique, coefficient du mois. Courbes coefficient mensuel, cumul pondéré et glissant trois mois ; sélecteurs mois/trimestre/année à date ; couverture (expéditions, achats, poids) et statut de connaissance visibles. Ratio des sommes sur assiette comparable, jamais moyenne simple des coefficients ; absence de données ≠ zéro.
- Formation du résultat mensuel (ventes nettes, achats, charges variables, contribution, charges de structure, résultat), couverture de structure et reste à couvrir, coefficient glissant, mention sous-activité incluse/non isolée si référence insuffisante. Coefficient complet indicatif et non tarif automatique ; gardes détaillées dans sourcing/catalogue. Conserver présentation, structure, navigation et interactions V6. La séparation effective des coûts mixtes et la cohérence des cohortes doivent être garanties par le serveur ; les simplifications fictives du prototype ne deviennent pas des règles de calcul.
- Ne pas modifier les onglets 2/3 sous prétexte d'optimisation du premier. Toute nécessité technique doit préserver le contrat UX et la vérité économique.

Les périodes d'Activité et de Rentabilité utilisent respectivement la réception attestée au relais et la remise attestée au client. Les règles de ventilation, de remboursement et de régularisation figurent dans la [doctrine des centres de coûts](DOCTRINE_CENTRES_COUTS_V1.md#rattachement-mensuel-des-expéditions-et-des-ventes).

**Critères supplémentaires ECO-2/ECO-6 :** vérification des cartes et totaux, drill-down centre → famille → poste → saisie → retour, filtre écarts, soldes partiels, droits lecture/écriture, synchronisation immédiate des trois onglets après opération et changement de périmètre, fidélité visuelle V7/V6. Captures Chromium aux trois largeurs desktop. Pas de régression fonctionnelle ni de faux PASS. La validation du mock est acquise, la certification technique reste à démontrer.

## 2. Nature, périmètre, allocation et connaissance

Les axes restent indépendants : VARIABLE/FIXED (composantes des coûts mixtes séparées), DIRECT/MUTUALIZED, clé causale gouvernée. Un coût direct à une expédition n'est pas automatiquement proportionnel à chaque article. Les quotes-parts sont une vérité serveur, jamais un calcul navigateur. Les statuts certain, estimé et constaté ne confondent pas budget, engagement, mesure, politique et résultat calculé. Aucun vocabulaire N1/N2/N3 en UI canonique.

## 3. Décision produit sans deuxième cockpit

La surface de décision produit autorisée (catalogue/sourcing/pricing selon ownership) garde coût d'achat, coût variable estimé ou constaté, preuve de marché, prix commercial décidé et contribution. Le prix demeure une décision explicite, versionnée et auditée, sous les gardes existantes et la double garde cible de sélection ; aucune modification automatique. Les coûts et allocations sont modifiables seulement par leur autorité propriétaire. Les charges fixes ne sont pas une dette intrinsèque SKU. Une évolution de cette surface n'ajoute pas d'onglet ou de saisie redondante au cockpit.

## 4. Invariants visuels et recette

Valeurs dérivées visuellement distinctes des actions autorisées ; aucun recalcul économique navigateur. Ne jamais transformer une référence globale en fait local. Fixtures fictives, versionnées, idempotentes et cohérentes sur plusieurs périodes, idéalement douze, selon [le complément de recette #5280](https://github.com/SamyrFateh/komerce-backend/issues/5280#issuecomment-7180049833). Validation desktop réelle Chromium, readback API et PostgreSQL sur le même SHA ; les captures et gestes du contrat V7/V6 sont la référence, aucune réinterprétation. Aucune activation commerciale de marché de test.

> **Le marché borne le prix ; les centres de coûts maîtrisent les dépenses ; l'activité observée apprend le coût ; le portefeuille couvre les charges de structure.**
