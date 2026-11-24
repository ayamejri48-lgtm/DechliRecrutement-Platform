import json, os, subprocess, sys
from pathlib import Path
ROOT = Path(r"C:\Users\ayame\Downloads\dechli-ai-service-complet\dechli-ai-service")
sys.path.insert(0, str(ROOT))
os.environ["AI_SEMANTIC_BACKEND"] = "tfidf"
os.environ["AI_EXTRACT_BACKEND"] = "rules"
import pymupdf
from app.matching import hybrid, rank_candidates
from app.nlp import extract as extract_rules, parse_education_value

MYSQL = r"C:\xampp\mysql\bin\mysql.exe"
CV_DIR = ROOT / "data" / "tmp_qa_cvs"
OUT = ROOT / "data" / "processed" / "qa_latest_4x4_report.json"

def mq(sql):
    p = subprocess.run([MYSQL, "-uroot", "-B", "-e", sql], capture_output=True, text=True, check=True)
    lines = [l for l in p.stdout.splitlines() if l.strip()]
    if len(lines) < 2: return []
    h = lines[0].split("\t")
    return [{a:(None if b=="NULL" else b) for a,b in zip(h,l.split("\t"))} for l in lines[1:]]

offers_meta = mq("""SELECT id, title, status, experience_years, education_level, description FROM offre_db.offres ORDER BY id DESC LIMIT 4""")
oids = [int(r["id"]) for r in offers_meta]
skills = mq(f"SELECT offre_id, name, HEX(required) AS req_hex FROM offre_db.offre_skills WHERE offre_id IN ({','.join(map(str,oids))}) ORDER BY offre_id, name")
by = {}
for s in skills:
    by.setdefault(int(s["offre_id"]), []).append(s)

offers=[]
for o in offers_meta:
    oid=int(o["id"])
    sk=by.get(oid,[])
    names=[x["name"] for x in sk]
    # required bit: HEX 01 => required
    req=[x["name"] for x in sk if (x.get("req_hex") or "").upper() in {"01","1"}]
    if not req: req=list(names)
    edu,_=parse_education_value(o["education_level"])
    offers.append({
        "id":oid,"title":o["title"],"status":o["status"],
        "profile":{
            "skills":names,"requiredSkills":req,
            "experienceYears": float(o["experience_years"]) if o["experience_years"] is not None else None,
            "education":edu,"educationRaw":o["education_level"],
            "title":o["title"],"summary":(o["description"] or "")[:500],
        },
        "n_skills":len(names),
    })

# Map user -> downloaded pdf by known object keys / order from DB
cand_rows = mq("""
SELECT u.id AS user_id, u.email, u.first_name, u.last_name, c.id AS cv_id, c.object_key, c.file_name
FROM user_db.users u INNER JOIN user_db.cvs c ON c.user_id=u.id
WHERE u.role='CANDIDATE' ORDER BY c.id DESC LIMIT 4
""")

candidates=[]
for row in cand_rows:
    fname = Path(row["object_key"]).name
    pdf = CV_DIR / fname
    assert pdf.exists(), pdf
    with pymupdf.open(pdf) as doc:
        text=" ".join(page.get_text() for page in doc)
    ex=extract_rules(text[:200000])
    candidates.append({
        "user_id":int(row["user_id"]),"email":row["email"],
        "name":f"{row.get('first_name') or ''} {row.get('last_name') or ''}".strip(),
        "cv_id":int(row["cv_id"]),"file_name":row["file_name"],"object_key":row["object_key"],
        "text_chars":len(text),
        "profile":{
            "skills":ex.get("skills") or [],
            "experienceYears":ex.get("experienceYears"),
            "education":ex.get("education"),
            "educationStatus":ex.get("educationStatus"),
            "specialty":ex.get("specialty"),
            "title":ex.get("specialty"),
            "summary":text[:400],
        },
        "method":ex.get("method"),
    })

