from pathlib import Path

cockpit_path = Path('public/dashboards/canonical/js/pricing-economic-cockpit.js')
source = cockpit_path.read_text(encoding='utf-8')

old_find = """  function findWorkshop(rootNode) {\n    return rootNode.querySelector('[data-pricing-workshop-enhanced]') || Array.from(rootNode.querySelectorAll('.kmc-section')).find(section => {\n      const title = section.querySelector('.kmc-section-title');\n      return title && ['Atelier des coûts', 'Atelier économique'].includes(title.textContent.trim());\n    }) || null;\n  }\n\n"""
if old_find not in source:
    raise SystemExit('findWorkshop block not found')
source = source.replace(old_find, '', 1)

old_enhance = """    const workshop = findWorkshop(options.root);\n    if (!workshop) return false;\n    const title = workshop.querySelector('.kmc-section-title');\n    if (title) title.textContent = 'Atelier économique';\n    const description = workshop.querySelector('.kmc-section-description');\n    if (description) description.textContent = 'Pilotez votre rentabilité en temps réel. Toute modification est automatiquement recalculée par le moteur.';\n    // Le cockpit affiche son propre header (titre + sous-titre + période + badge),\n    // fidèle au mock. Le header générique de la section ('.kmc-section-header')\n    // ferait doublon à l'écran : on le masque plutôt que le supprimer, pour\n    // préserver le texte pour tout consommateur non visuel et ne rien casser\n    // dans findWorkshop (qui lit ce titre au premier passage).\n    const outerHeader = workshop.querySelector('.kmc-section-header');\n    if (outerHeader) outerHeader.classList.add('kmc-cockpit-outer-header-hidden');\n"""
new_enhance = """    // Contrat exclusif : le cockpit ne dépend plus d'un DOM Legacy préalable.\n    // Le payload serveur suffit à construire la surface approuvée ; cela\n    // permet un premier rendu atomique sans jamais exposer l'ancien workspace.\n"""
if old_enhance not in source:
    raise SystemExit('legacy enhance prelude not found')
source = source.replace(old_enhance, new_enhance, 1)

old_install = """    workspace.mount = async function economicCockpitAwareMount(options) {\n      const payload = await originalMount(options);\n      await enhance(rootObject, workspace, options, payload);\n      return payload;\n    };\n"""
new_install = """    workspace.mount = async function economicCockpitAwareMount(options) {\n      // pricing-workspace et ses anciens wrappers restent utiles comme\n      // fournisseurs de payload/actions, mais leur DOM ne doit jamais être\n      // peint dans la surface visible. On les exécute dans un root détaché,\n      // puis on construit le mock sur le vrai root en un swap atomique.\n      const stagingRoot = options.document.createElement('div');\n      const payload = await originalMount({ ...options, root: stagingRoot });\n      await enhance(rootObject, workspace, options, payload);\n      return payload;\n    };\n"""
if old_install not in source:
    raise SystemExit('install wrapper not found')
source = source.replace(old_install, new_install, 1)
cockpit_path.write_text(source, encoding='utf-8')

index_path = Path('public/dashboards/canonical/index.html')
index = index_path.read_text(encoding='utf-8')
if 'pricing-economic-cockpit.js?v=1405' not in index:
    raise SystemExit('cockpit cache version 1405 not found')
index = index.replace('pricing-economic-cockpit.js?v=1405', 'pricing-economic-cockpit.js?v=1406', 1)
index_path.write_text(index, encoding='utf-8')

test_path = Path('tests/unit/canonical-pricing-economic-cockpit.test.js')
test = test_path.read_text(encoding='utf-8')
test = test.replace('pricing-economic-cockpit.js?v=1405', 'pricing-economic-cockpit.js?v=1406', 1)
test = test.replace("  expect(source).toContain(\"title.textContent = 'Atelier économique'\");\n", '', 1)
needle = "  expect(source).not.toContain('advanced.open');\n"
insert = """  expect(source).not.toContain('advanced.open');\n  // Au refresh, l'ancien pricing-workspace ne doit jamais peindre le root visible.\n  expect(source).toContain(\"const stagingRoot = options.document.createElement('div')\");\n  expect(source).toContain('const payload = await originalMount({ ...options, root: stagingRoot })');\n  expect(source).toContain('await enhance(rootObject, workspace, options, payload)');\n  expect(source).not.toContain('const payload = await originalMount(options)');\n  expect(source).not.toContain('findWorkshop');\n"""
if needle not in test:
    raise SystemExit('test insertion point not found')
test = test.replace(needle, insert, 1)
test_path.write_text(test, encoding='utf-8')
