'use strict';

const { scanSecurity, suppressSecurity } = require('../../scripts/impact-check');

describe('impact-check security conventions', () => {
  test('ignore uniquement XSS dans les fixtures de tests non servies', () => {
    const testIssues = scanSecurity('public/boutique/tests/unit/example.test.js', 'document.body.innerHTML = userHtml;', null);
    expect(testIssues.filter(x => x.category === 'xss')).toHaveLength(0);

    const runtimeIssues = scanSecurity('public/boutique/js/example.js', 'document.body.innerHTML = userHtml;', null);
    expect(runtimeIssues.some(x => x.category === 'xss')).toBe(true);
  });

  test('conserve les autres catégories sécurité dans les tests', () => {
    const issues = scanSecurity('tests/unit/example.test.js', "const child_process = require('child_process');", null);
    expect(issues.some(x => x.category === 'dangerousOps')).toBe(true);
  });

  test('ne confond pas les identifiants de données lowercase avec des variables env', () => {
    expect(suppressSecurity('hardcodedSecrets', "sms_log: 'notifications'", '')).toBe(true);
    expect(suppressSecurity('hardcodedSecrets', "stripe_events_processed: 'payments'", '')).toBe(true);
    expect(suppressSecurity('hardcodedSecrets', "SMS_TOKEN: 'Abcd1234Efgh5678'", '')).toBe(false);
  });

  test('autorise uniquement le sink staticHtml protégé contre les substitutions', () => {
    const guarded = "function staticHtml(target) { return (strings, ...values) => { if (!Array.isArray(strings?.raw) || values.length !== 0) throw new TypeError('staticHtml accepts only substitution-free tagged templates'); const template = document.createElement('template'); template.innerHTML = strings[0]; }; }";
    expect(suppressSecurity('xss', 'template.innerHTML = strings[0];', guarded)).toBe(true);
    expect(suppressSecurity('xss', 'el.innerHTML = userHtml;', guarded)).toBe(false);
    expect(suppressSecurity('xss', 'template.innerHTML = strings[0];', 'function unsafe(strings) { template.innerHTML = strings[0]; }')).toBe(false);
  });
});
