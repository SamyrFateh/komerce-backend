'use strict';

jest.mock('../../db', () => ({ query: jest.fn() }));

const mockListMySharedCarts = jest.fn();
jest.mock('../../services/shared-cart-reads', () => ({
  listMySharedCarts: (...args) => mockListMySharedCarts(...args),
}));

const db = require('../../db');
const {
  getSharedCartLibrary,
  saveSharedCartForUser,
} = require('../../services/shared-cart-library');

describe('shared-cart-library (Amendement V2 §D — bibliothèque "Mes listes")', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getSharedCartLibrary', () => {
    it("réutilise listMySharedCarts() pour la section 'created', sans dupliquer la requête", async () => {
      const created = [{ id: 'sc-1', token: 'tok-1', title: 'Ma liste' }];
      mockListMySharedCarts.mockResolvedValue(created);
      db.query.mockResolvedValueOnce({ rows: [] }); // saved

      const result = await getSharedCartLibrary('user-1');

      expect(mockListMySharedCarts).toHaveBeenCalledWith('user-1');
      expect(result.created).toBe(created);
    });

    it("retourne la section 'saved' triée par saved_at (délégué à ORDER BY SQL), avec agrégats et prénom organisateur", async () => {
      mockListMySharedCarts.mockResolvedValue([]);
      const savedRow = {
        id: 'sc-2', token: 'tok-2', title: 'Liste reçue', status: 'open',
        saved_at: '2026-08-02', organizer_full_name: 'Samsam Ali',
        total_kmf: 5000, items_count: 3, claimed_count: 1,
      };
      db.query.mockResolvedValueOnce({ rows: [savedRow] });

      const result = await getSharedCartLibrary('user-2');

      expect(result.saved).toEqual([savedRow]);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('shared_cart_saved_access'),
        ['user-2']
      );
    });

    it("les deux sections sont indépendantes : une bibliothèque vide des deux côtés ne casse rien", async () => {
      mockListMySharedCarts.mockResolvedValue([]);
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await getSharedCartLibrary('user-3');

      expect(result).toEqual({ created: [], saved: [] });
    });
  });

  describe('saveSharedCartForUser', () => {
    it('refuse un token vide, avant toute requête', async () => {
      await expect(saveSharedCartForUser('user-1', '')).rejects.toMatchObject({
        code: 'token_required', status: 400,
      });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('refuse un token absent (undefined), avant toute requête', async () => {
      await expect(saveSharedCartForUser('user-1', undefined)).rejects.toMatchObject({
        code: 'token_required', status: 400,
      });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('token inconnu -> 404 shared_cart_not_found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(saveSharedCartForUser('user-1', 'tok-missing')).rejects.toMatchObject({
        code: 'shared_cart_not_found', status: 404,
      });
    });

    it("un créateur ne peut pas sauvegarder sa propre liste -> 400 cannot_save_own_list, aucun INSERT", async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 'sc-1', organizer_user_id: 'user-1' }] });

      await expect(saveSharedCartForUser('user-1', 'tok-1')).rejects.toMatchObject({
        code: 'cannot_save_own_list', status: 400,
      });
      expect(db.query).toHaveBeenCalledTimes(1); // pas de 2e appel (dédup ou insert)
    });

    it('sauvegarde une liste reçue (premier appel) -> INSERT, already_saved=false', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 'sc-2', organizer_user_id: 'user-organizer' }] }) // lookup token
        .mockResolvedValueOnce({ rows: [] }) // dédup check
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT

      const result = await saveSharedCartForUser('user-recipient', 'tok-2');

      expect(result).toEqual({ ok: true, shared_cart_id: 'sc-2', already_saved: false });
      expect(db.query).toHaveBeenCalledTimes(3);
      expect(db.query.mock.calls[2][0]).toEqual(expect.stringContaining('INSERT INTO shared_cart_saved_access'));
      expect(db.query.mock.calls[2][1]).toEqual(['user-recipient', 'sc-2']);
    });

    it('idempotent : sauvegarder une liste déjà sauvegardée -> already_saved=true, aucun INSERT', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 'sc-2', organizer_user_id: 'user-organizer' }] }) // lookup token
        .mockResolvedValueOnce({ rows: [{ id: 'ssa-1' }] }); // déjà sauvegardée

      const result = await saveSharedCartForUser('user-recipient', 'tok-2');

      expect(result).toEqual({ ok: true, shared_cart_id: 'sc-2', already_saved: true });
      expect(db.query).toHaveBeenCalledTimes(2); // pas de 3e appel INSERT
    });
  });
});
