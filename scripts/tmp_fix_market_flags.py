from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'pattern not found in {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, 1))

nav = 'public/dashboards/canonical/js/navigation.js'
replace_once(nav,
"""  function proxyMarketChange(doc, value) {
""",
"""  const MARKET_FLAG_ASSETS = Object.freeze({
    CM: '/dashboards/canonical/assets/flags/CM.svg',
    CG: '/dashboards/canonical/assets/flags/CG.svg',
    KM: '/dashboards/canonical/assets/flags/KM.svg',
  });

  function marketFlagAsset(code) {
    return MARKET_FLAG_ASSETS[String(code || '').trim().toUpperCase()] || '';
  }

  function stripRegionalFlagPrefix(label) {
    return String(label || '').replace(/^[\\u{1F1E6}-\\u{1F1FF}]{2}\\s*/u, '');
  }

  function proxyMarketChange(doc, value) {
""")
replace_once(nav,
"""    const select = doc.createElement('select');
    select.className = 'kmc-admin-market-select';
    select.setAttribute('aria-label', 'Sélectionner le marché');
    const current = currentRequestedMarket(adminContext, requireMarket);

    choices.forEach(choice => {
      const option = doc.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      if ((choice.marketCode || choice.value || null) === current) option.selected = true;
      select.appendChild(option);
    });
    select.value = current || '';
    if (typeof select.addEventListener === 'function') {
      select.addEventListener('change', () => proxyMarketChange(doc, select.value || ''));
    }

    wrap.appendChild(select);
    return wrap;
""",
"""    const flag = doc.createElement('img');
    flag.className = 'kmc-admin-market-flag';
    flag.alt = '';
    flag.setAttribute('aria-hidden', 'true');

    const select = doc.createElement('select');
    select.className = 'kmc-admin-market-select';
    select.setAttribute('aria-label', 'Sélectionner le marché');
    const current = currentRequestedMarket(adminContext, requireMarket);

    const syncFlag = marketCode => {
      const asset = marketFlagAsset(marketCode);
      flag.src = asset;
      flag.hidden = !asset;
      flag.setAttribute('data-market-flag', asset ? String(marketCode || '').toUpperCase() : '');
      select.className = `kmc-admin-market-select${asset ? ' has-flag' : ''}`;
    };

    choices.forEach(choice => {
      const option = doc.createElement('option');
      option.value = choice.value;
      option.textContent = stripRegionalFlagPrefix(choice.label);
      if ((choice.marketCode || choice.value || null) === current) option.selected = true;
      select.appendChild(option);
    });
    select.value = current || '';
    syncFlag(current);
    if (typeof select.addEventListener === 'function') {
      select.addEventListener('change', () => {
        syncFlag(select.value || '');
        proxyMarketChange(doc, select.value || '');
      });
    }

    wrap.appendChild(flag);
    wrap.appendChild(select);
    return wrap;
""")

css = 'public/dashboards/canonical/css/navigation.css'
replace_once(css,
""".kmc-admin-market-control {
  display: inline-flex;
  align-items: center;
}

.kmc-admin-market-select {
""",
""".kmc-admin-market-control {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.kmc-admin-market-flag {
  position: absolute;
  left: 11px;
  top: 50%;
  z-index: 1;
  width: 20px;
  height: 14px;
  transform: translateY(-50%);
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.20);
  object-fit: cover;
  pointer-events: none;
}

.kmc-admin-market-flag[hidden] { display: none; }

.kmc-admin-market-select {
""")
replace_once(css,
"""  padding: 0 34px 0 12px;
""",
"""  padding: 0 34px 0 12px;
""")
replace_once(css,
""".kmc-admin-market-select:hover,
.kmc-admin-market-select:focus-visible {
""",
""".kmc-admin-market-select.has-flag {
  padding-left: 40px;
}

.kmc-admin-market-select:hover,
.kmc-admin-market-select:focus-visible {
""")

for html in [
    'public/dashboards/canonical/index.html',
    'public/dashboards/canonical/access.html',
    'public/dashboards/canonical/market-autonomy.html',
]:
    p = Path(html)
    s = p.read_text()
    s = s.replace('navigation.css?v=1501', 'navigation.css?v=1503')
    s = s.replace('navigation.css?v=1502', 'navigation.css?v=1503')
    s = s.replace('navigation.js?v=1501', 'navigation.js?v=1504')
    s = s.replace('navigation.js?v=1503', 'navigation.js?v=1504')
    p.write_text(s)

test = 'tests/unit/canonical-navigation.test.js'
p = Path(test)
s = p.read_text()
s = s.replace(
"""    const marketControl = utilities.children[0];
    const select = marketControl.children[0];

    expect(select.className).toBe('kmc-admin-market-select');
    expect(select.value).toBe('CM');
    expect(select.children.map(option => option.textContent)).toEqual(['CM']);
""",
"""    const marketControl = utilities.children[0];
    const flag = marketControl.children[0];
    const select = marketControl.children[1];

    expect(flag.className).toBe('kmc-admin-market-flag');
    expect(flag.src).toBe('/dashboards/canonical/assets/flags/CM.svg');
    expect(flag.hidden).toBe(false);
    expect(select.className).toBe('kmc-admin-market-select has-flag');
    expect(select.value).toBe('CM');
    expect(select.children.map(option => option.textContent)).toEqual(['CM']);
""")
s = s.replace(
"""    const select = header.children[0].children[2].children[0].children[0];
    expect(select.value).toBe('CM');
""",
"""    const marketControl = header.children[0].children[2].children[0];
    const flag = marketControl.children[0];
    const select = marketControl.children[1];
    expect(flag.src).toBe('/dashboards/canonical/assets/flags/CM.svg');
    expect(select.value).toBe('CM');
""")
anchor = """  test('Déconnexion appelle le endpoint auth puis revient au login', async () => {"""
insert = """  test('le drapeau visible suit le Market ID sélectionné sans dépendre des emoji Windows', () => {
    const env = loadNavigation('/admin/workspaces/pricing', 'pricing-workspace');
    const header = env.api.mount({
      document: env.document,
      pathname: '/admin/workspaces/pricing',
      surface: 'pricing-workspace',
      user: { role: 'admin' },
      adminContext: {
        access: {
          mode: 'global',
          defaultMarket: 'CM',
          allowedMarkets: ['CM', 'CG', 'KM'],
        },
      },
    });
    const marketControl = header.children[0].children[2].children[0];
    const flag = marketControl.children[0];
    const select = marketControl.children[1];

    expect(flag.src).toBe('/dashboards/canonical/assets/flags/CM.svg');
    select.value = 'CG';
    select.listeners.change();
    expect(flag.src).toBe('/dashboards/canonical/assets/flags/CG.svg');
    expect(flag.attributes['data-market-flag']).toBe('CG');
    select.value = 'KM';
    select.listeners.change();
    expect(flag.src).toBe('/dashboards/canonical/assets/flags/KM.svg');
  });

"""
if anchor not in s:
    raise SystemExit('navigation test anchor not found')
p.write_text(s.replace(anchor, insert + anchor, 1))
