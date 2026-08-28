'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — providers-service.js
 *
 * Invariants couverts :
 *   createProvider      : market_id requis/introuvable -> throw ; nominal -> statut pending
 *   setProviderStatus   : statut invalide -> throw ; provider introuvable -> throw ; nominal -> update
 *   createService       : provider introuvable -> throw ; provider non actif -> throw ;
 *                         marché introuvable/inactif -> throw ; nominal -> exposure DISABLED forcé
 *   isServiceExposable  : les 3 conditions (service actif + exposure ENABLED + provider actif)
 *                         doivent TOUTES tenir ; un seul défaut suffit à masquer
 *   createInquiry       : service introuvable -> throw ; nominal -> statut sent
 *   answerInquiry       : statut != sent -> throw ; nominal -> statut answered, answered_at posé
 *   decideInquiry       : statut != answered -> throw ; décision invalide -> throw ;
 *                         nominal -> accepted|declined
 *   séquence            : sent -> answered -> accepted est un cycle strictement linéaire,
 *                         aucun saut d'état possible
 *
 * DB mockée — aucune connexion Postgres.
 */

let mockQuery;
jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));

function loadService() {
  jest.resetModules();
  jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));
  return require('../../services/providers-service');
}

beforeEach(() => {
  mockQuery = jest.fn();
});

const MARKET_ID   = '11111111-1111-1111-1111-111111111111';
const PROVIDER_ID = '22222222-2222-2222-2222-222222222222';
const SERVICE_ID  = '33333333-3333-3333-3333-333333333333';
const INQUIRY_ID  = '44444444-4444-4444-4444-444444444444';

// ─── createProvider ────────────────────────────────────────────────────────

describe('createProvider', () => {
  it('lève si name ou phone manquant', async () => {
    const svc = loadService();
    await expect(svc.createProvider({ phone: '+269...', marketId: MARKET_ID }))
      .rejects.toThrow(/name et phone/);
  });

  it('lève si market_id manquant', async () => {
    const svc = loadService();
    await expect(svc.createProvider({ name: 'Artisan KM', phone: '+269...' }))
      .rejects.toThrow(/market_id/);
  });

  it('lève si le marché est introuvable ou inactif', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      svc.createProvider({ name: 'Artisan KM', phone: '+269...', marketId: MARKET_ID })
    ).rejects.toThrow(/marché introuvable/);
  });

  it('nominal : statut initial toujours pending', async () => {
    const svc = loadService();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: MARKET_ID }] })
      .mockResolvedValueOnce({ rows: [{
        id: PROVIDER_ID, name: 'Artisan KM', phone: '+269...', market_id: MARKET_ID, status: 'pending',
      }] });

    const result = await svc.createProvider({ name: 'Artisan KM', phone: '+269...', marketId: MARKET_ID });
    expect(result.status).toBe('pending');
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/INSERT INTO providers/);
    expect(params).toEqual(['Artisan KM', '+269...', MARKET_ID, 'pending']);
  });
});

// ─── setProviderStatus ─────────────────────────────────────────────────────

describe('setProviderStatus', () => {
  it('lève si le statut est invalide', async () => {
    const svc = loadService();
    await expect(svc.setProviderStatus(PROVIDER_ID, 'banned')).rejects.toThrow(/statut invalide/);
  });

  it('lève si le provider est introuvable', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(svc.setProviderStatus(PROVIDER_ID, 'active')).rejects.toThrow(/introuvable/);
  });

  it('nominal : active -> suspended, réversible sans validation centrale', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PROVIDER_ID, status: 'suspended' }] });
    const result = await svc.setProviderStatus(PROVIDER_ID, 'suspended');
    expect(result.status).toBe('suspended');
  });
});

// ─── createService ─────────────────────────────────────────────────────────

describe('createService', () => {
  it('lève si le provider est introuvable', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getProvider
    await expect(
      svc.createService({ providerId: PROVIDER_ID, title: 'Installation clim', marketId: MARKET_ID })
    ).rejects.toThrow(/provider introuvable/);
  });

  it('lève si le provider n\'est pas actif — un service ne peut pas exister avant validation', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PROVIDER_ID, status: 'pending' }] }); // getProvider
    await expect(
      svc.createService({ providerId: PROVIDER_ID, title: 'Installation clim', marketId: MARKET_ID })
    ).rejects.toThrow(/provider non actif/);
  });

  it('lève si le marché est introuvable ou inactif', async () => {
    const svc = loadService();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: PROVIDER_ID, status: 'active' }] }) // getProvider
      .mockResolvedValueOnce({ rows: [] }); // markets
    await expect(
      svc.createService({ providerId: PROVIDER_ID, title: 'Installation clim', marketId: MARKET_ID })
    ).rejects.toThrow(/marché introuvable/);
  });

  it('nominal : commercial_exposure toujours DISABLED à la création, jamais un paramètre appelant', async () => {
    const svc = loadService();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: PROVIDER_ID, status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ id: MARKET_ID }] })
      .mockResolvedValueOnce({ rows: [{
        id: SERVICE_ID, provider_id: PROVIDER_ID, title: 'Installation clim',
        market_id: MARKET_ID, status: 'draft', commercial_exposure: 'DISABLED',
      }] });

    const result = await svc.createService({
      providerId: PROVIDER_ID, title: 'Installation clim', marketId: MARKET_ID,
    });
    expect(result.commercial_exposure).toBe('DISABLED');
    const [sql] = mockQuery.mock.calls[2];
    expect(sql).toMatch(/'DISABLED'/); // codé en dur dans la requête, pas un paramètre
  });
});

