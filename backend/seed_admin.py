import os
import sys

from sqlalchemy import select

from .main import Account, SessionLocal, _password_hash


def main() -> int:
    email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    password = os.getenv("ADMIN_PASSWORD", "")
    name = os.getenv("ADMIN_NAME", "").strip()
    phone = os.getenv("ADMIN_PHONE", "").strip()
    if not email or not password or not name or not phone:
        print("Set ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, and ADMIN_PHONE first.", file=sys.stderr)
        return 2
    if len(password) < 10 or len(password) > 128:
        print("ADMIN_PASSWORD must be between 10 and 128 characters.", file=sys.stderr)
        return 2
    with SessionLocal.begin() as db:
        account = db.scalar(select(Account).where(Account.email == email))
        if account:
            if account.type != "admin":
                print("That email already belongs to a non-admin account.", file=sys.stderr)
                return 1
            account.password_hash = _password_hash(password)
            account.name = name
            account.phone = phone
            account.status = "active"
            print("Admin account credentials updated.")
        else:
            db.add(Account(
                id="admin-" + os.urandom(16).hex(),
                name=name,
                email=email,
                phone=phone,
                type="admin",
                password_hash=_password_hash(password),
                status="active",
            ))
            print("Admin account created.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
