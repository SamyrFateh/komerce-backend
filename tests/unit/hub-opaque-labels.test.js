'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief Opaque QR and alias, real received quantity, immutable issuance, local print and market scope.
 */
const labels = require('../../services/hub-opaque-labels');

const UUID = {
  market:'11111111-1111-4111-8111-111111111111',
  relay:'22222222-2222-4222-8222-222222222222',
  allocation:'33333333-3333-4333-8333-333333333333',
  box:'44444444-4444-4444-8444-444444444444',
  actor:'55555555-5555-4555-8555-555555555555',
  order:'66666666-6666-4666-8666-666666666666',
};
function fakeDb(received=3) {
  const issued=[];
  const client={query:jest.fn(async(sql,args=[])=>{
    if(sql.includes('FROM hub_purchase_allocations a JOIN orders o')) return {rows:[{
      id:UUID.allocation,market_id:UUID.market,relais_id:UUID.relay,order_id:UUID.order,
      product_sku_id:'77777777-7777-4777-8777-777777777777',
    }]};
    if(sql.includes('COALESCE(SUM(quantity),0)'))return {rows:[{qty:received}]};
    if(sql.includes('INSERT INTO hub_scan_labels')) {
      const row={id:'88888888-8888-4888-8888-'+String(issued.length+1).padStart(12,'0'),
        target_type:args[0],allocation_id:args[1],unit_number:args[2],
        physical_unit_id:args[3],market_id:args[4],relais_id:args[5],
        qr_value:args[6],short_alias:args[7]};
      if(issued.some(x=>x.qr_value===row.qr_value||x.short_alias===row.short_alias))return {rows:[]};
      issued.push(row);return {rows:[row]};
    }
    if(sql.includes("WHERE target_type='ARTICLE' AND allocation_id")) return {rows:issued.slice()};
    if(sql.includes('FROM relais WHERE id=ANY'))return {rows:[{id:UUID.relay,short_code:'YA01'}]};
    throw new Error('SQL inattendu: '+sql);
  })};
  return {client,issued};
}

describe('Étiquettes QR opaques Hub — contrat réel',()=>{
  test('politique COMBOX : étiquette existante ou nouvelle référence impose le QR',async()=>{
    const query=jest.fn().mockResolvedValueOnce({rows:[{qr_required:true}]}).mockResolvedValueOnce({rows:[{qr_required:false}]});
    await expect(labels.boxRequiresOpaqueQr({query},UUID.box)).resolves.toBe(true);
    await expect(labels.boxRequiresOpaqueQr({query},UUID.box)).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain("l.target_type='COMBOX'");
    expect(query.mock.calls[0][0]).toContain('p.removed_at IS NULL');
    expect(query.mock.calls[0][0]).toContain('o.reference ~ $2');
    expect(query.mock.calls[0][1]).toEqual([UUID.box,'^[A-Z]{2}-[A-Z]{2}[0-9]{2}-[A-Z][A-Z0-9]{2}[0-9]{2}$']);
    const refPattern=new RegExp(query.mock.calls[0][1][1]);
    expect(refPattern.test('CM-YA01-B7Q01')).toBe(true);
    expect(refPattern.test('KABC123')).toBe(false);
    expect(refPattern.test('CM-YA01-B7Q01-01')).toBe(false);
  });
  test('valeurs illisibles, références commerciales et URL refusées',()=>{
    const qr='KQ1_'+'A'.repeat(32);
    expect(labels.normalizeScan(qr.toLowerCase())).toBe(qr);
    expect(labels.normalizeScan('ABCD2345')).toBe('ABCD2345');
    for(const bad of ['CM-YA01-B7Q01-01','https://komerce.co/track','KQ1_ABC','',null,'AB<12345']){
      expect(()=>labels.normalizeScan(bad)).toThrow('HUB_LABEL_CODE_INVALID');
    }
  });
  test('aucune étiquette article avant réception physique constatée',async()=>{
    const {client,issued}=fakeDb(0);
    await expect(labels.issueArticleLabels(client,{allocationId:UUID.allocation,
      marketId:UUID.market,actorId:UUID.actor})).rejects.toThrow('HUB_LABEL_NOT_PHYSICALLY_RECEIVED');
    expect(issued).toHaveLength(0);
  });
  test('3 unités réellement reçues produisent trois QR distincts et alias opaques',async()=>{
    const {client,issued}=fakeDb(3);
    const result=await labels.issueArticleLabels(client,{allocationId:UUID.allocation,
      marketId:UUID.market,actorId:UUID.actor});
    expect(result).toHaveLength(3);
    expect(result.map(x=>x.unit_number)).toEqual([1,2,3]);
    expect(new Set(issued.map(x=>x.qr_value)).size).toBe(3);
    expect(new Set(issued.map(x=>x.short_alias)).size).toBe(3);
    for(const row of result){
      expect(row.qr_value).toMatch(/^KQ1_[A-F0-9]{32}$/);
      expect(row.short_alias).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(row.qr_value).not.toContain('B7Q');
    }
  });
  test('une quantité anormale ne provoque pas d’impression partielle silencieuse',async()=>{
    const {client,issued}=fakeDb(251);
    await expect(labels.issueArticleLabels(client,{allocationId:UUID.allocation,
      marketId:UUID.market,actorId:UUID.actor})).rejects.toThrow('HUB_LABEL_BATCH_TOO_LARGE');
    expect(issued).toHaveLength(0);
  });
  test('impression QR est locale et ne contient ni identité client ni commande',async()=>{
    const {client,issued}=fakeDb(1);
    await labels.issueArticleLabels(client,{allocationId:UUID.allocation,
      marketId:UUID.market,actorId:UUID.actor});
    const html=await labels.printHtml(client,{labels:issued,marketCode:'CM'});
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('KOMERCE');
    expect(html).toContain('CM · YA01');
    expect(html).toContain('Imprimer les étiquettes');
    for(const forbidden of ['CM-YA01-B7Q01','pickup_code','client_phone','qrserver.com','api.qrserver.com','nom client']){
      expect(html).not.toContain(forbidden);
    }
    await expect(labels.printHtml(client,{labels:issued,marketCode:'CM',format:'bogus'}))
      .rejects.toThrow('HUB_LABEL_PRINT_FORMAT_INVALID');
  });
  test('COMBOX mauvais relais refusé même lorsque marché identique',async()=>{
    const {client}=fakeDb();
    client.query=jest.fn(async(sql)=>{
      if(sql.includes('FROM relais WHERE id=$1'))return {rows:[{id:UUID.relay}]};
      if(sql.includes('FROM hub_physical_units WHERE id=$1'))return {rows:[{
        id:UUID.box,market_id:UUID.market,unit_type:'MARKET_PARCEL',state:'PACKED',
      }]};
      if(sql.includes('SELECT DISTINCT a.market_id,o.relais_id'))return {rows:[{
        market_id:UUID.market,relais_id:'99999999-9999-4999-8999-999999999999',
      }]};
      throw new Error('SQL inattendu: '+sql);
    });
    await expect(labels.issueBoxLabel(client,{boxId:UUID.box,marketId:UUID.market,
      relaisId:UUID.relay,actorId:UUID.actor})).rejects.toThrow('HUB_LABEL_BOX_DESTINATION_MISMATCH');
  });
  test('COMBOX ouverte : émission définitive refusée même avec destination valide',async()=>{
    const {client}=fakeDb();
    client.query=jest.fn(async sql=>{
      if(sql.includes('FROM hub_physical_units WHERE id=$1'))
        return {rows:[{id:UUID.box,market_id:UUID.market,unit_type:'MARKET_PARCEL',state:'PICKED'}]};
      throw Error('Une COMBOX ouverte ne doit pas déclencher d’autre requête: '+sql);
    });
    await expect(labels.issueBoxLabel(client,{boxId:UUID.box,marketId:UUID.market,
      actorId:UUID.actor})).rejects.toThrow('HUB_LABEL_BOX_NOT_CLOSED');
  });
  test('résolution de QR sous contrainte SQL du marché et du relais',async()=>{
    const q={query:jest.fn().mockResolvedValue({rows:[]})};
    await expect(labels.resolveLabel(q,{code:'KQ1_'+'A'.repeat(32),
      marketId:UUID.market,relaisId:UUID.relay})).rejects.toThrow('HUB_LABEL_NOT_FOUND');
    expect(q.query.mock.calls[0][0]).toContain('l.market_id=$2');
    expect(q.query.mock.calls[0][0]).toContain('l.relais_id=$3');
    expect(q.query.mock.calls[0][1]).toEqual(['KQ1_'+'A'.repeat(32),UUID.market,UUID.relay]);
  });
});

