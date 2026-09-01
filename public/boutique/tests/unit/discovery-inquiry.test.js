'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockRequireIdentity = jest.fn();
const mockShowToast = jest.fn();
const mockCreateProviderInquiry = jest.fn();
const mockBus = { on: jest.fn(), emit: jest.fn() };

jest.mock('../../js/b-bus.js', () => ({ bus: mockBus }));
jest.mock('../../js/b-identity.js', () => ({ requireIdentity: (...a) => mockRequireIdentity(...a) }));
jest.mock('../../js/b-utils.js', () => ({ showToast: (...a) => mockShowToast(...a) }));
jest.mock('../../js/providers-services-api.js', () => ({
  createProviderInquiry: (...a) => mockCreateProviderInquiry(...a),
}));

const {
  handleDiscoveryRequest,
  setupDiscoveryInquiry,
} = require('../../js/discovery-inquiry.js');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('handleDiscoveryRequest', () => {
  it('ignore un kind hors contrat sans déclencher l’identité', async () => {
    await expect(handleDiscoveryRequest({ kind: 'marketplace_item', ref: 'x-1' })).resolves.toBe(false);
    expect(mockRequireIdentity).not.toHaveBeenCalled();
    expect(mockCreateProviderInquiry).not.toHaveBeenCalled();
  });

  it('annulation identité : aucune Inquiry créée et bouton réactivé', async () => {
    const button = document.createElement('button');
    mockRequireIdentity.mockResolvedValue(null);

    const result = await handleDiscoveryRequest({ kind: 'service', ref: 'svc-1', source: button });

    expect(result).toBe(false);
    expect(mockRequireIdentity).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'envoyer votre demande',
      title: 'Confirmer votre WhatsApp',
      returnFocusTo: button,
    }));
    expect(mockCreateProviderInquiry).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
  });

  it('reflète un état pending pendant l’identification', async () => {
    const button = document.createElement('button');
    let resolveIdentity;
    mockRequireIdentity.mockImplementation(() => new Promise(resolve => { resolveIdentity = resolve; }));

    const pending = handleDiscoveryRequest({ kind: 'service', ref: 'svc-pending', source: button });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');

    resolveIdentity(null);
    await pending;
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
  });

  it('service : identité canonique terminée avant Inquiry, puis confirmation native', async () => {
    const button = document.createElement('button');
    mockRequireIdentity.mockResolvedValue({ id: 'u-1', phone: '+2693334455' });
    mockCreateProviderInquiry.mockResolvedValue({
      ok: true,
      inquiry: { id: 'inq-1', status: 'sent', target_kind: 'service' },
    });

    const result = await handleDiscoveryRequest({ kind: 'service', ref: 'svc-1', source: button });

    expect(result).toBe(true);
    expect(mockCreateProviderInquiry).toHaveBeenCalledWith('service', 'svc-1');
    expect(mockRequireIdentity.mock.invocationCallOrder[0])
      .toBeLessThan(mockCreateProviderInquiry.mock.invocationCallOrder[0]);
    expect(mockShowToast).toHaveBeenCalledWith('Demande envoyée', 'success', 3200);
  });

  it('physical_offer : Commander reste une demande, pas une order', async () => {
    mockRequireIdentity.mockResolvedValue({ id: 'u-1', phone: '+2693334455' });
    mockCreateProviderInquiry.mockResolvedValue({
      ok: true,
      inquiry: { id: 'inq-2', status: 'sent', target_kind: 'physical_offer' },
    });

    await handleDiscoveryRequest({ kind: 'physical_offer', ref: 'offer-1' });

    expect(mockCreateProviderInquiry).toHaveBeenCalledWith('physical_offer', 'offer-1');
    expect(mockShowToast).toHaveBeenCalledWith('Demande de commande envoyée', 'success', 3200);
  });

  it('404 après clic : message honnête si l’offre vient de disparaître', async () => {
    mockRequireIdentity.mockResolvedValue({ id: 'u-1', phone: '+2693334455' });
    mockCreateProviderInquiry.mockResolvedValue({ ok: false, status: 404, error: 'Offre introuvable' });

    const result = await handleDiscoveryRequest({ kind: 'service', ref: 'svc-gone' });

    expect(result).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith('Cette offre n’est plus disponible.', 'error', 3200);
  });
});

test('setupDiscoveryInquiry installe un seul consumer du signal Discovery', () => {
  setupDiscoveryInquiry();
  setupDiscoveryInquiry();
  expect(mockBus.on).toHaveBeenCalledTimes(1);
  expect(mockBus.on).toHaveBeenCalledWith('discovery:request', handleDiscoveryRequest);
});
