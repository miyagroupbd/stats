"""Auth router — login + current user."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.deps import get_current_user, get_db
from backend.app.schemas.auth import LoginRequest, TokenResponse, UserOut
from backend.app.security import create_access_token
from db.models import User
from db.passwords import verify_password
from db.repos import users as users_repo

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = users_repo.get_by_email(db, payload.email)
    if user is None or not user.is_active or not verify_password(user.password_hash, payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    users_repo.touch_login(db, user)
    db.commit()
    token = create_access_token(user_id=user.id, email=user.email, role=user.role.value)
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
