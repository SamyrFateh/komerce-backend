# Brief Sonnet ÉCO : catalogue multi-sources KM, CM et CG pour les E2E G6 (décision du propriétaire, 13/11 à 01h03)

Référence : matrice #3944 (`catalog_prerequisites`) et issue #3927, commentaire 6839509826.

## Objectif
Avoir en **KM, CM et CG** au moins 4 produits **vendables** chacun :
- prix commercial `LOCAL_ACTIVE` et exposition `ENABLED`, visibles dans `GET /api/products?market=<code>` ;
- répartis chez **au moins 3 sources distinctes** : de vrais fournisseurs distincts **et** au moins 1 produit **manuel** porté par le Fournisseur central Hub ;
- du **stock local vendable** dans le relais `CLAUDE-PAR Relais <code>` (pour M02 et M03).

Tout passe par le **vrai parcours métier** : sourcing → catalogue → décision de prix marché → exposition → stock local, avec les écrans et les writers canoniques. **Aucune insertion SQL directe.** C'est la première étape de l'E2E : les preuves (captures, vidéo, identifiants) comptent.

## Phase A : découverte, lecture seule (à faire tout de suite)
1. Relis le code et la documentation : `docs/recette/FULL_CERT_CM_CG_AUTOMATION.md`, `docs/recette/evidence/LOCAL_STOCK_DIRECT_RELAIS_KM_CM_CG_20261107.md`, `routes/admin-pricing-workspace.js`, le workspace sourcing (`public/dashboards/canonical/js/sourcing-workspace*.js`, `services/sourcing-workspace.js`), le Fournisseur central (#3933), le stock local relais (writer canonique) et `publicCatalogVisibilitySql`.
2. État du staging, en GET seulement : produits publics par marché ; connecteurs fournisseurs configurés. Les noms de variables présents sur le staging sont `CJ_API_KEY`, `ALIEXPRESS_*`, `EBAY_*` et `ALLEGRO_SANDBOX_*`. Ne lis aucune valeur.
3. Établis le **chemin exact** et les **rôles** pour chaque geste : qui importe, qui crée le produit manuel, qui décide le prix CM/CG (le responsable pays `claude-par-cm-market-operator` / `claude-par-cg-market-operator`, ou l'admin si la doctrine l'exige), qui expose, qui crée le stock local.
4. Écris le plan dans `/home/claude/PLAN_CATALOGUE_MULTI_SOURCING.md` : étapes, rôles, écrans, endpoints, risques et objets créés, avec leurs marqueurs. Ensuite, **ARRÊTE-TOI** et rends un rapport court. **N'écris rien sur le staging tant qu'Opus ne t'a pas envoyé « GO phase B ».** Opus attend d'abord la fusion de W1 et W2, car toute fusion redéploie le staging.

## Phase B : peuplement (seulement après « GO phase B »)
- Chromium local depuis le sandbox : `require('playwright')`, 1440 px, un contexte par rôle, `recordVideo`. Tu peux réutiliser `/tmp/claude-0/-home-claude/011d1491-2f57-5b4d-98e0-a4b4e0b2f674/scratchpad/parcours-km/lib.js`.
- Identifiants (à ne jamais afficher, journaliser ni committer) : `/tmp/claude-0/-home-claude/011d1491-2f57-5b4d-98e0-a4b4e0b2f674/scratchpad/claude-par-keys/creds.json` pour les rôles KM et globaux (`sourcing`, `agent-hub`, `hub-director`, `admin`) et `creds-cm-cg.json` pour CM et CG.
- Choisis de **vrais** produits fournisseurs, sobres et revendables, de préférence parmi les produits déjà importés et curés (chantier catalogue) avant d'en importer de nouveaux.
- Pour les produits manuels : fiche manuelle rattachée au Fournisseur central Hub, sans fournisseur inventé.
- Prix : passe par la route de vente gouvernée et le moteur économique, sans forcer un prix ni contourner le plancher. Si un plancher bloque, note-le comme constat et ne le contourne pas.
- Garde-fous :
  - marqueur `CLAUDE-PAR-20261113` dans les champs libres autorisés ;
  - ne touche à **aucun** produit, prix, stock ou relais existant que tu n'as pas créé ;
  - n'ouvre aucun corridor ;
  - 2 essais au maximum par blocage, puis note sa cause : données, droits, interface ou backend.
- Preuves : vidéos et captures sous `…/scratchpad/catalogue-ms/`, plus un rapport `rapport.json` par marché (identifiants produits, source, prix, exposition, stock). Pour finir, commente l'issue #3927 avec un tableau marché × produit × source × prix × stock × preuve.

## Règles
- Aucune fusion, aucun code applicatif. Si un défaut de code bloque le peuplement, rapporte-le à Opus avec sa cause exacte, sans le corriger.
- `gh pr` est bloqué (GraphQL) : utilise `gh api` REST. N'écris jamais `@nom` en clair. Ne lis ni n'affiche aucun secret.
- Consigne du propriétaire : pousse et documente au fil de l'eau. Le plan et le rapport doivent être à jour avant tout arrêt.
- Commentaires terminés par :
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01SwgRpiat6KjVtGnaB4GKZi
