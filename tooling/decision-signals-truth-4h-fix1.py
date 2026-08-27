#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
path = ROOT / 'tests/unit/signals.test.js'
text = path.read_text()
old = "expect(params[4]).toEqual(['parcel_blocked', 'cash_expiring', 'sla_breach', 'hub_tension', 'relay_tension', 'loyalty_pending']);"
new = "expect(params[4]).toEqual(['parcel_blocked', 'cash_expiring', 'ordered_without_purchase_order', 'purchase_order_overreceived', 'purchase_order_receipt_stuck', 'pickup_overdue', 'preparation_stuck', 'sla_breach', 'hub_tension', 'relay_tension', 'loyalty_pending']);"
if old not in text:
    raise SystemExit('signals ops family expectation marker not found')
path.write_text(text.replace(old, new, 1))
print('LOT 4H family contract aligned')
