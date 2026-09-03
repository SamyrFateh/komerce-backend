'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockGetService = jest.fn();
const mockGetPhysicalOffer = jest.fn();

jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));
jest.mock('../../services/providers-service', () => ({
  getService: (...a) => mockGetService(...a),
  getPhysicalOffer: (...a) => mockGetPhysicalOffer(...a),
}));

const { createContextualInquiry } = require('../../services/providers-inquiry-service');

beforeEach(() => jest.clearAllMocks());

test('request service écrit intent + note en gardant la cible canonique', async () => {
  mockGetService.mockResolvedValue({ id: 'svc-1', title: 'Recherche pièce auto' });
  mockQuery.mockResolvedValue({ rows: [{ id: 'inq-1', status: 'sent', intent: 'request' }] });

  const row = await createContextualInquiry({
    serviceId: 'svc-1',
    requesterPhone: '+2693334455',
    requestedWindow: 'Cette semaine',
    intent: 'request',
    requesterNote: 'Toyota Hilux 2012, phare avant droit',
  });

  expect(row.intent).toBe('request');
  expect(mockGetService).toHaveBeenCalledWith('svc-1');
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringMatching(/INSERT INTO inquiries[\s\S]*intent[\s\S]*requester_note/),
    ['svc-1', null, '+2693334455', 'Cette semaine', 'request', 'Toyota Hilux 2012, phare avant droit']
  );
});

test('callback physical_offer valide la cible avant écriture', async () => {
  mockGetPhysicalOffer.mockResolvedValue({ id: 'offer-1', title: 'Ciment 42,5R' });
  mockQuery.mockResolvedValue({ rows: [{ id: 'inq-2', status: 'sent', intent: 'callback' }] });

  await createContextualInquiry({
    physicalOfferId: 'offer-1',
    requesterPhone: '+2693334455',
    intent: 'callback',
    requesterNote: 'Confirmer le stock pour 50 sacs',
  });

  expect(mockGetPhysicalOffer).toHaveBeenCalledWith('offer-1');
  expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
    null, 'offer-1', '+2693334455', null, 'callback', 'Confirmer le stock pour 50 sacs',
  ]);
});

test('refuse intent invalide, cible absente ou cible inexistante', async () => {
  await expect(createContextualInquiry({ serviceId: 'svc-1', requesterPhone: '+269', intent: 'call' }))
    .rejects.toThrow(/intent invalide/);
  await expect(createContextualInquiry({ requesterPhone: '+269' }))
    .rejects.toThrow(/exactement une cible/);

  mockGetService.mockResolvedValue(null);
  await expect(createContextualInquiry({ serviceId: 'missing', requesterPhone: '+269' }))
    .rejects.toThrow(/service introuvable/);
});
