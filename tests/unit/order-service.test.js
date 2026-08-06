'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../services/wallet-service', () => ({
  getBalance: jest.fn(),
}));

const walletService = require('../../services/wallet-service');
const {
  generateRef,
  getUniqueRef,
  generateCashCode,
  getAvailableCredits,
} = require('../../services/order-service');

describe('order-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateRef', () => {
    it('produit une reference K + 6 caracteres alphanumeriques majuscules', () => {
      const ref = generateRef();
      expect(ref).toMatch(/^K[A-Z0-9]{6}$/);
    });

    it('produit des references variees (pas de collision triviale)', () => {
      const refs = new Set(Array.from({ length: 20 }, () => generateRef()));
      expect(refs.size).toBeGreaterThan(1);
    });
  });

  describe('getUniqueRef', () => {
    it('retourne la premiere reference libre en base', async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      const ref = await getUniqueRef(db);
      expect(ref).toMatch(/^K[A-Z0-9]{6}$/);
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('reessaie si la reference existe deja, puis retourne la suivante libre', async () => {
      const db = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ id: 1 }] })
          .mockResolvedValueOnce({ rows: [] }),
      };
      const ref = await getUniqueRef(db);
      expect(ref).toMatch(/^K[A-Z0-9]{6}$/);
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it("leve une erreur apres 5 tentatives infructueuses", async () => {
      const db = { query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }) };
      await expect(getUniqueRef(db)).rejects.toThrow(
        'Impossible de générer une référence unique après 5 tentatives'
      );
      expect(db.query).toHaveBeenCalledTimes(5);
    });
  });

  describe('generateCashCode', () => {
    it('produit un code de 6 chiffres', () => {
      const code = generateCashCode();
      expect(code).toMatch(/^\d{6}$/);
    });
  });

  describe('getAvailableCredits', () => {
    it('delegue au wallet-service et expose total_kmf', async () => {
      walletService.getBalance.mockResolvedValue(1500);
      const result = await getAvailableCredits({}, 'user-1');
      expect(walletService.getBalance).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ total_kmf: 1500 });
    });

    it('propage un solde nul tel quel', async () => {
      walletService.getBalance.mockResolvedValue(0);
      const result = await getAvailableCredits({}, 'user-2');
      expect(result).toEqual({ total_kmf: 0 });
    });
  });
});
