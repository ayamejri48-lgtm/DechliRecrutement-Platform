# -*- coding: utf-8 -*-
import json, os, subprocess, sys
from pathlib import Path
ROOT = Path(r"C:\Users\ayame\Downloads\dechli-ai-service-complet\dechli-ai-service")
sys.path.insert(0, str(ROOT))
os.environ["AI_SEMANTIC_BACKEND"] = "tfidf"
os.environ["AI_EXTRACT_BACKEND"] = "rules"
import pymupdf
from app.matching import hybrid
from app.nlp import extract as extract_rules, normalize_skills, parse_education_value

MYSQL = r"C:\xampp\mysql\bin\mysql.exe"
CV_DIR = ROOT / "data" / "tmp_qa_cvs"
OUT = ROOT / "data" / "processed" / "qa_4users_5offers_report.json"
MD = ROOT / "docs" / "QA_4USERS_5OFFERS_ANALYSE.md"

def mq(sql):
    p = subprocess.run([MYSQL, "-uroot", "-B", "-e", sql], capture_output=True, text=True, check=True)
    lines = [l for l in p.stdout.splitlines() if l.strip()]
    if len(lines) < 2: return []
    h = lines[0].split("\t")
    return [{a:(None if b=="NULL" else b) for a,b in zip(h,l.split("\t"))} for l in lines[1:]]

emails = [
    "sami.benyoussef@exemple.com",
    "yassine.bensalem@example.com",  # requested yassine.benyoussef@exemple.com not found
    "ahmed.bourguiba@exemple.com",
    "nour.bensalem@exemple.com",
]
email_sql = ",".join("'"+e+"'" for e in emails)

cand_rows = mq(f"""
SELECT u.id AS user_id, u.email, u.first_name, u.last_name, c.id AS cv_id, c.object_key, c.file_name
FROM user_db.users u
INNER JOIN user_db.cvs c ON c.user_id=u.id
WHERE u.email IN ({email_sql})
AND c.id = (SELECT MAX(c2.id) FROM user_db.cvs c2 WHERE c2.user_id=u.id)
ORDER BY FIELD(u.email, {email_sql})
""")

offers_meta = mq("""
SELECT id, title, experience_years, education_level, description
FROM offre_db.offres WHERE id IN (13,14,15,16,17) ORDER BY id
""")
skills = mq("""
SELECT offre_id, name, HEX(required) AS req_hex
FROM offre_db.offre_skills WHERE offre_id IN (13,14,15,16,17) ORDER BY offre_id, name
""")
by={}
for s in skills:
    by.setdefault(int(s["offre_id"]), []).append(s)

offers=[]
for o in offers_meta:
    oid=int(o["id"])
    sk=by.get(oid,[])
    names=[x["name"] for x in sk]
    req=[x["name"] for x in sk if (x.get("req_hex") or "").upper() in {"01","1"}]
    if not req: req=list(names)
    edu,_=parse_education_value(o["education_level"])
    offers.append({
        "id":oid,"title":o["title"],
        "experience_years_offer": float(o["experience_years"]) if o["experience_years"] is not None else None,
        "education_raw": o["education_level"],
        "education_norm": edu,
        "skills": names,
        "requiredSkills": req,
        "profile": {
            "skills": names, "requiredSkills": req,
            "experienceYears": float(o["experience_years"]) if o["experience_years"] is not None else None,
            "education": edu, "title": o["title"],
            "summary": (o["description"] or "")[:400],
        }
    })

candidates=[]
for row in cand_rows:
    pdf = CV_DIR / Path(row["object_key"]).name
    with pymupdf.open(pdf) as doc:
        text=" ".join(page.get_text() for page in doc)
    ex=extract_rules(text[:200000])
    title_guess = None
    fn=(row["file_name"] or "").lower()
    if "data" in fn: title_guess="Data Analyst"
    elif "cyber" in fn: title_guess="Cybersecurity Analyst"
    elif "software" in fn: title_guess="Software Engineer"
    candidates.append({
        "user_id": int(row["user_id"]),
        "email": row["email"],
        "full_name": f"{row.get('first_name') or ''} {row.get('last_name') or ''}".strip(),
        "cv_title": title_guess or (ex.get("specialty") or "—"),
        "file_name": row["file_name"],
        "experience_years": ex.get("experienceYears"),
        "education": ex.get("education"),
        "educationStatus": ex.get("educationStatus"),
        "skills": ex.get("skills") or [],
        "profile": {
            "skills": ex.get("skills") or [],
            "experienceYears": ex.get("experienceYears"),
            "education": ex.get("education"),
            "educationStatus": ex.get("educationStatus"),
            "specialty": ex.get("specialty"),
            "title": title_guess or ex.get("specialty"),
            "summary": text[:400],
        }
    })

