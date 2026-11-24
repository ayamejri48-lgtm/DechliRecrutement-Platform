from pathlib import Path

files = [
    Path(
        r"c:\Users\ayame\Desktop\pfe declitech\DechliRecrutement_Frontend_Interfaces_Ameliorees"
        r"\dechli-recrutement\src\app\features\recruiter\dashboard\recruiter-dashboard.component.html"
    ),
    Path(
        r"c:\Users\ayame\Desktop\pfe declitech\DechliRecrutement_Frontend_Interfaces_Ameliorees"
        r"\dechli-recrutement\src\app\features\recruiter\matching\recruiter-matching.component.html"
    ),
]

for p in files:
    t = p.read_text(encoding="utf-8")
    before = t
    if "\u00c3" in t or "\u00e2" in t:  # Ã or â
        try:
            t = t.encode("latin-1").decode("utf-8")
        except (UnicodeDecodeError, UnicodeEncodeError) as e:
            print(p.name, "roundtrip fail", e)
    p.write_text(t, encoding="utf-8", newline="\n")
    print(p.name, "changed", t != before)
    for line in t.splitlines():
        s = line.strip()
        if any(k in s for k in ("résultat", "Calcul", "Chargement", "Aucun", "Envoi", "élément")):
            print(" ", repr(s[:100]))
