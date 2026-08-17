'use strict';
const fs = require('fs');
const file = 'public/boutique/tests/unit/b-modal-suggestions.test.js';
const src = fs.readFileSync(file, 'utf8');
const from = "    return {\n      totalQty: lines.reduce((sum, item) => sum + (Number(item.qty) || 0), 0),\n      lineCount: lines.length,\n    };";
const to = "    const totalQty = lines.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);\n    const lineCount = lines.length;\n    const hasVariantLines = lines.some((item) => {\n      const combo = item && item.variant_combo;\n      return Boolean((combo && typeof combo === 'object' && Object.keys(combo).length) || item?.variant_label || item?.sku_id || item?.skuId || item?.product_sku_id || item?.productSkuId || item?.sku || item?.reference);\n    });\n    return {\n      productId: String(productId),\n      lines,\n      line: lineCount === 1 ? lines[0] : null,\n      lineCount,\n      totalQty,\n      hasVariantLines,\n      isAmbiguous: lineCount > 1,\n      canQuickAdjust: lineCount === 1,\n    };";
if (!src.includes(from)) throw new Error('cart summary mock marker missing');
fs.writeFileSync(file, src.replace(from, to));
console.log('cart summary mock contract restored');
