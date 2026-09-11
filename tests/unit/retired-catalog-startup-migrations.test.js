'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const migration038 = require('../../scripts/migration-038-replace-products');
const migration039 = require('../../scripts/migration-039-french-descriptions');

describe('legacy catalog startup migrations are retired', () => {
  test('migration038 is a no-op and never touches the database', async () => {
    const db = { query: jest.fn() };
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await migration038(db);

    expect(db.query).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/retired/i));
    logSpy.mockRestore();
  });

  test('migration039 is a no-op and no longer reads/writes legacy product content', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await migration039();

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/retired/i));
    logSpy.mockRestore();
  });
});
