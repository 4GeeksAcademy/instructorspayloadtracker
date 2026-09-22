from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    App configuration, read from environment variables.
    On Railway, DATABASE_URL is injected automatically when a Postgres
    plugin is attached to this service.
    """
    database_url: str = "postgresql://postgres:postgres@localhost:5432/instructor_payroll"
    secret_key: str = "change-me-in-railway-variables"
    access_token_expire_minutes: int = 60 * 24  # 24h session, matches internal-tool usage
    algorithm: str = "HS256"

    # Kept as a raw string, not list[str] -- pydantic-settings parses a
    # list-typed field's env var as JSON, which breaks a plain comma-
    # separated value like "http://a,http://b". Splitting it ourselves via
    # the cors_origins_list property avoids that entirely.
    cors_origins: str = "*"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
