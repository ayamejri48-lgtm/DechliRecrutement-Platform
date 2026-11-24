# Test-Service (DechliRecrutement)

Génération, attribution et correction intelligente des **tests techniques IT**.

- **Stack :** Python · FastAPI · MySQL (`test_db`) · JWT Auth-Service · LLM Groq (Phase 1+)
- **Port local :** `8005`
- **Phase 0 :** squelette (health, auth, schéma BDD, modèles)

Matching-Service IA reste un service séparé (port `8000`) — ne pas le fusionner ici.

## Démarrage rapide

```powershell
cd "C:\Users\ayame\Desktop\pfe declitech\test-service"
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
Copy-Item .env.example .env
.\scripts\init_db.ps1
.\scripts\start_demo.ps1
```

- Health : http://127.0.0.1:8005/health  
- Docs : http://127.0.0.1:8005/docs  

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```
