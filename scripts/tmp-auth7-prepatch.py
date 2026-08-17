from pathlib import Path
import re

p = Path('scripts/tmp-auth7-apply.py')
text = p.read_text(encoding='utf-8')
text = text.replace('from pathlib import Path\n', 'from pathlib import Path\nimport re\n', 1)
pattern = re.compile(r"rep\('routes/otp\.js',\n\s+\"function signKomerceJwt\(user, phone\).*?label='otp claims'\)\n", re.S)
replacement = '''p_otp = Path('routes/otp.js')
otp_text = p_otp.read_text(encoding='utf-8')
otp_pattern = re.compile(r"function signKomerceJwt\\(user, phone\\) \\{.*?\\n\\}", re.S)
if len(otp_pattern.findall(otp_text)) != 1:
    raise SystemExit('otp claims: expected exactly one signKomerceJwt function')
otp_text = otp_pattern.sub("function signKomerceJwt(user, phone) {\\n  return signAuthToken(user, { method: 'otp', phone, fullName: user.full_name });\\n}", otp_text, count=1)
p_otp.write_text(otp_text, encoding='utf-8')
'''
text, n = pattern.subn(replacement, text, count=1)
if n != 1:
    raise SystemExit(f'prepatch target not found: {n}')
p.write_text(text, encoding='utf-8')
Path('scripts/tmp-auth7-prepatch.py').unlink()
