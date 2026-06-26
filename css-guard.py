#!/usr/bin/env python3
"""
CSS GUARDIAN — Komerce CSS Quality Gate
=======================================
Scanne les fichiers CSS dist/ et bloque le déploiement si des dérives sont détectées.

Usage :
  python3 css-guard.py                    # scan + rapport
  python3 css-guard.py --strict           # scan + exit 1 si violations
  python3 css-guard.py --baseline 153     # autorise max 153 conflits (mode ratchet)
  python3 css-guard.py --fix-report       # génère un rapport de nettoyage priorisé

Retour :
  0 = OK (ou sous le baseline)
  1 = Violations détectées (mode --strict ou au-dessus du baseline)
"""

import re, sys, json, os
from collections import defaultdict
from pathlib import Path

# ─── Configuration ──────────────────────────────────────────────────────────
CSS_DIR = os.environ.get("CSS_DIR", "public/boutique/css/dist")
DIST_FILES = ["base.css", "components.css", "desktop.css", "event.css"]

# Règles invariantes : ces propriétés ne doivent JAMAIS avoir plus d'une valeur
# par sélecteur+media. Violations = erreur bloquante.
INVARIANTS = {
    "display", "position", "height", "width", "max-width", "min-height",
    "grid-template-columns", "flex", "overflow", "overflow-x", "overflow-y",
    "z-index", "object-fit", "object-position", "aspect-ratio",
}

# Sélecteurs critiques : tout conflit sur ceux-ci est une erreur bloquante
CRITICAL_SELECTORS = [
    ".k-hero-img", ".k-header", "#k-hero-fixed-wrap", ".k-hero-media",
    "body", "html", ":root", "#k-page-scroll", "#k-catalog-section",
]

# Propriétés cosmétiques : conflits tolérés (warning, pas error)
COSMETIC_PROPS = {
    "box-shadow", "border-radius", "background", "color", "font-size",
    "font-weight", "padding", "margin", "gap", "letter-spacing",
    "line-height", "border", "border-color", "border-bottom",
    "transition", "animation", "filter", "transform", "opacity",
}

# ─── Parser CSS simplifié ───────────────────────────────────────────────────
def parse_css(content, filename):
    """Parse CSS en règles {selector, media, props, line}.
    Tracks @media nesting via brace depth."""
    rules = []
    lines = content.split('\n')
    depth = 0
    media_at = {}  # depth -> media string
    in_kf = False
    kf_base = -1
    sel = None
    props = {}
    sline = 0

    for i, line in enumerate(lines, 1):
        s = line.strip()
        o = s.count('{')
        c = s.count('}')

        if re.match(r'^@media\b', s) and o > 0:
            depth += 1
            media_at[depth] = s
            depth += o - 1 - c
            continue
        if re.match(r'^@(keyframes|font-face)\b', s):
            in_kf = True; kf_base = depth
            depth += o - c
            continue
        if in_kf:
            depth += o - c
            if depth <= kf_base: in_kf = False
            continue
        if s.startswith('@') and o > 0:
            depth += o - c
            continue

        if o > 0 and not s.startswith('/*'):
            cand = s.split('{')[0].strip()
            if cand and not re.match(r'^[\d]+%', cand) and cand not in ('from', 'to'):
                sel = cand; sline = i; props = {}

        elif sel and ':' in s and not s.startswith('/*') and not s.startswith('//'):
            parts = s.rstrip(';').split(':', 1)
            if len(parts) == 2 and not parts[0].strip().startswith('--'):
                props[parts[0].strip()] = parts[1].strip()

        if c > 0 and sel:
            media = 'global'
            for d in sorted(media_at.keys()):
                if d <= depth: media = media_at[d]
            rules.append({
                'file': filename, 'line': sline,
                'selector': sel, 'media': media,
                'props': props.copy()
            })
            sel = None; props = {}

        depth += o - c
        for d in [k for k in media_at if k > depth]:
            del media_at[d]

    return rules


