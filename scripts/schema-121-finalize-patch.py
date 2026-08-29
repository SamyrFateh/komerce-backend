from pathlib import Path

schema = Path('docs/SCHEMA.md')
text = schema.read_text()

anchor = "| `webauthn_challenges` | Challenges WebAuthn éphémères persistés pour garantir single-use et séparation des cérémonies. Vérifiée live Railway. |\n"
if text.count(anchor) != 1:
    raise RuntimeError('SCHEMA anchor 4.12 bis missing or duplicated')

blocks = """

<!-- schema-pending
object: sourcing_global_access_grants
kind: table
migration: 149
section: ### 4.12 bis — Marchés, autorisations globales et Passkeys (6 tables)
role: Grants persistés autorisant explicitement les surfaces Sourcing globales ; aucune autorité globale implicite.
-->
<!-- schema-pending
object: pricing_global_access_grants
kind: table
migration: 152
section: ### 4.12 bis — Marchés, autorisations globales et Passkeys (6 tables)
role: Grants persistés autorisant explicitement le Pricing Workspace global ; aucune élévation implicite depuis le navigateur.
-->
<!-- schema-pending
object: decision_signal_global_access_grants
kind: table
migration: 153
section: ### 4.12 bis — Marchés, autorisations globales et Passkeys (6 tables)
role: Grants persistés autorisant explicitement l’Action Center global et les signaux de décision transverses.
-->
"""

for obj in (
    'sourcing_global_access_grants',
    'pricing_global_access_grants',
    'decision_signal_global_access_grants',
):
    if f'object: {obj}' in text or f'| `{obj}` |' in text:
        raise RuntimeError(f'{obj} already documented')

text = text.replace(anchor, anchor + blocks, 1)
schema.write_text(text)

workflow = Path('.github/workflows/schema-refresh.yml')
w = workflow.read_text()
trigger_anchor = "      - 'scripts/arch-reconcile.js'\n      - '.github/workflows/schema-refresh.yml'\n"
if w.count(trigger_anchor) != 1:
    raise RuntimeError('schema-refresh trigger anchor missing or duplicated')
w = w.replace(
    trigger_anchor,
    "      - 'scripts/arch-reconcile.js'\n      - 'docs/SCHEMA.md'\n      - '.github/workflows/schema-refresh.yml'\n",
    1,
)
workflow.write_text(w)

print('✅ staged: 3 grant schema-pending blocks + SCHEMA.md refresh trigger')
