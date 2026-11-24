from pathlib import Path

root = Path(__file__).parent / "src" / "app" / "features"
targets = list(root.rglob("*.html")) + list(root.rglob("*.ts"))

changed = []
for p in targets:
    raw = p.read_bytes()
    try:
        t = raw.decode("utf-8")
    except UnicodeDecodeError:
        t = raw.decode("cp1252")

    original = t

    # Round-trip common UTF-8-as-Latin1 mojibake
    if "â" in t or "Ã" in t:
        try:
            t = t.encode("latin-1").decode("utf-8")
        except (UnicodeDecodeError, UnicodeEncodeError):
            pass

    # CP1252 specials that may remain
    t = (
        t.replace("\x85", "\u2026")
        .replace("\x92", "\u2019")
        .replace("\x91", "\u2018")
        .replace("\x96", "\u2013")
        .replace("\x97", "\u2014")
    )

    if t != original or raw != t.encode("utf-8"):
        p.write_text(t, encoding="utf-8", newline="\n")
        changed.append(p.name)

print("changed", len(changed))
for n in changed:
    print(" -", n)

# verify key lines
p = root / "recruiter" / "candidatures" / "recruiter-candidate-dossier.component.html"
for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
    if i in (15, 17) or "profil" in line.lower():
        if "Chargement" in line or "Impossible" in line or "profil" in line:
            print(i, repr(line))
