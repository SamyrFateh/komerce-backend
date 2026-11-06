'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {ALL_ROLES,BASELINE_ROLES,selectedRoles}=require('../../tests/staging-canonical/role-selection');
const {inspect}=require('../../scripts/recette/staging-chromium-credentials-preflight');

function envFor(roles) {
 const env={E2E_AUDIT_ROLES:roles};
 for (const role of selectedRoles(roles)) {
   const key='E2E_'+role.toUpperCase()+'_';
   env[key+'EMAIL']=role+'@example.test';
   env[key+'PASSWORD']='opaque-credential-'+role;
 }
 return env;
}

describe('preflight GitHub secrets pour Chromium staging',()=>{
 test('admin, baseline et all sélectionnent exactement les rôles prévus',()=>{
   expect(selectedRoles('admin')).toEqual(['admin']);
   expect(selectedRoles('baseline')).toEqual(['admin','market_operator']);
   expect(selectedRoles('all')).toEqual(ALL_ROLES);
   expect(BASELINE_ROLES).toEqual(['admin','market_operator']);
   expect(()=>selectedRoles('unknown')).toThrow('INVALID_E2E_AUDIT_ROLES');
 });
 test('la baseline n exige aucun secret Finance, Sourcing ou Transitaire',()=>{
   const r=inspect(envFor('baseline'));
   expect(r.status).toBe('CREDENTIAL_NAMES_CONFIGURED_LOGIN_UNVERIFIED');
   expect(r.missing_secret_names).toEqual([]);
   expect(r.selected_roles).toEqual(['admin','market_operator']);
 });
 test('all refuse les secrets manquants dont la directrice, sans en exposer les valeurs',()=>{
   const env=envFor('all');
   for(const role of ['finance','sourcing','agent_transitaire']){
     const prefix='E2E_'+role.toUpperCase()+'_';
     delete env[prefix+'EMAIL'];delete env[prefix+'PASSWORD'];
   }
   const r=inspect(env);
   expect(r.status).toBe('MISSING_GITHUB_ACTIONS_SECRETS');
   expect(r.missing_secret_names).toEqual([
     'E2E_FINANCE_EMAIL','E2E_FINANCE_PASSWORD',
     'E2E_SOURCING_EMAIL','E2E_SOURCING_PASSWORD',
     'E2E_AGENT_TRANSITAIRE_EMAIL','E2E_AGENT_TRANSITAIRE_PASSWORD',
     'E2E_HUB_DIRECTOR_EMAIL','E2E_HUB_DIRECTOR_PASSWORD'
   ]);
   expect(JSON.stringify(r)).not.toContain('opaque-credential');
 });
 test('la vérification rapide ignore les fixtures historiques et ne requiert pas la directrice',()=>{
   const env=envFor('baseline');
   env.E2E_AUDIT_QUICK='1';
   const r=inspect(env);
   expect(r.missing_secret_names).toEqual([]);
 });
 test('la vérification ciblée exige la directrice et l agent Hub ordinaire',()=>{
   const env=envFor('admin');
   env.E2E_CHROMIUM_SPEC_FILTER='hub-director-readonly';
   const r=inspect(env);
   expect(r.missing_secret_names).toEqual([
     'E2E_HUB_DIRECTOR_EMAIL','E2E_HUB_DIRECTOR_PASSWORD',
     'E2E_AGENT_HUB_EMAIL','E2E_AGENT_HUB_PASSWORD'
   ]);
   for(const prefix of ['E2E_HUB_DIRECTOR_','E2E_AGENT_HUB_']) {
     env[prefix+'EMAIL']='test@example.test';
     env[prefix+'PASSWORD']='opaque-not-for-logs';
   }
   expect(inspect(env).missing_secret_names).toEqual([]);
   expect(JSON.stringify(inspect(env))).not.toContain('opaque-not-for-logs');
 });
 test('un audit complet sans filtre exige également la directrice',()=>{
   const env=envFor('all');
   const r=inspect(env);
   expect(r.missing_secret_names).toEqual(['E2E_HUB_DIRECTOR_EMAIL','E2E_HUB_DIRECTOR_PASSWORD']);
 });
 test('un secret non vide est une configuration, pas une preuve de login',()=>{
   const env=envFor('all');
   env.E2E_HUB_DIRECTOR_EMAIL='director@example.test';
   env.E2E_HUB_DIRECTOR_PASSWORD='opaque-secret';
   const r=inspect(env);
   expect(r.status).toBe('CREDENTIAL_NAMES_CONFIGURED_LOGIN_UNVERIFIED');
   expect(r.note).toMatch(/does not prove/);
 });
});
