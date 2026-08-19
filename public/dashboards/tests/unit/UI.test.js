'use strict';

/**
 * LOT 2A — couverture des composants historiques regroupés dans UI.js
 * + états canoniques ajoutés sans changement de classes ni de rendu.
 */

require('../../admin/js/components/UI.js');

describe('UI.js components', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  describe('AlertList', () => {
    it('rend une alerte complète avec icône métier, meta et action', () => {
      const el = window.AlertList.render({
        key: 'paid_but_stock_blocked',
        level: 'critical',
        label: 'Stock bloqué',
        count: 2,
        created_at: '2026-08-19T10:00:00.000Z',
        source: 'orders',
        action_url: '/admin/orders-logistics',
        action_label: 'Ouvrir',
      });

      expect(el.className).toContain('alert-item');
      expect(el.className).toContain('is-critical');
      expect(el.querySelector('.alert-icon').textContent).toBe('🔒');
      expect(el.querySelector('.alert-title').textContent).toBe('Stock bloqué');
      expect(el.querySelector('.alert-meta').textContent).toContain('2 concerné(s)');
      expect(el.querySelector('.alert-meta').textContent).toContain('orders');
      expect(el.querySelector('.alert-action').getAttribute('href')).toBe('/admin/orders-logistics');
      expect(el.querySelector('.alert-action').textContent).toBe('Ouvrir');
    });

    it('applique les fallbacks level, titre, icône et libellé action', () => {
      const info = window.AlertList.render({ message: 'Info', action_url: '/admin/pilotage' });
      expect(info.className).toContain('is-info');
      expect(info.querySelector('.alert-icon').textContent).toBe('ℹ️');
      expect(info.querySelector('.alert-title').textContent).toBe('Info');
      expect(info.querySelector('.alert-action').textContent).toBe('Voir');

      const sourceOnly = window.AlertList.render({ level: 'unknown', source: 'radar' });
      expect(sourceOnly.querySelector('.alert-title').textContent).toBe('radar');
      expect(sourceOnly.querySelector('.alert-icon').textContent).toBe('ℹ️');

      const bare = window.AlertList.render({});
      expect(bare.querySelector('.alert-title').textContent).toBe('Alerte');
      expect(bare.querySelector('.alert-action')).toBeNull();
    });

    it('rend empty state ou une liste limitée', () => {
      const root = document.getElementById('root');
      window.AlertList.renderList(root, [], { emptyText: 'RAS' });
      expect(root.classList.contains('alert-list')).toBe(true);
      expect(root.querySelector('.empty-state').textContent).toBe('RAS');

      window.AlertList.renderList(root, [
        { label: 'A' }, { label: 'B' }, { label: 'C' },
      ], { limit: 2 });
      expect(root.querySelectorAll('.alert-item')).toHaveLength(2);

      window.AlertList.renderList(root, null);
      expect(root.querySelector('.empty-state').textContent).toBe('Aucune alerte');
    });
  });

  describe('BadgeStatus', () => {
    it('mappe les statuts connus et fallback gray', () => {
      expect(window.BadgeStatus.status('paid').className).toContain('is-green');
      expect(window.BadgeStatus.status('pending').className).toContain('is-orange');
      expect(window.BadgeStatus.status('ordered').className).toContain('is-blue');
      expect(window.BadgeStatus.status('cancelled').className).toContain('is-red');
      expect(window.BadgeStatus.status('unknown').className).toContain('is-gray');
    });

    it('rend le cost status sans dérivation', () => {
      const badge = window.BadgeStatus.costStatus('estimated');
      expect(badge.className).toBe('badge badge-cost is-estimated');
      expect(badge.textContent).toBe('estimated');
    });
  });

  describe('DataTable', () => {
    it('rend empty state avec fallback', () => {
      const root = document.getElementById('root');
      window.DataTable.render(root, { columns: [], rows: [], emptyText: 'Vide' });
      expect(root.querySelector('.empty-state').textContent).toBe('Vide');

      window.DataTable.render(root, { columns: [], rows: null });
      expect(root.querySelector('.empty-state').textContent).toBe('Aucune donnée');
    });

    it('rend headers, valeurs, alignements, classe, render HTML/HTMLElement et click row', () => {
      const root = document.getElementById('root');
      const onRowClick = jest.fn();
      const node = document.createElement('strong');
      node.textContent = 'NODE';

      window.DataTable.render(root, {
        columns: [
          { key: 'name', label: 'Nom' },
          { key: 'amount', label: 'Montant', align: 'right', cls: 'money' },
          { key: 'html', label: 'HTML', render: row => `<em>${row.html}</em>` },
          { key: 'node', label: 'Node', render: () => node },
          { key: 'empty', label: 'Vide' },
          { key: 'falsey', label: 'Falsey', render: () => 0 },
        ],
        rows: [{ name: 'Produit', amount: 123, html: 'ok', empty: null }],
        onRowClick,
      });

      const table = root.querySelector('table.data-table');
      expect(table).not.toBeNull();
      expect(root.querySelector('.table-wrapper')).not.toBeNull();
      expect(table.querySelectorAll('th')).toHaveLength(6);
      expect(table.querySelectorAll('th')[1].style.textAlign).toBe('right');

      const cells = table.querySelectorAll('tbody td');
      expect(cells[0].textContent).toBe('Produit');
      expect(cells[1].classList.contains('num')).toBe(true);
      expect(cells[1].classList.contains('money')).toBe(true);
      expect(cells[1].textContent).toBe('123');
      expect(cells[2].querySelector('em').textContent).toBe('ok');
      expect(cells[3].querySelector('strong').textContent).toBe('NODE');
      expect(cells[4].textContent).toBe('—');
      expect(cells[5].innerHTML).toBe('');

      const row = table.querySelector('tbody tr');
      expect(row.style.cursor).toBe('pointer');
      row.click();
      expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Produit' }));
    });
  });

  describe('UIState', () => {
    it('canonise loading/empty/error sur les classes historiques', () => {
      const loading = window.UIState.loadingState();
      expect(loading.className).toBe('loading-state');
      expect(loading.querySelector('.loader')).not.toBeNull();
      expect(loading.textContent).toContain('Chargement...');

      const loadingSilent = window.UIState.loadingState('');
      expect(loadingSilent.querySelector('.loader')).not.toBeNull();
      expect(loadingSilent.textContent).toBe('');

      expect(window.UIState.emptyState().className).toBe('empty-state');
      expect(window.UIState.emptyState().textContent).toBe('Aucune donnée');
      expect(window.UIState.emptyState('RAS').textContent).toBe('RAS');
      expect(window.UIState.errorState().className).toBe('error-state');
      expect(window.UIState.errorState().textContent).toBe('Erreur de chargement');
      expect(window.UIState.errorState('Boom').textContent).toBe('Boom');
    });
  });
});
