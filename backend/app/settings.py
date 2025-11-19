"""Feature flags and configuration."""
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    """Application settings with feature flags (all default False for backward compatibility)."""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    
    # Feature flags - all default to False for backward compatibility
    FEATURE_TIMELINE_SLA: bool = False
    FEATURE_WS_SNAPSHOT: bool = False
    FEATURE_ALERT_STORM: bool = False
    FEATURE_TIME_DILATION: bool = False
    # Auth and room codes enabled by default
    FEATURE_AUTH_GM: bool = True
    FEATURE_JOIN_CODES: bool = True
    FEATURE_ADV_SCENARIOS: bool = False
    
    # Database (optional - only used if FEATURE_TIMELINE_SLA is True)
    SQLMODEL_DATABASE_URL: str = "sqlite:///./data/game.db"
    
    # WebSocket settings
    WS_COALESCE_MS: int = 150  # Event coalescence window (only if snapshot enabled)
    
    # Auth settings (only used if FEATURE_AUTH_GM is True)
    # Default admin credentials: username="admin", password="admin"
    # Change these in production via environment variables!
    GM_ADMIN_USER: str = "admin"
    GM_ADMIN_PASSWORD_HASH: Optional[str] = None  # Set via env or generated
    GM_ADMIN_PASSWORD: str = "admin"  # Default password (only used if hash not set)
    JWT_SECRET: str = "change-me-in-production"  # Should be set via env
    JWT_EXPIRES_MIN: int = 60  # Token expiration in minutes
    JWT_ALGORITHM: str = "HS256"


# Global settings instance
settings = Settings()

