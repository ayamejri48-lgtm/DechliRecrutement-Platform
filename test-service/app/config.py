"""Runtime settings (env / .env)."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "test-service"
    app_version: str = "0.7.0"
    app_port: int = 8005
    log_level: str = "INFO"

    jwt_secret: str = (
        "1234567890123456789012345678901234567890123456789012345678901234"
    )
    jwt_algorithm: str = "HS256"

    database_url: str = "mysql+pymysql://root:@127.0.0.1:3306/test_db"

    offre_service_url: str = "http://127.0.0.1:8084"
    user_service_url: str = "http://127.0.0.1:8082"
    notification_service_url: str = "http://127.0.0.1:8085"
    notification_database_url: str = ""  # optional override; else derive from DATABASE_URL
    auth_service_url: str = "http://127.0.0.1:8081"

    test_internal_api_key: str = ""

    # SMTP (same mailbox as Auth-Service password reset) — optional
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True
    frontend_tests_url: str = "http://localhost:4200/candidate/tests"

    llm_provider: str = "groq"
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-20b"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
