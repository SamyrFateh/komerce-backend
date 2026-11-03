'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * @brief Ownership Orders : projection du remboursement avec plafond et une seule transaction fournie.
 */
const {applyVerifiedItemRefundToOrderItem}=require('../../services/order-item-refund-settlement');
const O='00000000-0000-4000-8000-000000000001';
const I='00000000-0000-4000-8000-000000000002';
describe('Orders : écriture de quantité remboursée après preuve PSP',()=>{
  test('quantité contrôlée et rattachée à la bonne ligne/commande',async()=>{
    const query=jest.fn(async()=>({rows:[{id:I}]}));
    await expect(applyVerifiedItemRefundToOrderItem({query},{
      orderId:O,orderItemId:I,quantity:1
    })).resolves.toEqual({orderItemId:I,quantity:1});
    const [sql,params]=query.mock.calls[0];
    expect(sql).toContain('qty_collected+qty_refunded+$2<=quantity');
    expect(params).toEqual([I,1,O]);
  });
  test('pas de quantité fictive si la ligne a déjà été remise ou remboursée',async()=>{
    const query=jest.fn(async()=>({rows:[]}));
    await expect(applyVerifiedItemRefundToOrderItem({query},{
      orderId:O,orderItemId:I,quantity:1
    })).rejects.toMatchObject({code:'ITEM_REFUND_QTY_FINALIZATION_CONFLICT'});
  });
  test('quantité invalide refusée sans requête SQL',async()=>{
    const query=jest.fn();
    await expect(applyVerifiedItemRefundToOrderItem({query},{
      orderId:O,orderItemId:I,quantity:0
    })).rejects.toMatchObject({code:'ITEM_REFUND_QTY_FINALIZATION_CONFLICT'});
    expect(query).not.toHaveBeenCalled();
  });
});
