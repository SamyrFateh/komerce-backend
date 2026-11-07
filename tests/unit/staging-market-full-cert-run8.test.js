'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../../.github/workflows/staging-market-full-certification.yml'), 'utf8');

describe('official staging fixture RUN8 approval', () => {
  test('each generated fixture RUN8 is explicitly bound to the single-run authorization variable', () => {
    const generated = source.match(/RUN8="\$\(node -p 'require\("crypto"\)\.randomBytes\(4\)\.toString\("hex"\)\.toUpperCase\(\)'\)"/g) || [];
    const approvals = source.match(/export HUB_V1_CERTIFICATION_RUN="\$RUN8"/g) || [];
    const dryRuns = source.match(/hub-v1-certification-runner\.js --allow-remote-staging .* --dry-run/g) || [];
    expect(generated).toHaveLength(2);
    expect(approvals).toHaveLength(2);
    expect(dryRuns).toHaveLength(2);
    expect(source).toContain('CERT_RUN8_API=$RUN8');
    expect(source).toContain('CERT_RUN8_CLICKS=$RUN8');
  });
});
