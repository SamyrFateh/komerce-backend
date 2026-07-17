import {
  OPTION_STATE,
  createModalSelection,
  selectModalOption,
} from '../../js/view-models/modal-selection-model.js';

const detail = require('../fixtures/golden-elite-pro-detail.js');

/**
 * LOT GPM-3 — Sélection SKU réelle sur le Golden Product.
 *
 * Contrairement à un test qui construirait un state à la main, chaque
 * scénario ici REJOUE la séquence de clics réelle via selectModalOption(),
 * exactement comme le fait renderAxis() dans b-modal-mobile-product.js
 * (state.modalSelection = selectModalOption(detail, state.modalSelection,
 * axisKey, value)). La vérité vient uniquement du reducer canonique.
 */

function click(state, axisKey, value) {
  return selectModalOption(detail, state, axisKey, value);
}

describe('GPM-3 — sélection SKU réelle — Golden Product Elite Pro', () => {
  test('état initial : sélection supportée, aucun SKU, médias neutres', () => {
    const state = createModalSelection(detail);
    expect(state.selection_supported).toBe(true);
    expect(state.selected_sku_id).toBeNull();
    expect(state.selected_options).toEqual({});
    // Média neutre par défaut (aucun option_values)
    expect(state.selected_media.every((m) => Object.keys(m.option_values).length === 0)).toBe(true);
  });

  test('Scénario A — Bleu seul : médias Bleu, aucune unité tant que la taille manque', () => {
    let state = createModalSelection(detail);
    state = click(state, 'Couleur', 'Bleu');

    expect(state.selected_options).toEqual({ Couleur: 'Bleu' });
    expect(state.selected_sku_id).toBeNull(); // taille manquante → pas de SKU
    expect(state.selected_media.length).toBeGreaterThan(0);
    expect(state.selected_media.every((m) => m.option_values.Couleur === 'Bleu')).toBe(true);

    // Les 3 tailles existent pour Bleu (aucune incompatibilité), mais 43
    // est en rupture réelle (stock 0 dans le fixture) : elle reste visible
    // et cliquable pour message contextuel, sans être AVAILABLE.
    const tailleStates = state.option_states.Taille.map((t) => t.state);
    expect(tailleStates).toEqual([
      OPTION_STATE.AVAILABLE,   // 42
      OPTION_STATE.OUT_OF_STOCK, // 43 — GOLD-BLU-43, stock 0
      OPTION_STATE.AVAILABLE,   // 44
    ]);
  });

  test('Scénario B — Bleu + 42 → GOLD-BLU-42, disponible, 42 000 KMF, CTA activables', () => {
    let state = createModalSelection(detail);
    state = click(state, 'Couleur', 'Bleu');
    state = click(state, 'Taille', '42');

    const unit = detail.sellable_units.find((u) => u.sku_id === state.selected_sku_id);
    expect(unit).toMatchObject({ sku: 'GOLD-BLU-42', price_kmf: 42000, stock_status: 'AVAILABLE' });
    expect(state.selection_message).toBeNull();
  });

  test('Scénario C — Bleu + 43 → rupture : sélection refusée, aucun SKU, message explicite', () => {
    let state = createModalSelection(detail);
    state = click(state, 'Couleur', 'Bleu');

    // 43 en Bleu doit être visible mais OUT_OF_STOCK dans les états d'option.
    const taille43 = state.option_states.Taille.find((t) => t.value === '43');
    expect(taille43.state).toBe(OPTION_STATE.OUT_OF_STOCK);

    // Cliquer dessus ne doit PAS produire de SKU sélectionné : le reducer
    // refuse la sélection d'une option non AVAILABLE et se contente de
    // poser un message contextuel (cf. modal-selection-model.js option.state !== AVAILABLE).
    state = click(state, 'Taille', '43');
    expect(state.selected_sku_id).toBeNull();
    expect(state.selected_options).toEqual({ Couleur: 'Bleu' }); // Taille non retenue
    expect(state.selection_message).toMatch(/rupture/i);
  });

  test('Scénario D — Bleu + 44 → GOLD-BLU-44, 45 000 KMF, association SKU↔média explicite prioritaire', () => {
    let state = createModalSelection(detail);
    state = click(state, 'Couleur', 'Bleu');
    // À ce stade (couleur seule, aucun SKU résolu), médias dérivés par
    // heuristique de couleur : tous les médias PRODUCT/SCENE/DETAIL Bleu.
    expect(state.selected_media.every((m) => m.option_values.Couleur === 'Bleu')).toBe(true);

    state = click(state, 'Taille', '44');
    const unit = detail.sellable_units.find((u) => u.sku_id === state.selected_sku_id);

    expect(unit).toMatchObject({ sku: 'GOLD-BLU-44', price_kmf: 45000, stock_status: 'AVAILABLE' });
    // GOLD-BLU-44 porte une association SKU↔média explicite (product_sku_media,
    // fixture golden-elite-pro.js::skuMediaRows) qui gagne toujours sur le
    // matching heuristique par couleur une fois le SKU complètement résolu
    // (deriveSelectedMedia : selectedSku.media_ids non vide → priorité totale,
    // jamais une fusion avec les médias couleur). Ici l'association ne pointe
    // que vers le détail semelle : le média affiché se resserre donc sur ce
    // seul visuel, ce qui est le comportement correct et documenté — pas une
    // régression.
    expect(unit.media_ids).toEqual([detail.media.find((m) => m.role === 'DETAIL' && m.option_values.Couleur === 'Bleu').id]);
    expect(state.selected_media.map((m) => m.id)).toEqual(unit.media_ids);
  });

  test('Scénario E — Noir + 43 → GOLD-BLK-43, 43 000 KMF, médias Noir', () => {
    let state = createModalSelection(detail);
    state = click(state, 'Couleur', 'Noir');
    expect(state.selected_media.every((m) => m.option_values.Couleur === 'Noir')).toBe(true);

    state = click(state, 'Taille', '43');
    const unit = detail.sellable_units.find((u) => u.sku_id === state.selected_sku_id);
    expect(unit).toMatchObject({ sku: 'GOLD-BLK-43', price_kmf: 43000, stock_status: 'AVAILABLE' });
  });

  test('Scénario F — Noir + 44 → combinaison incompatible, aucun SKU, aucun fallback', () => {
    let state = createModalSelection(detail);
    state = click(state, 'Couleur', 'Noir');

    const taille44 = state.option_states.Taille.find((t) => t.value === '44');
    expect(taille44.state).toBe(OPTION_STATE.INCOMPATIBLE);

    state = click(state, 'Taille', '44');
    expect(state.selected_sku_id).toBeNull();
    expect(state.selected_options).toEqual({ Couleur: 'Noir' });
    expect(state.selection_message).toMatch(/non proposée|combinaison/i);

    // Aucun SKU factice : la vérité vient exclusivement de sellable_units.
    expect(
      detail.sellable_units.some(
        (u) => u.option_values.Couleur === 'Noir' && u.option_values.Taille === '44'
      )
    ).toBe(false);
  });

  test('changement de couleur après sélection complète réinitialise la taille (ordre des axes respecté)', () => {
    let state = createModalSelection(detail);
    state = click(state, 'Couleur', 'Bleu');
    state = click(state, 'Taille', '42');
    expect(state.selected_sku_id).not.toBeNull();

    // Couleur est avant Taille dans option_axes → changer Couleur doit
    // effacer la sélection Taille (axisIndex logic de selectModalOption).
    state = click(state, 'Couleur', 'Noir');
    expect(state.selected_options).toEqual({ Couleur: 'Noir' });
    expect(state.selected_sku_id).toBeNull();
  });
});