describe('Hub QR index: authorized market-only read after dispatch and collection',()=>{
  test('returns issued groups without QR payload, client data or cross-market query',async()=>{
    const q={query:jest.fn().mockResolvedValue({rows:[
      {target_type:'ARTICLE',allocation_id:UUID.allocation,target_id:UUID.allocation,label_count:3,
       issued_at:'2026-11-24T10:00:00Z',order_ref:'KABC123',box_ref:null,relay_code:'YA01',box_state:null},
      {target_type:'COMBOX',target_id:UUID.box,label_count:1,
       issued_at:'2026-11-24T11:00:00Z',order_ref:null,box_ref:'COMBOX-A',relay_code:'YA01',box_state:'DISPATCHED'}
    ]})};
    const index=await labels.listMarketLabelGroups(q,{marketId:UUID.market});
    expect(index).toEqual([
      {type:'ARTICLE',target_id:UUID.allocation,quantity:3,
       issued_at:'2026-11-24T10:00:00Z',reference:'KABC123',relay_code:'YA01',box_state:null},
      {type:'COMBOX',target_id:UUID.box,quantity:1,
       issued_at:'2026-11-24T11:00:00Z',reference:'COMBOX-A',relay_code:'YA01',box_state:'DISPATCHED'}
    ]);
    expect(q.query).toHaveBeenCalledTimes(1);
    const [sql,params]=q.query.mock.calls[0];
    expect(sql).toContain('WHERE l.market_id=$1');
    expect(sql).toContain('FROM hub_scan_labels l');
    expect(sql).toContain('GROUP BY l.target_type,l.allocation_id,l.physical_unit_id');
    expect(params).toEqual([UUID.market,80]);
    expect(JSON.stringify(index)).not.toMatch(/qr_value|client_name|client_phone|created_by/);
  });
  test('invalid market fails before SQL query and cap cannot exceed 100',async()=>{
    const q={query:jest.fn().mockResolvedValue({rows:[]})};
    await expect(labels.listMarketLabelGroups(q,{marketId:'foreign'})).rejects.toThrow('HUB_LABEL_ID_INVALID');
    expect(q.query).not.toHaveBeenCalled();
    await labels.listMarketLabelGroups(q,{marketId:UUID.market,limit:9999});
    expect(q.query.mock.calls[0][1]).toEqual([UUID.market,100]);
  });
});