rows=[]
for c in candidates:
    cs = set(normalize_skills(c["skills"]))
    for o in offers:
        m = hybrid(c["profile"], o["profile"], cvId=str(c["user_id"]))
        f = m.get("features") or {}
        offer_skills_norm = normalize_skills(o["skills"])
        req_norm = normalize_skills(o["requiredSkills"])
        matched = set(normalize_skills(f.get("matchedSkills") or []))
        missing_offer = sorted(set(offer_skills_norm) - cs)
        missing_required = sorted(set(req_norm) - cs)
        rows.append({
            "email": c["email"],
            "candidat": c["full_name"],
            "titre_candidat": c["cv_title"],
            "user_id": c["user_id"],
            "offre_id": o["id"],
            "titre_offre": o["title"],
            "score": m.get("score"),
            "scoreBand": m.get("scoreBand"),
            "exp_offre": o["experience_years_offer"],
            "exp_candidat": c["experience_years"],
            "formation_offre_raw": o["education_raw"],
            "formation_offre": o["education_norm"],
            "formation_candidat": c["education"],
            "formation_status_candidat": c["educationStatus"],
            "education_match": f.get("education_match"),
            "experience_match": f.get("experience_match"),
            "skills_coverage": f.get("skills_coverage"),
            "competences_offre": o["skills"],
            "competences_candidat": c["skills"],
            "competences_communes": sorted(matched),
            "competences_manquantes": missing_offer,
            "competences_requises_manquantes": missing_required,
            "critical_skills_missing": f.get("critical_skills_missing"),
        })

# Markdown table (compact main view)
lines = []
lines.append("# Analyse matching — 4 candidats × offres 13–17")
lines.append("")
lines.append("**Moteur :** hybrid-v3 · extract rules · tfidf · v1.3.1")
lines.append("")
lines.append("> Note : l’email `yassine.benyoussef@exemple.com` est **absent** en BDD. Profil utilisé : `yassine.bensalem@example.com` (id 99911).")
lines.append("")
lines.append("## Tableau principal")
lines.append("")
lines.append("| Candidat | Titre CV | Offre | Titre offre | Score | Band | Exp offre | Exp candidat | Formation offre | Formation candidat | Compétences manquantes (vs offre) |")
lines.append("|----------|----------|-------|-------------|-------|------|-----------|--------------|-----------------|--------------------|-----------------------------------|")
for r in rows:
    miss = ", ".join(r["competences_manquantes"][:8])
    if len(r["competences_manquantes"]) > 8:
        miss += f" (+{len(r['competences_manquantes'])-8})"
    lines.append(
        f"| {r['candidat']} | {r['titre_candidat']} | {r['offre_id']} | {r['titre_offre']} | "
        f"{r['score'] if r['score'] is not None else '—'} | {r['scoreBand']} | "
        f"{r['exp_offre']} | {r['exp_candidat']} | {r['formation_offre_raw']} ({r['formation_offre']}) | "
        f"{r['formation_candidat']} | {miss or '—'} |"
    )

lines.append("")
lines.append("## Détail compétences requises manquantes")
lines.append("")
lines.append("| Candidat | Offre | Requises manquantes | Communes |")
lines.append("|----------|-------|---------------------|----------|")
for r in rows:
    miss_r = ", ".join(r["competences_requises_manquantes"]) or "—"
    common = ", ".join(r["competences_communes"][:10]) or "—"
    lines.append(f"| {r['candidat']} | {r['offre_id']} {r['titre_offre']} | {miss_r} | {common} |")

report = {
    "note_email": "yassine.benyoussef@exemple.com introuvable → yassine.bensalem@example.com",
    "candidates": candidates,
    "offers": [{k:o[k] for k in ("id","title","experience_years_offer","education_raw","education_norm","skills","requiredSkills")} for o in offers],
    "rows": rows,
}
OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
MD.write_text("\n".join(lines), encoding="utf-8")
print(json.dumps({
    "wrote_json": str(OUT),
    "wrote_md": str(MD),
    "n_rows": len(rows),
    "candidates": [{"email":c["email"],"name":c["full_name"],"title":c["cv_title"],"exp":c["experience_years"],"edu":c["education"]} for c in candidates],
    "preview": [{
        "candidat": r["candidat"], "offre": r["offre_id"], "titre_offre": r["titre_offre"],
        "score": r["score"], "band": r["scoreBand"],
        "exp_o": r["exp_offre"], "exp_c": r["exp_candidat"],
        "edu_o": r["formation_offre"], "edu_c": r["formation_candidat"],
        "missing": r["competences_manquantes"],
    } for r in rows]
}, ensure_ascii=False, indent=2))
