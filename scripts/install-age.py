"""Install the pinned official age binary locally; no system changes."""
from pathlib import Path, PurePosixPath
import hashlib, io, os, platform, ssl, tarfile, urllib.request

targets = {('Darwin', 'arm64'): ('darwin-arm64', 'e2020b073c44f692685a24d6abc378817eb81ffaaf49fd0531ef8565f767f2f5'), ('Linux', 'x86_64'): ('linux-amd64', 'cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10')}
if (platform.system(), platform.machine()) not in targets:
    raise SystemExit('Unsupported target. Supply your verified official age 1.3.2 binary explicitly.')
target, expected = targets[(platform.system(), platform.machine())]
root = Path(__file__).resolve().parent.parent / '.tooling' / 'age-v1.3.2'
if root.exists():
    raise SystemExit('Local age directory already exists; keep the existing verified copy.')
url = f'https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-{target}.tar.gz'
context = ssl.create_default_context()
with urllib.request.urlopen(url, context=context, timeout=60) as response:
    data = response.read(25_000_001)
if len(data) > 25_000_000 or hashlib.sha256(data).hexdigest() != expected:
    raise SystemExit('Download size or SHA256 mismatch; nothing installed.')
with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
    members = archive.getmembers()
    seen = set()
    for member in members:
        p = PurePosixPath(member.name)
        if p.is_absolute() or '..' in p.parts or '\\' in member.name or member.issym() or member.islnk() or not (member.isdir() or member.isfile()) or member.name in seen:
            raise SystemExit('Unsafe release archive; nothing installed.')
        seen.add(member.name)
    root.mkdir(parents=True, mode=0o700)
    for member in members:
        target = root.joinpath(*PurePosixPath(member.name).parts)
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True, mode=0o700)
        else:
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            target.write_bytes(archive.extractfile(member).read())
            target.chmod(0o700 if target.name in ('age', 'age-keygen') else 0o600)
(root / 'download-sha256.txt').write_text(expected + '\n' + url + '\n')
print(root)