# ─── Détection des conflits ────────────────────────────────────────────────
def find_conflicts(all_rules):
    """Trouve les sélecteurs avec des propriétés en conflit."""
    groups = defaultdict(list)
    for r in all_rules:
        groups[(r['selector'], r['media'])].append(r)

    conflicts = []
    for key, group in groups.items():
        if len(group) <= 1:
            continue

        all_props = set()
        for r in group:
            all_props.update(r['props'].keys())

        conflict_details = []
        for prop in sorted(all_props):
            vals = [(r['file'], r['line'], r['props'][prop]) for r in group if prop in r['props']]
            if len(vals) > 1:
                unique = set(v[2] for v in vals)
                if len(unique) > 1:
                    conflict_details.append({
                        'prop': prop,
                        'values': vals,
                        'is_invariant': prop in INVARIANTS,
                        'is_cosmetic': prop in COSMETIC_PROPS,
                    })

        if conflict_details:
            sel = key[0]
            is_critical = any(cs in sel for cs in CRITICAL_SELECTORS)
            conflicts.append({
                'selector': sel,
                'media': key[1],
                'rule_count': len(group),
                'dead_rules': len(group) - 1,
                'locations': [(r['file'], r['line']) for r in group],
                'details': conflict_details,
                'is_critical': is_critical,
                'has_invariant_conflict': any(d['is_invariant'] for d in conflict_details),
            })

    return conflicts


# ─── Détection des fuites de scope ──────────────────────────────────────────
def find_scope_leaks(all_rules):
    """Détecte les règles mobile qui ne sont pas dans un @media max-width."""
    mobile_patterns = [
        'k-mobile-premium', 'k-hero-img.*clamp', 'aspect-ratio.*1080',
        'safe-area-inset', 'k-bnav',
    ]
    leaks = []
    for r in all_rules:
        if r['media'] != 'global':
            continue
        sel = r['selector']
        for pat in mobile_patterns:
            if re.search(pat, sel):
                leaks.append({
                    'selector': sel,
                    'file': r['file'],
                    'line': r['line'],
                    'reason': f"Sélecteur mobile '{pat}' en scope global (devrait être dans @media max-width:899px)"
                })
                break
    return leaks


# ─── Détection des doublons exacts ──────────────────────────────────────────
def find_exact_duplicates(all_rules):
    """Trouve les règles identiques (même sélecteur, mêmes props, mêmes valeurs)."""
    seen = {}
    duplicates = []
    for r in all_rules:
        key = (r['selector'], r['media'], tuple(sorted(r['props'].items())))
        if key in seen:
            duplicates.append({
                'selector': r['selector'],
                'original': seen[key],
                'duplicate': (r['file'], r['line']),
            })
        else:
            seen[key] = (r['file'], r['line'])
    return duplicates


