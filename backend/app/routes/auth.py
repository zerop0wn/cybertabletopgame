"""Authentication routes (only used if FEATURE_AUTH_GM is True)."""
from fastapi import APIRouter, HTTPException, Depends, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
from app.models import LoginRequest, TokenResponse, AuthToken
from app.settings import settings
from app.services.auth import (
    verify_gm_credentials,
    create_access_token,
    decode_access_token,
)
from datetime import timedelta
import time

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer()

# Simple rate limiting (in-memory, per IP)
_rate_limit_store: dict[str, list[float]] = {}
RATE_LIMIT_WINDOW = 60  # 1 minute
RATE_LIMIT_MAX_REQUESTS = 10  # Increased from 5 to 10 for better development experience


def check_rate_limit(ip: str) -> bool:
    """Check if IP is within rate limit."""
    now = time.time()
    if ip not in _rate_limit_store:
        _rate_limit_store[ip] = []
    
    # Remove old requests outside window
    _rate_limit_store[ip] = [
        req_time for req_time in _rate_limit_store[ip]
        if now - req_time < RATE_LIMIT_WINDOW
    ]
    
    # Check if limit exceeded
    if len(_rate_limit_store[ip]) >= RATE_LIMIT_MAX_REQUESTS:
        return False
    
    # Add current request
    _rate_limit_store[ip].append(now)
    return True


def get_client_ip(request: Request) -> str:
    """Extract client IP from request."""
    # Check for forwarded IP (proxy/load balancer)
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    
    # Check for real IP header
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip
    
    # Fallback to direct connection
    if request.client:
        return request.client.host
    
    return "127.0.0.1"


@router.post("/gm/login", response_model=TokenResponse)
async def gm_login(
    request: LoginRequest,
    http_request: Request
):
    """
    GM login endpoint (only available if FEATURE_AUTH_GM is True).
    
    Returns JWT token with role="GM" claim.
    """
    try:
        if not settings.FEATURE_AUTH_GM:
            raise HTTPException(
                status_code=status.HTTP_501_NOT_IMPLEMENTED,
                detail="GM authentication is not enabled"
            )
        
        # Get client IP
        client_ip = get_client_ip(http_request)
        print(f"[AUTH] Login attempt from IP {client_ip}, username: {request.username}")
        
        # Rate limiting
        if not check_rate_limit(client_ip):
            print(f"[AUTH] Rate limit exceeded for IP {client_ip}")
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Please try again later."
            )
        
        # Verify credentials
        print(f"[AUTH] Verifying credentials for username: {request.username}")
        try:
            credentials_valid = verify_gm_credentials(request.username, request.password)
            print(f"[AUTH] Credentials valid: {credentials_valid}")
        except Exception as e:
            print(f"[AUTH] Error verifying credentials: {e}")
            import traceback
            traceback.print_exc()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Error verifying credentials: {str(e)}"
            )
        
        if not credentials_valid:
            print(f"[AUTH] Invalid credentials for username: {request.username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password"
            )
        
        # Create token
        print(f"[AUTH] Creating token for username: {request.username}")
        try:
            expires_delta = timedelta(minutes=settings.JWT_EXPIRES_MIN)
            token_data = {
                "sub": request.username,
                "role": "GM",
                "session_id": None,  # GM doesn't need session_id
            }
            access_token = create_access_token(token_data, expires_delta)
            exp_timestamp = int((time.time() + expires_delta.total_seconds()))
            print(f"[AUTH] Token created successfully")
        except Exception as e:
            print(f"[AUTH] Error creating token: {e}")
            import traceback
            traceback.print_exc()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Error creating token: {str(e)}"
            )
        
        return TokenResponse(
            access_token=access_token,
            token_type="bearer",
            exp=exp_timestamp
        )
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Catch any other exceptions and return 500 with detailed error
        print(f"[AUTH] Unexpected error in gm_login: {e}")
        import traceback
        error_trace = traceback.format_exc()
        print(f"[AUTH] Full traceback:\n{error_trace}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}. Check server logs for details."
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> AuthToken:
    """
    Dependency to get current user from JWT token.
    
    Only used if FEATURE_AUTH_GM or FEATURE_JOIN_CODES is True.
    """
    token = credentials.credentials
    payload = decode_access_token(token)
    
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return AuthToken(
        sub=payload.get("sub"),
        role=payload.get("role"),
        session_id=payload.get("session_id"),
        exp=payload.get("exp")
    )


def require_role(required_role: str):
    """
    Dependency factory to require a specific role.
    
    Usage:
        @router.get("/endpoint")
        async def endpoint(user: AuthToken = Depends(require_role("GM"))):
            ...
    """
    def role_checker(user: AuthToken = Depends(get_current_user)) -> AuthToken:
        if user.role != required_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role: {required_role}"
            )
        return user
    
    return role_checker

