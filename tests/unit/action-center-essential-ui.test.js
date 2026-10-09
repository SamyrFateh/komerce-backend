'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','action-center.js'),'utf8');

test('Action Center affiche uniquement le contexte utile et les actions pertinentes',()=>{
  const headerStart=source.indexOf('function header');
  const headerSource=source.slice(headerStart, source.indexOf('function metricItems', headerStart));
  expect(headerSource).toContain("'ACTION CENTER'");
  expect(headerSource).toContain("'Décisions à traiter'");
  expect(headerSource).toContain("'Mes actions'");
  expect(headerSource).not.toContain("'Pilotage →'");
  expect(headerSource).not.toContain("'Opérations →'");
  expect(headerSource).not.toContain('CANONICAL');

  const signalStart=source.indexOf('function renderSignal');
  const signalSource=source.slice(signalStart, source.indexOf('function renderAgentSignals', signalStart));
  expect(signalSource).not.toContain('row.signal_type');
  expect(signalSource).not.toContain('row.owner_role');
  expect(signalSource).not.toContain('row.status');
  expect(signalSource).not.toContain('signal_ref}');
  expect(signalSource).toContain("'Traiter'");

  const loadStart=source.indexOf('async function load');
  const loadSource=source.slice(loadStart, source.indexOf('context.reload = load', loadStart));
  expect(loadSource).not.toContain("'Actualiser le constat'");
  expect(loadSource).not.toContain("'Périmètre de décision'");
  expect(loadSource).not.toContain("'Régénérer les signaux'");
});
