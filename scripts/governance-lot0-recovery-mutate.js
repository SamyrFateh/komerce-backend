'use strict';

const fs = require('fs');

function replaceOnce(file, from, to) {
  let src = fs.readFileSync(file, 'utf8');
  if (!src.includes(from)) return false;
  src = src.replace(from, to);
  fs.writeFileSync(file, src, 'utf8');
  console.log(`fixed ${file}`);
  return true;
}

replaceOnce(
  'public/boutique/css/checkout-vertical-rail.css',
  '@media (min-width: 900px) and (max-width: 1120px) {',
  '@media (min-width: 900px) and (max-width: 1199px) {'
);

replaceOnce(
  'public/boutique/css/notifications.css',
  '@media (max-width:700px) {',
  '@media (max-width:899px) {'
);

replaceOnce(
  'features/catalog.feature.js',
`    ci: [
      '.github/workflows/showcase-catalog-media-audit.yml',
      '.github/workflows/showcase-catalog-staging-deploy.yml',
      '.github/workflows/showcase-v2-staging-deploy.yml',
    ],`,
`    ci: [
      // Workflow ACTIF (.github/workflows/).
      '.github/workflows/showcase-v2-staging-deploy.yml',
      // Workflows showcase-catalog EN PAUSE (revue gouvernance 2026-08-14,
      // cf. \`.github/workflows-disabled/README.md\`) — déclarés à leur
      // emplacement réel pour rester possédés (ni faux « absent », ni orphelins).
      '.github/workflows-disabled/showcase-catalog-media-audit.yml',
      '.github/workflows-disabled/showcase-catalog-staging-deploy.yml',
    ],`
);

replaceOnce(
  'features/infrastructure.feature.js',
`    ci: [
      '.github/CODEOWNERS',
      '.github/copilot-instructions.md',
      '.github/pull_request_template.md',
      '.github/workflows/apply-komerce-arch-headers.yml',
      '.github/workflows/carte-first.yml',
      '.github/workflows/ci.yml',
      '.github/workflows/contract-conformance.yml',
      '.github/workflows/contract.yml',
      '.github/workflows/docs-guard.yml',
      '.github/workflows/e2e-boutique.yml',
      '.github/workflows/e2e.yml',
      '.github/workflows/generate-komerce-arch-graph.yml',
      '.github/workflows/governance.yml',
      '.github/workflows/impact-check.yml',
      '.github/workflows/lot7-finalize-governance-once.yml',
      '.github/workflows/lot7-staging-business-qualification.yml',
      '.github/workflows/lot8-pre-go-live-certification.yml',
      '.github/workflows/lot8-reconcile-current-main-once.yml',
      '.github/workflows/pr-governance.yml',
      '.github/workflows/schema-refresh.yml',
    ],`,
`    ci: [
      '.github/CODEOWNERS',
      '.github/copilot-instructions.md',
      '.github/pull_request_template.md',
      // Workflow ACTIF — GitHub Actions ne charge que \`.github/workflows/\`.
      '.github/workflows/ci.yml',
      // Workflows EN PAUSE (revue gouvernance CI/CD 2026-08-14, cf.
      // \`.github/workflows-disabled/README.md\`) : conservés dans Git mais
      // inactifs, réactivés individuellement après revue (chantier CI cible :
      // fast local → scoped merge enforcement → heavy certification).
      // Déclarés à leur emplacement RÉEL pour rester possédés — ni faux
      // « absent du disque », ni orphelins.
      '.github/workflows-disabled/README.md',
      '.github/workflows-disabled/apply-komerce-arch-headers.yml',
      '.github/workflows-disabled/carte-first.yml',
      '.github/workflows-disabled/ci-full-gated.yml',
      '.github/workflows-disabled/contract-conformance.yml',
      '.github/workflows-disabled/contract.yml',
      '.github/workflows-disabled/docs-guard.yml',
      '.github/workflows-disabled/e2e-boutique.yml',
      '.github/workflows-disabled/e2e.yml',
      '.github/workflows-disabled/generate-komerce-arch-graph.yml',
      '.github/workflows-disabled/governance.yml',
      '.github/workflows-disabled/impact-check.yml',
      '.github/workflows-disabled/lot7-finalize-governance-once.yml',
      '.github/workflows-disabled/lot7-staging-business-qualification.yml',
      '.github/workflows-disabled/lot8-pre-go-live-certification.yml',
      '.github/workflows-disabled/lot8-reconcile-current-main-once.yml',
      '.github/workflows-disabled/pr-governance.yml',
      '.github/workflows-disabled/schema-refresh.yml',
    ],`
);
