# Workflows en pause

Pause temporaire mise en place le 2026-08-14 pendant la revue de la gouvernance CI/CD.

GitHub Actions ne charge que les fichiers placés dans `.github/workflows/`. Les YAML de ce dossier sont donc conservés dans Git mais volontairement inactifs.

Pendant la pause, seuls restent actifs :
- `.github/workflows/ci.yml` — CI technique, déclenchement manuel uniquement ;
- `.github/workflows/showcase-v2-staging-deploy.yml` — raffinerie Showcase V2 staging.

Les anciens contrôles Carte First, doctrine, impact/coffre-fort, contrats, E2E, graph/schema et workflows Lots 7/8 sont archivés ici pour être revus avant réactivation individuelle.

Côté local, `scripts/setup-hooks.sh` met en pause uniquement les hooks Komerce gérés et conserve les hooks personnels. Le script d’installation historique est archivé sous `scripts/_archive/`.

Pour réactiver un contrôle, le revoir puis replacer son YAML individuellement dans `.github/workflows/`.
