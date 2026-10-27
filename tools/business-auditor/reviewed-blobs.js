'use strict';
/**
 * Git blob SHA-1 of the exact source snapshot manually reviewed for R&D V0.2.
 * NOT a source-of-truth for current business behavior. Any drift invalidates
 * only the human triage label, not the independent detector signal.
 * DO NOT auto-regenerate this registry in CI.
 */
const SOURCE_BLOBS=Object.freeze({
 'routes/admin/system.js':'1d158a5cb3226daafc549e2811be6df10974ea9c',
 'routes/parcels.js':'c348c3b36c5806955918ed6f079ef4645814aac4',
 'routes/wallet.js':'5fd384882760c3ab059fe5cd4ac8d3f938253f32',
 'scripts/seed-a8-staging-two-orders.js':'2d856e21a408ddfad8d5e9b9b24acde950f121db',
 'services/auto-parcel.js':'0efe5c165f1f2427da0fc77fea8ccbdec58a73f9',
 'services/parcel-auto-create-service.js':'a3e62ffa2ce3382ade8afaa49167eb4a2fc400e1',
 'services/parcel-item-mutation-service.js':'9032f3a2e2d99a4d2109d7a0892a3727edd32a97',
 'services/parcel-operations.js':'88995969fb71cad5c7af9a0aee01e106499fe186',
 'services/parcelOptimizationService.js':'e119c4faedf84030adbd7f278978ba5059a884c0',
 'services/payment-paypal.js':'d12ade286f7bb69cb6950ca96d856c0485277efd',
 'services/payment-service.js':'b89ebac1c63b73b06d2fe16337957a277e7f33aa',
 'services/paypal-client.js':'136852b4e038d7f90390e1fbf5d88deb3f1aa760',
 'services/refund-service.js':'1ac57f5c6cf54fa318689f51a81c3c7fbecf6b89',
 'services/simulator/cleanup.js':'b300145209220dff2fa0446539ac2bb82943fce6',
 'services/simulator/state-advancer.js':'74e349975b4c7a8536f2a37cb79249832cd96bed',
 'tools/business-auditor/engine.test.js':'7ba6cf527b670fe1d32cdbc6a1a67d978f13e7f2',
 'tools/business-auditor/code-detectors.test.js':'1bb5c4891821f84e780d6953b16adad3f4f6b064',
 'utils/refunds.js':'dcd8869ee1707488af3d7102174d8779ce98e840',
});
module.exports={SOURCE_BLOBS};
