'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { EventEmitter } = require('events');

jest.mock('../../db', () => ({ getClient: jest.fn() }));
jest.mock('../../services/dashboard-cache', () => ({ invalidateAllDashboards: jest.fn() }));
const db = require('../../db');
const dashboardCache = require('../../services/dashboard-cache');
const bus = require('../../services/dashboard-invalidation-bus');

afterEach(() => {
  bus.stop();
  jest.clearAllMocks();
});

test('LISTEN purges the worker cache and notifies all dashboards without passing business data', async () => {
  const connection = new EventEmitter();
  connection.query = jest.fn(async () => ({ rows:[] }));
  connection.release = jest.fn();
  db.getClient.mockResolvedValue(connection);
  const one = jest.fn();
  const two = jest.fn();
  const stopOne = bus.subscribe(one);
  const stopTwo = bus.subscribe(two);
  await bus.start();
  expect(connection.query).toHaveBeenCalledWith('LISTEN komerce_dashboard_refresh');
  connection.emit('notification', { channel:'komerce_dashboard_refresh', payload:'changed' });
  expect(dashboardCache.invalidateAllDashboards).toHaveBeenCalledTimes(1);
  expect(one).toHaveBeenCalledTimes(1);
  expect(one).toHaveBeenCalledWith();
  expect(two).toHaveBeenCalledTimes(1);
  connection.emit('notification', { channel:'unrelated', payload:'changed' });
  expect(dashboardCache.invalidateAllDashboards).toHaveBeenCalledTimes(1);
  stopOne();
  stopTwo();
  bus.stop();
  expect(connection.release).toHaveBeenCalledWith(true);
});
