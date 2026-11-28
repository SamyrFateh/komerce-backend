'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../../bootstrap/crons.js'), 'utf8');
test('On Demand schedules retention once in the operational cron entry point', () => {
  const entry = source.slice(source.indexOf('function startOperationalCrons()'), source.indexOf('function startConversationPhotoRetentionCron()'));
  expect(entry.match(/startConversationPhotoRetentionCron\(\);/g)).toHaveLength(1);
});
test('photo retention delegates to the canonical service inside a transaction and prevents overlap', () => {
  const cron = source.slice(source.indexOf('function startConversationPhotoRetentionCron()'), source.indexOf('function startEconomicSelectionCron()'));
  expect(cron).toContain('if(running)return');
  expect(cron).toContain('db.withTransaction(q=>purgeExpired(q))');
  expect(cron).toContain('finally{running=false}');
  expect(cron).toContain('setInterval(run,60*60*1000)');
});
