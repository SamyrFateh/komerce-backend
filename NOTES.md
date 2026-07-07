# Fix — registry-doc-check.js + APP_FEATURE_REGISTRY.md (2026-07-07)

## Contenu
- `backend/scripts/registry-doc-check.js`
- `backend/docs/doctrine/APP_FEATURE_REGISTRY.md`

## Déploiement
Copier directement par-dessus les fichiers existants (paths repo-relative depuis la racine du monorepo) :
```
cp -r backend/scripts/registry-doc-check.js <repo>/backend/scripts/registry-doc-check.js
cp -r backend/docs/doctrine/APP_FEATURE_REGISTRY.md <repo>/backend/docs/doctrine/APP_FEATURE_REGISTRY.md
```

## Changements

### 1. registry-doc-check.js
- Retiré `public/features/` du tableau `SOURCES` : ce chemin n'a jamais existé sur
  disque (erreur de saisie d'une session précédente). Il faisait planter le script
  avant tout comptage → `FEATURES-DIR-MISSING`, rapport 0 liens / 0 manifests.

### 2. APP_FEATURE_REGISTRY.md
- Ligne #21 (`platform.feature.js`) : chemin corrigé vers son vrai emplacement
  `../../public/dashboards/features/platform.feature.js` (au lieu de
  `../../public/features/platform.feature.js`, inexistant).
- Lignes #22/#23 (fausses "copies" dans `public/features/`) : supprimées.
- Note ⚠️ remplacée par une note ℹ️ documentant l'arbitrage tranché : le
  sous-dossier imbriqué `public/dashboards/dashboards/` était une duplication
  accidentelle et morte (confirmé via `server.js` — `express.static` sert `public/`
  à la racine, boot-check vérifie explicitement le chemin non-imbriqué — et aucun
  script `contract-check.js` / `gen-dashboards-360.js` / etc. ne référence le
  chemin imbriqué). **Ce dossier a été supprimé de mon côté de travail** ;
  penser à faire de même sur le disque réel du dépôt dashboards
  (`public/dashboards/dashboards/`) avant de déployer ce fix.

## Vérification
`node scripts/registry-doc-check.js --strict` → 21 liens / 21 manifests, 0 erreur,
bijection stricte disque ↔ registre.

## Reste à faire (non inclus dans ce zip)
- `gate:feature-audit` : 2 FAIL restants — `dashboard` (10 chemins sans préfixe
  `dashboards/`, ex. `hub/index.html` → `dashboards/hub/index.html`) et
  `infrastructure` (37 images manquantes, artefact d'export du zip boutique).
