from pathlib import Path

p = Path('features/infrastructure.feature.js')
src = p.read_text()

script_anchor = "      'scripts/schema-promote-all.js',\n"
if src.count(script_anchor) == 0:
    # Older manifest may not yet list the recent promote scripts; anchor near schema freshness instead.
    script_anchor = "      'scripts/check-schema-freshness.js',\n"
    if src.count(script_anchor) != 1:
        raise RuntimeError('infrastructure script anchor missing')
    src = src.replace(
        script_anchor,
        script_anchor + "      'scripts/schema-sync-summary.js',\n",
        1,
    )
else:
    if src.count(script_anchor) != 1:
        raise RuntimeError('schema-promote-all manifest anchor duplicated')
    src = src.replace(
        script_anchor,
        script_anchor + "      'scripts/schema-sync-summary.js',\n",
        1,
    )

test_anchor = "      'tests/unit/request-id.test.js',\n"
if src.count(test_anchor) != 1:
    raise RuntimeError('infrastructure test anchor missing')
src = src.replace(
    test_anchor,
    test_anchor + "      'tests/unit/schema-sync-summary.test.js',\n",
    1,
)

p.write_text(src)
print('✅ infrastructure ownership updated for schema summary sync')
