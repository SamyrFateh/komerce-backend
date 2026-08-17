from pathlib import Path
import re

p = Path('scripts/tmp-auth7-apply.py')
text = p.read_text(encoding='utf-8')
pattern = re.compile(
    r"rep\('routes/otp\.js',\n\s+\"function signKomerceJwt\(user, phone\).*?label='otp claims'\)\n",
    re.S,
)
replacement = '''p_otp = Path('routes/otp.js')
otp_text = p_otp.read_text(encoding='utf-8')
start_marker = "function signKomerceJwt(user, phone) {"
start = otp_text.find(start_marker)
if start < 0:
    raise SystemExit('otp claims: signKomerceJwt start not found')
end = otp_text.find("\\n}\\n", start)
if end < 0:
    raise SystemExit('otp claims: signKomerceJwt end not found')
otp_replacement = "function signKomerceJwt(user, phone) {\\n  return signAuthToken(user, { method: 'otp', phone, fullName: user.full_name });\\n}"
otp_text = otp_text[:start] + otp_replacement + otp_text[end + 2:]
p_otp.write_text(otp_text, encoding='utf-8')
'''
text, n = pattern.subn(lambda _m: replacement, text, count=1)
if n != 1:
    raise SystemExit(f'prepatch target not found: {n}')
p.write_text(text, encoding='utf-8')
Path('scripts/tmp-auth7-prepatch.py').unlink()