// ─── isServiceExposable ─────────────────────────────────────────────────────

describe('isServiceExposable — les 3 conditions doivent TOUTES tenir', () => {
  it('service inconnu -> false', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await svc.isServiceExposable(SERVICE_ID)).toBe(false);
  });

  it('service actif + exposure ENABLED + provider actif -> true', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({
      rows: [{ service_status: 'active', commercial_exposure: 'ENABLED', provider_status: 'active' }],
    });
    expect(await svc.isServiceExposable(SERVICE_ID)).toBe(true);
  });

  it('service actif + exposure ENABLED mais provider suspendu -> false (le provider prime)', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({
      rows: [{ service_status: 'active', commercial_exposure: 'ENABLED', provider_status: 'suspended' }],
    });
    expect(await svc.isServiceExposable(SERVICE_ID)).toBe(false);
  });

  it('provider actif + exposure ENABLED mais service en draft -> false', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({
      rows: [{ service_status: 'draft', commercial_exposure: 'ENABLED', provider_status: 'active' }],
    });
    expect(await svc.isServiceExposable(SERVICE_ID)).toBe(false);
  });

  it('service actif + provider actif mais exposure toujours DISABLED -> false', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({
      rows: [{ service_status: 'active', commercial_exposure: 'DISABLED', provider_status: 'active' }],
    });
    expect(await svc.isServiceExposable(SERVICE_ID)).toBe(false);
  });
});

// ─── createInquiry ───────────────────────────────────────────────────────────

describe('createInquiry — une demande, jamais une réservation', () => {
  it('lève si le service est introuvable', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getService
    await expect(
      svc.createInquiry({ serviceId: SERVICE_ID, requesterPhone: '+269...' })
    ).rejects.toThrow(/service introuvable/);
  });

  it('nominal : statut initial sent, requestedWindow en texte libre', async () => {
    const svc = loadService();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: SERVICE_ID }] }) // getService
      .mockResolvedValueOnce({ rows: [{
        id: INQUIRY_ID, service_id: SERVICE_ID, requester_phone: '+269...',
        requested_window: 'demain matin', status: 'sent',
      }] });

    const result = await svc.createInquiry({
      serviceId: SERVICE_ID, requesterPhone: '+269...', requestedWindow: 'demain matin',
    });
    expect(result.status).toBe('sent');
    expect(result.requested_window).toBe('demain matin');
  });
});

// ─── answerInquiry ───────────────────────────────────────────────────────────

describe('answerInquiry', () => {
  it('lève si la demande est introuvable', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(svc.answerInquiry(INQUIRY_ID)).rejects.toThrow(/introuvable/);
  });

  it('lève si le statut n\'est pas sent (pas de saut d\'état)', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: INQUIRY_ID, status: 'accepted' }] });
    await expect(svc.answerInquiry(INQUIRY_ID)).rejects.toThrow(/statut invalide/);
  });

  it('nominal : sent -> answered, answered_at posé, peut porter une contre-proposition', async () => {
    const svc = loadService();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: INQUIRY_ID, status: 'sent' }] })
      .mockResolvedValueOnce({ rows: [{
        id: INQUIRY_ID, status: 'answered', proposed_window: 'demain après-midi',
        answered_at: '2026-08-28T10:00:00Z',
      }] });

    const result = await svc.answerInquiry(INQUIRY_ID, 'demain après-midi');
    expect(result.status).toBe('answered');
    expect(result.proposed_window).toBe('demain après-midi');
    expect(result.answered_at).toBeTruthy();
  });
});

// ─── decideInquiry ───────────────────────────────────────────────────────────

describe('decideInquiry', () => {
  it('lève si la décision n\'est ni accepted ni declined', async () => {
    const svc = loadService();
    await expect(svc.decideInquiry(INQUIRY_ID, 'maybe')).rejects.toThrow(/décision invalide/);
  });

  it('lève si le statut n\'est pas answered (pas de saut d\'état — sent ne peut pas devenir accepted directement)', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: INQUIRY_ID, status: 'sent' }] });
    await expect(svc.decideInquiry(INQUIRY_ID, 'accepted')).rejects.toThrow(/statut invalide/);
  });

  it('nominal : answered -> accepted', async () => {
    const svc = loadService();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: INQUIRY_ID, status: 'answered' }] })
      .mockResolvedValueOnce({ rows: [{ id: INQUIRY_ID, status: 'accepted' }] });
    const result = await svc.decideInquiry(INQUIRY_ID, 'accepted');
    expect(result.status).toBe('accepted');
  });

  it('nominal : answered -> declined', async () => {
    const svc = loadService();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: INQUIRY_ID, status: 'answered' }] })
      .mockResolvedValueOnce({ rows: [{ id: INQUIRY_ID, status: 'declined' }] });
    const result = await svc.decideInquiry(INQUIRY_ID, 'declined');
    expect(result.status).toBe('declined');
  });
});
