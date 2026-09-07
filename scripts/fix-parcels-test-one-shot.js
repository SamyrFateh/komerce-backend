'use strict';

const fs = require('fs');
const file = 'tests/unit/parcels-route.test.js';
let src = fs.readFileSync(file, 'utf8');
const oldLine = "      expect(countSql).toMatch(/relais r WHERE r.phone/);";
const replacement = "      expect(countSql).toMatch(/FROM relais r\\s+WHERE r\\.phone/);\n      expect(mockDbQuery.mock.calls[0][1][4]).toBe(true);";
if (!src.includes(oldLine)) throw new Error('parcel relay assertion anchor missing');
src = src.replace(oldLine, replacement);
fs.writeFileSync(file, src);
console.log('parcel relay assertion aligned');
