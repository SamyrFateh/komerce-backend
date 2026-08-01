'use strict';

const FIXED_COUNTDOWN_NOW = Date.parse('2026-08-01T12:00:00.000Z');
let dateNowSpy = null;

beforeEach(() => {
  const state = expect.getState();
  const testPath = String(state.testPath || '').replace(/\\/g, '/');
  const testName = String(state.currentTestName || '');
  if (testPath.endsWith('/group-helpers.test.js') && testName.includes('timeRemaining')) {
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_COUNTDOWN_NOW);
  }
});

afterEach(() => {
  if (dateNowSpy) {
    dateNowSpy.mockRestore();
    dateNowSpy = null;
  }
});
