from pathlib import Path

p = Path('bootstrap/html-routes.js')
text = p.read_text(encoding='utf-8')

empty = """  const PRICING_CANONICAL_ENTRYPOINTS = Object.freeze([
  ]);
"""
filled = """  const PRICING_CANONICAL_ENTRYPOINTS = Object.freeze([
    '/admin/pricing',
    '/admin/pricing-workshop',
    '/admin/pricing-strategy',
    '/admin/economic-flow',
  ]);
"""
if empty not in text:
    raise SystemExit('PRICING_ENTRYPOINT_TABLE_NOT_EMPTY_AS_EXPECTED')
text = text.replace(empty, filled, 1)

marker = "  const ADMIN_DASHBOARD_PATHS = [\n"
if marker not in text:
    raise SystemExit('ADMIN_DASHBOARD_PATHS_MARKER_MISSING')
head, tail = text.split(marker, 1)
for entry in [
    "    '/admin/pricing',\n",
    "    '/admin/pricing-workshop',\n",
    "    '/admin/pricing-strategy',\n",
    "    '/admin/economic-flow',\n",
]:
    if entry not in tail:
        raise SystemExit(f'LEGACY_PRICING_ENTRY_MISSING {entry.strip()}')
    tail = tail.replace(entry, '', 1)

p.write_text(head + marker + tail, encoding='utf-8')
print('PRICING_CUTOVER_4J_ROUTE_TABLE_FIXED')
