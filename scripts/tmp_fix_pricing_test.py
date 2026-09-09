from pathlib import Path
p = Path('tests/unit/canonical-pricing-economic-cockpit.test.js')
s = p.read_text()
old = """test('les trois actions de coûts du mock ouvrent des panneaux séparés, jamais une ancienne rubrique inline', () => {\n  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');\n  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');\n"""
new = """test('les trois actions de coûts du mock ouvrent des panneaux séparés, jamais une ancienne rubrique inline', () => {\n  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-economic-cockpit.js'), 'utf8');\n  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'pricing-economic-cockpit.css'), 'utf8');\n  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');\n"""
if old not in s:
    raise SystemExit('target test header not found')
p.write_text(s.replace(old, new, 1))
