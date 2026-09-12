'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const loginSource = fs.readFileSync(
  path.join(__dirname, '../../public/js/login.js'),
  'utf8'
);

// Extrait ROLE_DEFAULT_LANDING + landingFor du vrai fichier source et les
// exécute en isolation (pas de jsdom, pas de DOM requis — ces deux éléments
// sont de purs objets/fonctions JS) pour tester le COMPORTEMENT réel plutôt
// que la forme du code. Contrat actuel (2026-09, cf. commentaire en tête de
// login.js) : le rôle n'est plus une frontière d'autorisation côté client
// ("UX de landing uniquement — jamais une frontière d'autorisation") ; les
// droits fins sont revalidés côté serveur. ROLE_DEFAULT_LANDING/landingFor
// ne font donc plus que choisir une destination ergonomique.
function extractLandingLogic(source) {
  const objMatch = source.match(/var ROLE_DEFAULT_LANDING = Object\.freeze\(\{[\s\S]*?\}\);/);
  const fnMatch = source.match(/function landingFor\(user\) \{[\s\S]*?\n {6}\}/);
  if (!objMatch || !fnMatch) {
    throw new Error('login.js: ROLE_DEFAULT_LANDING/landingFor introuvables — le contrat de source a changé');
  }
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${objMatch[0]}\n${fnMatch[0]}\nthis.ROLE_DEFAULT_LANDING = ROLE_DEFAULT_LANDING;\nthis.landingFor = landingFor;`, sandbox);
  return { ROLE_DEFAULT_LANDING: sandbox.ROLE_DEFAULT_LANDING, landingFor: sandbox.landingFor };
}

test('le rôle n\'est jamais une frontière d\'autorisation côté client (doctrine explicite)', () => {
  expect(loginSource).toContain('UX de landing uniquement');
  expect(loginSource).toContain('jamais une frontière d\'autorisation');
  expect(loginSource).not.toContain('ALLOWED_DASHBOARD_ROLES');
  expect(loginSource).not.toContain("if (user.role !== 'admin')");
});

test('landingFor() résout la destination ergonomique pour les 7 rôles internes connus, et retombe sur /admin sinon', () => {
  const { landingFor } = extractLandingLogic(loginSource);

  expect(landingFor({ role: 'admin' })).toBe('/admin/pilotage');
  expect(landingFor({ role: 'market_operator' })).toBe('/admin/pilotage');
  expect(landingFor({ role: 'finance' })).toBe('/admin/workspaces/accounting');
  expect(landingFor({ role: 'sourcing' })).toBe('/admin/workspaces/sourcing');
  expect(landingFor({ role: 'agent_hub' })).toBe('/admin/workspaces/operations');
  expect(landingFor({ role: 'agent_relais' })).toBe('/admin/workspaces/operations');
  expect(landingFor({ role: 'agent_transitaire' })).toBe('/admin/workspaces/shipping-customs');

  // Rôle inconnu / absent : repli neutre sur le portail, jamais une erreur.
  expect(landingFor({ role: 'client' })).toBe('/admin');
  expect(landingFor(null)).toBe('/admin');
});

test('la destination par défaut d\'admin et market_operator est le Pilotage Canonical', () => {
  const { ROLE_DEFAULT_LANDING } = extractLandingLogic(loginSource);

  expect(ROLE_DEFAULT_LANDING.admin).toBe('/admin/pilotage');
  expect(ROLE_DEFAULT_LANDING.market_operator).toBe('/admin/pilotage');
  expect(Object.values(ROLE_DEFAULT_LANDING)).not.toContain('/admin/control-tower');
});
