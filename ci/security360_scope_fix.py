from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
p = root / 'scripts/pr-enforcement-scope.js'
src = p.read_text()

old = "    || /^(?:routes|services|middleware|utils|validators|core|bootstrap|db)\\/.+/i.test(f)\n    || /^tests\\/.+/i.test(f);"
new = "    || /^(?:routes|services|middleware|utils|validators|core|bootstrap|db)\\/.+/i.test(f)\n    || /^(?:scripts\\/(?:gen-security-360|run-security-360)\\.js|scripts\\/\\.security-360-baseline\\.json|docs\\/SECURITY_360\\.(?:json|md))$/i.test(f)\n    || /^tests\\/.+/i.test(f);"

if new not in src:
    if old not in src:
        raise SystemExit('isBackendFile anchor not found')
    src = src.replace(old, new, 1)

p.write_text(src)