matrix=[]
for c in candidates:
    for o in offers:
        m=hybrid(c["profile"], o["profile"], cvId=str(c["cv_id"]))
        f=m.get("features") or {}
        matrix.append({
            "user_id":c["user_id"],"cv_file":c["file_name"],
            "offer_id":o["id"],"offer_title":o["title"],
            "score":m.get("score"),"scoreBand":m.get("scoreBand"),
            "skills_coverage":f.get("skills_coverage"),
            "required_skills_coverage":f.get("required_skills_coverage"),
            "semantic_similarity":f.get("semantic_similarity"),
            "experience_match":f.get("experience_match"),
            "education_match":f.get("education_match"),
            "matchedSkills":f.get("matchedSkills"),
            "critical_skills_missing":f.get("critical_skills_missing"),
        })

rankings=[]
for o in offers:
    ranked=rank_candidates(o["profile"], [{**c["profile"], "candidatureId":str(c["user_id"]), "cvId":str(c["cv_id"])} for c in candidates])
    rankings.append({
        "offer_id":o["id"],"offer_title":o["title"],
        "results":[{"rank":it.get("rank"),"score":it.get("score"),"scoreBand":it.get("scoreBand"),
                    "candidatureId":it.get("candidatureId"),"cvId":it.get("cvId")} for it in ranked.get("results") or []]
    })

# Domain expectation from filenames
expected={}
for c in candidates:
    fn=(c["file_name"] or "").lower()
    if "data" in fn: expected[c["user_id"]]={"best":[17],"label":"Data Analyst"}
    elif "cyber" in fn: expected[c["user_id"]]={"best":[15],"label":"Cybersecurity"}
    elif "software" in fn: expected[c["user_id"]]={"best":[14,16],"label":"Software Engineer"}
    else: expected[c["user_id"]]={"best":[],"label":"unknown"}

sanity=[]
for c in candidates:
    rows=[r for r in matrix if r["user_id"]==c["user_id"] and r["score"] is not None]
    best=max(rows, key=lambda r:r["score"]) if rows else None
    exp=expected.get(c["user_id"],{})
    sanity.append({
        "user_id":c["user_id"],"label":exp.get("label"),
        "n_skills_extracted":len(c["profile"]["skills"]),
        "skills":c["profile"]["skills"],
        "experienceYears":c["profile"]["experienceYears"],
        "education":c["profile"]["education"],
        "best_offer": None if not best else best["offer_id"],
        "best_title": None if not best else best["offer_title"],
        "best_score": None if not best else best["score"],
        "expected_offers":exp.get("best"),
        "top1_ok": bool(best and best["offer_id"] in (exp.get("best") or [])),
        "scores_by_offer":{str(r["offer_id"]):r["score"] for r in rows},
    })

report={
  "service_version":"1.3.1","method":"hybrid-baseline-v3","extract":"rules","semantic":"tfidf",
  "n_pairs":len(matrix),
  "offers":[{"id":o["id"],"title":o["title"],"n_skills":o["n_skills"],"skills":o["profile"]["skills"],
             "experienceYears":o["profile"]["experienceYears"],"education":o["profile"]["education"]} for o in offers],
  "candidates":[{"user_id":c["user_id"],"email":c["email"],"file_name":c["file_name"],"text_chars":c["text_chars"],
                 "skills":c["profile"]["skills"],"experienceYears":c["profile"]["experienceYears"],
                 "education":c["profile"]["education"],"specialty":c["profile"]["specialty"]} for c in candidates],
  "matrix":matrix,"rankings":rankings,"domain_sanity":sanity,
  "score_summary":{
    "n_scored":sum(1 for r in matrix if r["score"] is not None),
    "n_unavailable":sum(1 for r in matrix if r["score"] is None),
    "mean_scored":round(sum(r["score"] for r in matrix if r["score"] is not None)/max(1,sum(1 for r in matrix if r["score"] is not None)),4),
    "high":sum(1 for r in matrix if r["scoreBand"]=="high"),
    "medium":sum(1 for r in matrix if r["scoreBand"]=="medium"),
    "low":sum(1 for r in matrix if r["scoreBand"]=="low"),
  }
}
OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"wrote":str(OUT),"summary":report["score_summary"],"sanity":sanity,"offers":report["offers"],"candidates_short":[{k:c[k] for k in ("user_id","file_name","skills","experienceYears","education")} for c in report["candidates"]]}, ensure_ascii=False, indent=2))
