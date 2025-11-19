"""Authentication utilities (only used if FEATURE_AUTH_GM is True)."""
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.settings import settings

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password."""
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.JWT_EXPIRES_MIN)
    
    to_encode.update({"exp": int(expire.timestamp())})
    encoded_jwt = jwt.encode(
        to_encode,
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM
    )
    return encoded_jwt


def decode_access_token(token: str) -> Optional[dict]:
    """Decode and verify a JWT access token."""
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except JWTError:
        return None


def verify_gm_credentials(username: str, password: str) -> bool:
    """Verify GM credentials against settings."""
    if username != settings.GM_ADMIN_USER:
        return False
    
    # If password hash is set in env, verify against it
    if settings.GM_ADMIN_PASSWORD_HASH:
        return verify_password(password, settings.GM_ADMIN_PASSWORD_HASH)
    
    # Otherwise, use default password from settings (for development only)
    # In production, GM_ADMIN_PASSWORD_HASH should always be set
    default_password = getattr(settings, 'GM_ADMIN_PASSWORD', 'admin')
    if password == default_password:
        return True
    
    return False


