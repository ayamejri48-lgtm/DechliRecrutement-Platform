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
    p = subprocess.run(
        [MYSQL, "-uroot", "--default-character-set=utf8mb4", "-B", "-e", sql],
        capture_output=True, text=True, check=True, encoding="utf-8", errors="replace",
    )
    lines = [l for l in p.stdout.splitlines() if l.strip()]
    if len(lines) < 2: return []
    h = lines[0].split("\t")
    return [{a:(None if b=="NULL" else b) for a,b in zip(h,l.split("\t"))} for l in lines[1:]]

emails = [
    "sami.benyoussef@exemple.com",
    "yassine.bensalem@example.com",
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
offers_meta = mq("SELECT id, title, experience_years, education_level, description FROM offre_db.offres WHERE id IN (13,14,15,16,17) ORDER BY id")
skills = mq("SELECT offre_id, name, HEX(required) AS req_hex FROM offre_db.offre_skills WHERE offre_id IN (13,14,15,16,17) ORDER BY offre_id, name")
by={}
for s in skills:
    by.setdefault(int(s["offre_id"]), []).append(s)

offers=[]
for o in offers_meta:
    oid=int(o["id"]); sk=by.get(oid,[])
    names=[x["name"] for x in sk]
    req=[x["name"] for x in sk if (x.get("req_hex") or "").upper() in {"01","1"}] or list(names)
    edu,_=parse_education_value(o["education_level"])
    offers.append({
        "id":oid,"title":o["title"],
        "experience_years_offer": float(o["experience_years"]) if o["experience_years"] is not None else None,
        "education_raw": o["education_level"], "education_norm": edu,
        "skills": names, "requiredSkills": req,
        "profile": {"skills":names,"requiredSkills":req,
                    "experienceYears": float(o["experience_years"]) if o["experience_years"] is not None else None,
                    "education":edu,"title":o["title"],"summary":(o["description"] or "")[:400]}
    })

candidates=[]
for row in cand_rows:
    pdf = CV_DIR / Path(row["object_key"]).name
    with pymupdf.open(pdf) as doc:
        text=" ".join(page.get_text() for page in doc)
    ex=extract_rules(text[:200000])
    fn=(row["file_name"] or "").lower()
    title_guess = "Data Analyst" if "data" in fn else "Cybersecurity Analyst" if "cyber" in fn else "Software Engineer" if "software" in fn else (ex.get("specialty") or "—")
    candidates.append({
        "user_id": int(row["user_id"]), "email": row["email"],
        "full_name": f"{row.get('first_name') or ''} {row.get('last_name') or ''}".strip(),
        "cv_title": title_guess, "file_name": row["file_name"],
        "experience_years": ex.get("experienceYears"), "education": ex.get("education"),
        "educationStatus": ex.get("educationStatus"), "skills": ex.get("skills") or [],
        "profile": {"skills": ex.get("skills") or [], "experienceYears": ex.get("experienceYears"),
                    "education": ex.get("education"), "educationStatus": ex.get("educationStatus"),
                    "specialty": ex.get("specialty"), "title": title_guess, "summary": text[:400]}
    })

rows=[]
for c in candidates:
    cs=set(normalize_skills(c["skills"]))
    for o in offers:
        m=hybrid(c["profile"], o["profile"], cvId=str(c["user_id"]))
        f=m.get("features") or {}
        offer_n=normalize_skills(o["skills"]); req_n=normalize_skills(o["requiredSkills"])
        matched=set(normalize_skills(f.get("matchedSkills") or []))
        missing=sorted(set(offer_n)-cs); missing_req=sorted(set(req_n)-cs)
        rows.append({
            "email":c["email"],"candidat":c["full_name"],"titre_candidat":c["cv_title"],"user_id":c["user_id"],
            "offre_id":o["id"],"titre_offre":o["title"],"score":m.get("score"),"scoreBand":m.get("scoreBand"),
            "exp_offre":o["experience_years_offer"],"exp_candidat":c["experience_years"],
            "formation_offre_raw":o["education_raw"],"formation_offre":o["education_norm"],
            "formation_candidat":c["education"],"formation_status_candidat":c["educationStatus"],
            "education_match":f.get("education_match"),"experience_match":f.get("experience_match"),
            "skills_coverage":f.get("skills_coverage"),
            "competences_offre":o["skills"],"competences_candidat":c["skills"],
            "competences_communes":sorted(matched),
            "competences_manquantes":missing,"competences_requises_manquantes":missing_req,
            "critical_skills_missing":f.get("critical_skills_missing"),
        })

def esc(s):
    return (s or "").replace("|","/")

md=[]
md.append("# Analyse matching — 4 candidats × offres 13–17\n")
md.append("**Moteur :** hybrid-v3 · rules · tfidf · v1.3.1\n")
md.append("> Email demandé `yassine.benyoussef@exemple.com` **introuvable** → utilisé `yassine.bensalem@example.com`.\n")
md.append("## Tableau d'analyse\n")
md.append("| Candidat (email) | Titre candidat | Offre | Titre offre | Score | Band | Exp. offre (ans) | Exp. candidat (ans) | Formation offre | Formation candidat | Compétences manquantes |")
md.append("|------------------|----------------|-------|-------------|-------|------|------------------|---------------------|-----------------|--------------------|------------------------|")
for r in rows:
    miss = ", ".join(r["competences_manquantes"]) if r["competences_manquantes"] else "aucune"
    md.append(
        f"| {esc(r['candidat'])} (`{r['email']}`) | {esc(r['titre_candidat'])} | {r['offre_id']} | {esc(r['titre_offre'])} | "
        f"**{r['score']}** | {r['scoreBand']} | {r['exp_offre']} | {r['exp_candidat']} | "
        f"{esc(r['formation_offre_raw'])} → `{r['formation_offre']}` | `{r['formation_candidat']}` | {esc(miss)} |"
    )

OUT.write_text(json.dumps({"note_email":"yassine.benyoussef@exemple.com introuvable → yassine.bensalem@example.com","rows":rows,"offers":offers,"candidates":[{k:c[k] for k in ('user_id','email','full_name','cv_title','experience_years','education','skills')} for c in candidates]}, ensure_ascii=False, indent=2), encoding="utf-8")
MD.write_text("\n".join(md), encoding="utf-8")
# print clean table for chat
print("EMAIL_NOTE: yassine.benyoussef@exemple.com ABSENT -> yassine.bensalem@example.com")
print("---")
for r in rows:
    print(f"{r['candidat'][:20]:20} | {r['offre_id']:2} {r['titre_offre'][:28]:28} | {r['score']:.4f} {r['scoreBand']:6} | exp {r['exp_candidat']}/{r['exp_offre']} | edu {r['formation_candidat']}/{r['formation_offre']} | miss={','.join(r['competences_manquantes']) or '-'}")
