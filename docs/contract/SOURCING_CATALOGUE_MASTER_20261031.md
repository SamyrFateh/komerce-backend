# Contrat UX — Sourcing → Raffinerie (moteur) → Catalogue global → Catalogue pays

Date : 31 octobre 2026. Remplace les responsabilités d'écran décrites dans `REFINERY_CATALOG_BOUNDARY_V4.md` ; **ne modifie aucun ownership ni garde backend**.

## Décision produit

- **Sourcing** : sources et fournisseurs, découverte, imports KIR, suivi de passage, facts source rectifiables (prix fournisseur, devise, poids vérifiés) et exception *résoluble dans Sourcing*. Une donnée absente n'est jamais inventée. Rejets/WATCH/EXCLUDED et candidats déjà remis restent traçables mais ne deviennent pas artificiellement des tâches humaines.
- **Raffinerie** : services automatiques de normalisation, classification, enrichissement éditorial et contrôles ; résultats persistés et diagnostic explicite, sans file de correction humaine ni seconde validation affichée. Un GET ou l'ouverture de la page ne lance aucune mutation.
- **Catalogue global** : **unique registre maître et écran humain de complétion** : candidats pré-KPR, produits remis, actifs historiques ; proposition taxonomique (catégorie/sous-catégorie), français, médias et identité source, corrections contextuelles et décision/approbation canonique auditées. Une correction revalide les contrôles ; un produit conforme sort de sa file de corrections. Les interventions déléguées appellent les services propriétaires avec leurs grants, et jamais un écrivain croisé.
- **Catalogue pays** : liste commerciale spécifique au marché, coûts par marché, marge, corridor et prix local (dépassement explicite possible selon politique), contrôle du plancher anti-erreur, puis interrupteur de mise en vente. Aucune reclassification ni nouvelle correction FR ici. Le produit global approuvé peut être sans prix local ; il n'est achetable qu'après LOCAL_ACTIVE + ENABLED et gardes de publication réels.

## Frontières d'ergonomie

1. **Une anomalie → une seule action humaine au bon endroit**. Les actions ne sont présentées que si elles sont réellement possibles ; pas de bouton mort.
2. **Sourcing** : sources/imports en premier, exceptions source uniquement avec `Contrôler` ou `Corriger` et un lien Catalogue contextualisé. La configuration des connecteurs est dans le Cockpit des sources.
3. **Raffinerie** : entrée de navigation retirée. Les anciens liens `?view=refinery` affichent le Catalogue global. Le monitoring `?view=refinery&diagnostic=1` reste technique et read-only.
4. **Catalogue global** : seule destination de correction utilisateur, y compris candidate_ref avant product_ref. Ne pas demander deux fois « Enregistrer » puis « Confirmer » pour une même correction ; backend vérifie les invariants et retourne un résultat explicite.
5. **Catalogue pays** : le prix est la dernière décision de publication, pas une condition d'import ni de création de brouillon.

## Garanties

- Aucun prix de vente ni exposition n'est écrit lors du Sourcing, de la Raffinerie, d'un GET Catalogue ou d'une correction de fiche.
- Aucun changement implicite des `products.is_active`, des prix marchés ni de `product_market_exposure`.
- Les produits de test RCT1 ne doivent pas être confondus avec les produits sourcés réels ; retrait commercial seulement via la procédure dédiée, sans supprimer les preuves historiques.
- Les rôles et grants Sourcing/Catalogue/Marché continuent à s'appliquer.

## Critères de réception

- À 1440 px, Sourcing ne montre que les anomalies réellement rectifiables, et un connecteur indisponible renvoie à sa configuration.
- Raffinerie sans « À examiner », « Corriger FR », « Valider » ni liste redondante ; consultation technique en lecture seule.
- Catalogue global récupère un candidat sans KPR par `candidate_ref` et permet la classification, les propositions FR et les corrections suivant les droits.
- ProductRef validé = visible comme produit candidat à la décision de prix marché, jamais présumé exposé en boutique.
- Catalogue marché : prix saisi inférieur au plancher bloqué, prix au-dessus du plafond autorisable par politique explicite, publication vérifiée par API publique.
- CI ciblée, Chromium desktop et preuves d'absence de mutations de navigation.