# ─── Rapport ────────────────────────────────────────────────────────────────
def print_report(conflicts, leaks, duplicates, strict=False, baseline=None):
    """Affiche le rapport et retourne le code de sortie."""
    errors = 0
    warnings = 0

    # Errors: invariant conflicts on critical selectors
    critical_conflicts = [c for c in conflicts if c['is_critical'] or c['has_invariant_conflict']]
    other_conflicts = [c for c in conflicts if not c['is_critical'] and not c['has_invariant_conflict']]

    total_dead = sum(c['dead_rules'] for c in conflicts)

    print("╔══════════════════════════════════════════════════════════════╗")
    print("║           CSS GUARDIAN — Rapport de qualité                 ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print()
    print(f"  Conflits critiques (invariants) :  {len(critical_conflicts)}")
    print(f"  Conflits cosmétiques :             {len(other_conflicts)}")
    print(f"  Fuites de scope :                  {len(leaks)}")
    print(f"  Doublons exacts :                  {len(duplicates)}")
    print(f"  Règles mortes estimées :           ~{total_dead}")
    print()

    # ── Critical conflicts ──
    if critical_conflicts:
        print("── ERREURS (conflits critiques — bloquants) ──────────────────")
        for c in critical_conflicts[:20]:
            locs = ', '.join(f"{f}:L{l}" for f, l in c['locations'])
            print(f"\n  ❌ {c['selector']}  ({c['rule_count']} déclarations)")
            print(f"     {locs}")
            for d in c['details']:
                if d['is_invariant']:
                    errors += 1
                    print(f"     ├─ {d['prop']}:")
                    for f, l, v in d['values']:
                        v_short = v[:60] + '…' if len(v) > 60 else v
                        print(f"     │  {f}:L{l} → {v_short}")
        print()

    # ── Scope leaks ──
    if leaks:
        print("── ERREURS (fuites de scope) ─────────────────────────────────")
        for leak in leaks[:10]:
            errors += 1
            print(f"  ❌ {leak['selector']}")
            print(f"     {leak['file']}:L{leak['line']}")
            print(f"     {leak['reason']}")
        print()

    # ── Summary ──
    total_issues = len(conflicts)
    print("── RÉSUMÉ ───────────────────────────────────────────────────")
    print(f"  Total conflits :     {total_issues}")
    print(f"  Erreurs bloquantes : {errors}")
    print(f"  Warnings :           {len(other_conflicts)}")

    if baseline is not None:
        print(f"  Baseline :           {baseline}")
        if total_issues > baseline:
            print(f"  ⛔ RÉGRESSION : {total_issues - baseline} nouveaux conflits depuis le baseline !")
            return 1
        elif total_issues < baseline:
            print(f"  ✅ AMÉLIORATION : {baseline - total_issues} conflits éliminés ! Nouveau baseline recommandé : {total_issues}")
            return 0
        else:
            print(f"  ⚠️  Stable (pas de régression, pas d'amélioration)")
            return 0

    if strict and errors > 0:
        print(f"\n  ⛔ {errors} erreurs bloquantes — déploiement interdit")
        return 1

    if total_issues == 0:
        print(f"\n  ✅ CSS propre — aucun conflit détecté")

    return 0


# ─── Main ───────────────────────────────────────────────────────────────────
def main():
    strict = '--strict' in sys.argv
    baseline = None
    fix_report = '--fix-report' in sys.argv

    for arg in sys.argv:
        if arg.startswith('--baseline'):
            if '=' in arg:
                baseline = int(arg.split('=')[1])
            else:
                idx = sys.argv.index(arg)
                if idx + 1 < len(sys.argv):
                    baseline = int(sys.argv[idx + 1])

    # Find CSS dir
    css_dir = Path(CSS_DIR)
    if not css_dir.exists():
        # Try relative paths
        for candidate in ['.', '..', '../..']:
            test = Path(candidate) / CSS_DIR
            if test.exists():
                css_dir = test
                break

    if not css_dir.exists():
        print(f"❌ Répertoire CSS introuvable : {CSS_DIR}")
        print(f"   Définir CSS_DIR=chemin/vers/css/dist")
        sys.exit(1)

    # Parse all files
    all_rules = []
    for filename in DIST_FILES:
        filepath = css_dir / filename
        if filepath.exists():
            with open(filepath) as f:
                rules = parse_css(f.read(), filename)
                all_rules.extend(rules)
                print(f"  📄 {filename}: {len(rules)} règles")
        else:
            print(f"  ⚠️  {filename}: fichier manquant")

    print(f"  Total : {len(all_rules)} règles\n")

    # Analyze
    conflicts = find_conflicts(all_rules)
    leaks = find_scope_leaks(all_rules)
    duplicates = find_exact_duplicates(all_rules)

    # Report
    exit_code = print_report(conflicts, leaks, duplicates, strict, baseline)

    # Generate fix report if requested
    if fix_report:
        generate_fix_report(conflicts, duplicates)

    sys.exit(exit_code)


def generate_fix_report(conflicts, duplicates):
    """Génère un fichier JSON priorisé pour le nettoyage."""
    fix_items = []

    for c in conflicts:
        for d in c['details']:
            winner = d['values'][-1]  # Last declaration wins
            losers = d['values'][:-1]
            fix_items.append({
                'priority': 'high' if d['is_invariant'] else 'medium' if not d['is_cosmetic'] else 'low',
                'action': 'remove_dead_rule',
                'selector': c['selector'],
                'media': c['media'],
                'property': d['prop'],
                'winner': {'file': winner[0], 'line': winner[1], 'value': winner[2]},
                'dead': [{'file': v[0], 'line': v[1], 'value': v[2]} for v in losers],
            })

    for dup in duplicates:
        fix_items.append({
            'priority': 'high',
            'action': 'remove_exact_duplicate',
            'selector': dup['selector'],
            'original': {'file': dup['original'][0], 'line': dup['original'][1]},
            'duplicate': {'file': dup['duplicate'][0], 'line': dup['duplicate'][1]},
        })

    output = Path('css-fix-plan.json')
    with open(output, 'w') as f:
        json.dump(fix_items, f, indent=2, ensure_ascii=False)

    print(f"\n  📋 Plan de nettoyage : {output} ({len(fix_items)} actions)")


if __name__ == '__main__':
    main()
