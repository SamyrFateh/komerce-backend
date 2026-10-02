# Komerce - Instructions GitHub Copilot

Avant toute modification :

1. Lire AGENTS.md.
2. Lire docs/CARTE_FIRST_INDEX.md.
3. Lire la carte feature ou le transversal concerne.
4. Annoncer un plan d'attaque avant de coder.

Ne pas commencer par un audit, un rapport date, un prompt historique ou une sortie generee.

Plan d'attaque obligatoire :

- demande comprise ;
- feature ou transversal ;
- operation CRUD ;
- carte lue ;
- perimetre probable ;
- hors perimetre ;
- invariants a proteger ;
- risques ou points a verifier ;
- gates et tests prevus.

Avant PR :

- `npm run pr:preflight`

Cette commande réutilise les gates canoniques selon le diff. Utiliser les gates unitaires seulement pour diagnostiquer un rouge ; `npm run map:check` reste disponible pour une reconstruction globale.

Si public/boutique est touche, lire aussi public/boutique/README.md et la carte parente.


## Mode Komerce — coût maîtrisé

Pour toute modification substantielle, commencer par : carte Feature First → headers `@komerce-arch` → `interventionIndex.mustCheck` → lecture/diff ciblés.

Ne pas cloner/fetcher/scanner tout le dépôt ni lancer toute la suite de tests par défaut. Élargir uniquement si la preuve ciblée est insuffisante.

Ne pas créer de nouvelle dette silencieuse : `@unknown`, allowlist, exemption, baseline, bypass ou duplication d'autorité doivent être évités ou explicitement approuvés.

Avant PR : `npm run pr:preflight`.
