import hashlib
import hmac
import os
import re
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_ROOT = PROJECT_ROOT / "frontend"
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://markethub:markethub@127.0.0.1:5432/markethub",
)
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    phone: Mapped[str] = mapped_column(String(30))
    type: Mapped[str] = mapped_column(String(10))
    password_hash: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=True)
    referred_by: Mapped[str | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    avatar: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(10), default="active")


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class Category(Base):
    __tablename__ = "categories"

    name: Mapped[str] = mapped_column(String(40), primary_key=True)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(ForeignKey("categories.name", onupdate="CASCADE"))
    price: Mapped[int] = mapped_column(Integer)
    stock: Mapped[int] = mapped_column(Integer)
    seller_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    image: Mapped[str] = mapped_column(Text, default="product-placeholder.svg")
    tag: Mapped[str] = mapped_column(String(40), default="New")


class CartLine(Base):
    __tablename__ = "cart_lines"

    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)
    product_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    buyer_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    seller_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    buyer: Mapped[str] = mapped_column(String(100))
    buyer_email: Mapped[str] = mapped_column(String(254))
    buyer_phone: Mapped[str] = mapped_column(String(30))
    pickup_area: Mapped[str] = mapped_column(String(160))
    total: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    ordered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payment_method: Mapped[str] = mapped_column(String(30))


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(120))
    price: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer)


class Installment(Base):
    __tablename__ = "installments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(40))
    amount: Mapped[int] = mapped_column(Integer)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    paid: Mapped[bool] = mapped_column(Boolean, default=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    method: Mapped[str | None] = mapped_column(String(40), nullable=True)


class LiveSession(Base):
    __tablename__ = "live_sessions"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    seller_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    platform: Mapped[str] = mapped_column(String(40))
    product_ids: Mapped[str] = mapped_column(Text, default="[]")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


def _session():
    with SessionLocal() as db:
        yield db


def _password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"{salt.hex()}:{digest.hex()}"


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt_hex, digest_hex = stored_hash.split(":", 1)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 310_000)
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def _token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _account_data(account: Account) -> dict[str, Any]:
    return {
        "id": account.id,
        "name": account.name,
        "email": account.email,
        "phone": account.phone,
        "type": account.type,
        "code": account.code or "",
        "referredBy": account.referred_by or "",
        "avatar": account.avatar,
        "status": account.status,
    }


def _visible_account_data(account: Account, viewer: Account | None) -> dict[str, Any]:
    if viewer and (viewer.type == "admin" or viewer.id == account.id):
        return _account_data(account)
    if viewer and viewer.type == "seller" and account.type == "buyer" and account.referred_by == viewer.id:
        return _account_data(account)
    return {
        "id": account.id,
        "name": account.name,
        "phone": account.phone,
        "type": account.type,
        "status": account.status,
    }


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _valid_email(value: str) -> bool:
    return len(value) <= 254 and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value) is not None


def _valid_phone(value: str) -> bool:
    digits = re.sub(r"\D", "", value)
    return bool(re.fullmatch(r"[+]?[0-9\s()-]{9,18}", value)) and 9 <= len(digits) <= 15


def _order_data(db: Session, order: Order, seller_view: bool = False) -> dict[str, Any]:
    items = list(db.scalars(select(OrderItem).where(OrderItem.order_id == order.id)))
    if seller_view:
        items = [item for item in items if db.get(Product, item.product_id) and db.get(Product, item.product_id).seller_id == order.seller_id]
    installments = list(db.scalars(select(Installment).where(Installment.order_id == order.id).order_by(Installment.id)))
    return {
        "id": order.id,
        "sellerId": order.seller_id,
        "buyer": order.buyer,
        "buyerId": order.buyer_id,
        "buyerEmail": order.buyer_email,
        "buyerPhone": order.buyer_phone,
        "pickupArea": order.pickup_area,
        "items": [
            {"productId": item.product_id, "name": item.name, "price": item.price, "quantity": item.quantity}
            for item in items
        ],
        "total": sum(item.price * item.quantity for item in items),
        "status": order.status.title(),
        "date": "Just now" if not order.ordered_at else order.ordered_at.strftime("%b %d, %Y"),
        "orderedAt": _iso(order.ordered_at),
        "paymentMethod": order.payment_method,
        "paymentPlan": [
            {
                "label": item.label,
                "amount": item.amount,
                "dueAt": _iso(item.due_at),
                "paid": item.paid,
                **({"paidAt": _iso(item.paid_at), "method": item.method} if item.paid_at else {}),
            }
            for item in installments
        ],
    }


def _market_state(db: Session, account: Account | None) -> dict[str, Any]:
    all_accounts = list(db.scalars(select(Account).order_by(Account.name)))
    if account is None:
        visible_accounts = [item for item in all_accounts if item.type == "seller" and item.status == "active"]
    elif account.type == "admin":
        visible_accounts = all_accounts
    elif account.type == "seller":
        visible_accounts = [
            item for item in all_accounts
            if item.id == account.id or item.type == "seller" or item.referred_by == account.id
        ]
    else:
        visible_accounts = [
            item for item in all_accounts
            if item.id == account.id or (item.type == "seller" and item.status == "active")
        ]

    products = list(db.scalars(select(Product).order_by(Product.id)))
    product_data = []
    for product in products:
        seller = db.get(Account, product.seller_id)
        product_data.append({
            "id": product.id,
            "name": product.name,
            "category": product.category,
            "price": product.price,
            "stock": product.stock,
            "seller": seller.name if seller else "",
            "sellerId": product.seller_id,
            "image": product.image,
            "tag": product.tag,
        })

    if account is None or account.type == "buyer":
        orders = list(db.scalars(
            select(Order).where(Order.buyer_id == (account.id if account else "")).order_by(Order.ordered_at.desc())
        )) if account else []
    elif account.type == "seller":
        orders = list(db.scalars(
            select(Order).where(Order.seller_id == account.id).order_by(Order.ordered_at.desc())
        ))
    else:
        orders = list(db.scalars(select(Order).order_by(Order.ordered_at.desc())))

    live_rows = list(db.scalars(select(LiveSession).order_by(LiveSession.started_at.desc())))
    sessions = []
    import json

    for row in live_rows:
        if not row.active and (not account or row.seller_id != account.id):
            continue
        sessions.append({
            "id": row.id,
            "sellerId": row.seller_id,
            "platform": row.platform,
            "productIds": json.loads(row.product_ids),
            "active": row.active,
            "startedAt": _iso(row.started_at),
            **({"endedAt": _iso(row.ended_at)} if row.ended_at else {}),
        })

    return {
        "accounts": [_visible_account_data(item, account) for item in visible_accounts],
        "products": product_data,
        "orders": [_order_data(db, order, account is not None and account.type == "seller") for order in orders],
        "cart": [
            {"productId": line.product_id, "quantity": line.quantity}
            for line in db.scalars(select(CartLine).where(CartLine.account_id == account.id))
        ] if account else [],
        "categories": list(db.scalars(select(Category.name).order_by(Category.name))),
        "liveSessions": sessions,
        "session": account.id if account else None,
    }


def _string(value: Any, label: str, limit: int, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise HTTPException(422, f"{label} must be text.")
    value = value.strip()
    if (not value and not allow_empty) or len(value) > limit:
        raise HTTPException(422, f"{label} is invalid.")
    return value


def _integer(value: Any, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
        raise HTTPException(422, f"{label} is invalid.")
    return value


def _category_sync(db: Session, mutation: dict[str, Any]) -> None:
    action = mutation.get("action")
    if action == "add":
        name = _string(mutation.get("name"), "Category", 40)
        if db.get(Category, name):
            raise HTTPException(409, "That category name already exists.")
        db.add(Category(name=name))
        return
    if action == "rename":
        old = _string(mutation.get("oldName"), "Category", 40)
        new = _string(mutation.get("name"), "Category", 40)
        if not db.get(Category, old):
            raise HTTPException(404, "That category no longer exists.")
        if db.get(Category, new):
            raise HTTPException(409, "That category name already exists.")
        products = list(db.scalars(select(Product).where(Product.category == old)))
        db.add(Category(name=new))
        db.flush()
        for product in products:
            product.category = new
        db.flush()
        db.delete(db.get(Category, old))
        return
    if action == "delete":
        name = _string(mutation.get("name"), "Category", 40)
        category = db.get(Category, name)
        if not category:
            raise HTTPException(404, "That category no longer exists.")
        if db.scalar(select(Product.id).where(Product.category == name).limit(1)):
            raise HTTPException(409, "A category used by products cannot be deleted.")
        db.delete(category)
        return
    raise HTTPException(422, "Category action is invalid.")


def _sync_state(db: Session, account: Account, body: dict[str, Any]) -> None:
    import json

    if not isinstance(body, dict):
        raise HTTPException(422, "The state payload must be an object.")
    current = _market_state(db, account)
    for key in ("accounts", "products", "orders", "cart", "categories", "liveSessions"):
        if key in body and not isinstance(body[key], list):
            raise HTTPException(422, f"{key} must be a list.")

    payload_accounts = {item.get("id"): item for item in body.get("accounts", []) if isinstance(item, dict)}
    for account_id, item in payload_accounts.items():
        existing = db.get(Account, account_id)
        if not existing:
            continue
        if account_id == account.id:
            name = _string(item.get("name", existing.name), "Name", 100)
            email = _string(item.get("email", existing.email), "Email", 254).lower()
            phone = _string(item.get("phone", existing.phone), "Phone", 30)
            if not _valid_email(email):
                raise HTTPException(422, "Enter a valid email address.")
            if not _valid_phone(phone):
                raise HTTPException(422, "Enter a valid phone number.")
            avatar = item.get("avatar", existing.avatar)
            if not isinstance(avatar, str) or len(avatar) > 12_000_000:
                raise HTTPException(422, "Profile image is too large.")
            if avatar and not re.fullmatch(
                r"data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+", avatar, re.IGNORECASE
            ):
                raise HTTPException(422, "Profile image format is invalid.")
            if email != existing.email and db.scalar(select(Account.id).where(Account.email == email)):
                raise HTTPException(409, "Another account already uses this email.")
            existing.name, existing.email, existing.phone, existing.avatar = name, email, phone, avatar
        elif account.type == "admin":
            status = item.get("status", existing.status)
            if status not in ("active", "blocked"):
                raise HTTPException(422, "Account status is invalid.")
            if existing.id != account.id:
                existing.status = status
        elif account.type == "seller" and existing.type == "buyer" and existing.referred_by == account.id:
            status = item.get("status", existing.status)
            if status not in ("active", "blocked"):
                raise HTTPException(422, "Referral status is invalid.")
            existing.status = status

    deleted_account_ids = body.get("deletedAccountIds", [])
    if not isinstance(deleted_account_ids, list):
        raise HTTPException(422, "Deleted account ids must be a list.")
    for account_id in deleted_account_ids:
        referred_account = db.get(Account, _string(account_id, "Account id", 100))
        if (
            account.type != "seller" or not referred_account
            or referred_account.type != "buyer" or referred_account.referred_by != account.id
        ):
            raise HTTPException(403, "You cannot remove that account.")
        db.execute(Order.__table__.delete().where(Order.buyer_id == referred_account.id))
        db.delete(referred_account)

    category_mutation = body.get("categoryMutation")
    if category_mutation is not None:
        if account.type not in ("seller", "admin"):
            raise HTTPException(403, "Only sellers and admins can manage categories.")
        if not isinstance(category_mutation, dict):
            raise HTTPException(422, "Category mutation is invalid.")
        _category_sync(db, category_mutation)

    incoming_products = body.get("products", [])
    if len(incoming_products) > 500:
        raise HTTPException(422, "Too many products.")
    for item in incoming_products:
        if not isinstance(item, dict):
            raise HTTPException(422, "Product data is invalid.")
        product_id = _string(item.get("id"), "Product id", 100)
        product = db.get(Product, product_id)
        if account.type != "admin" and account.type != "seller":
            if product and product.seller_id == account.id:
                raise HTTPException(403, "Buyers cannot manage products.")
            continue
        if product and product.seller_id != account.id and account.type != "admin":
            continue
        seller_id = account.id if account.type == "seller" else item.get("sellerId")
        if product is None and (account.type != "seller" or item.get("sellerId") != account.id):
            continue
        name = _string(item.get("name"), "Product name", 120)
        category = _string(item.get("category"), "Category", 40)
        if not db.get(Category, category):
            raise HTTPException(422, "Choose an existing category.")
        image = item.get("image", "product-placeholder.svg")
        if not isinstance(image, str) or len(image) > 12_000_000:
            raise HTTPException(422, "Product image is too large.")
        if image != "product-placeholder.svg" and not re.fullmatch(
            r"data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+", image, re.IGNORECASE
        ):
            raise HTTPException(422, "Product image format is invalid.")
        values = {
            "name": name,
            "category": category,
            "price": _integer(item.get("price"), "Price", 1, 2_000_000_000),
            "stock": _integer(item.get("stock"), "Stock", 0, 100_000),
            "seller_id": seller_id,
            "image": image,
            "tag": _string(item.get("tag", "New"), "Product tag", 40),
        }
        if product:
            for field, value in values.items():
                setattr(product, field, value)
        else:
            db.add(Product(id=product_id, **values))

    deleted_product_ids = body.get("deletedProductIds", [])
    if not isinstance(deleted_product_ids, list):
        raise HTTPException(422, "Deleted product ids must be a list.")
    for product_id in deleted_product_ids:
        product = db.get(Product, _string(product_id, "Product id", 100))
        if not product:
            continue
        if account.type != "admin" and (account.type != "seller" or product.seller_id != account.id):
            raise HTTPException(403, "You cannot remove that product.")
        db.execute(CartLine.__table__.delete().where(CartLine.product_id == product.id))
        db.delete(product)

    if "cart" in body:
        if account.type != "buyer":
            if body["cart"]:
                raise HTTPException(403, "Only buyers can update a shopping cart.")
        else:
            cart_lines: dict[str, int] = {}
            for line in body["cart"]:
                if not isinstance(line, dict):
                    raise HTTPException(422, "Cart data is invalid.")
                product_id = _string(line.get("productId"), "Product id", 100)
                quantity = _integer(line.get("quantity"), "Quantity", 1, 100_000)
                product = db.get(Product, product_id)
                if not product or quantity > product.stock:
                    raise HTTPException(409, "A cart item is no longer available in that quantity.")
                cart_lines[product_id] = quantity
            db.execute(CartLine.__table__.delete().where(CartLine.account_id == account.id))
            for product_id, quantity in cart_lines.items():
                db.add(CartLine(account_id=account.id, product_id=product_id, quantity=quantity))

    incoming_orders = body.get("orders", [])
    if len(incoming_orders) > 1000:
        raise HTTPException(422, "Too many orders.")
    for item in incoming_orders:
        if not isinstance(item, dict):
            raise HTTPException(422, "Order data is invalid.")
        order_id = _string(item.get("id"), "Order id", 40)
        order = db.get(Order, order_id)
        if order:
            if account.type == "seller" and order.seller_id == account.id:
                new_status = str(item.get("status", order.status)).lower()
                if new_status not in ("pending", "received", "shipped"):
                    raise HTTPException(422, "Order status is invalid.")
                if new_status != order.status:
                    if order.status != "pending" or new_status != "received":
                        raise HTTPException(409, "This order cannot be moved to that status.")
                    order.status = new_status
            continue
        if account.type != "buyer" or item.get("buyerId") != account.id:
            continue
        items = item.get("items")
        if not isinstance(items, list) or not items:
            raise HTTPException(422, "An order must contain at least one item.")
        verified_items = []
        subtotal = 0
        seller_id = None
        for line in items:
            if not isinstance(line, dict):
                raise HTTPException(422, "Order item data is invalid.")
            product_id = _string(line.get("productId"), "Product id", 100)
            product = db.scalar(select(Product).where(Product.id == product_id).with_for_update())
            quantity = _integer(line.get("quantity"), "Quantity", 1, 100_000)
            if not product or product.stock < quantity:
                raise HTTPException(409, "An ordered product is no longer available.")
            if seller_id is not None and seller_id != product.seller_id:
                raise HTTPException(422, "Orders must be grouped by seller.")
            seller_id = product.seller_id
            product.stock -= quantity
            subtotal += product.price * quantity
            verified_items.append((product, quantity))
        if not seller_id or subtotal != _integer(item.get("total"), "Order total", 1, 2_000_000_000):
            raise HTTPException(409, "The order total changed. Review your cart.")
        buyer_name = _string(item.get("buyer"), "Buyer name", 100)
        buyer_email = _string(item.get("buyerEmail"), "Buyer email", 254).lower()
        buyer_phone = _string(item.get("buyerPhone"), "Buyer phone", 30)
        if not _valid_email(buyer_email) or not _valid_phone(buyer_phone):
            raise HTTPException(422, "Buyer contact information is invalid.")
        pickup_area = _string(item.get("pickupArea"), "Pickup area", 160)
        payment_method = item.get("paymentMethod")
        if payment_method not in ("M-Pesa STK push", "PayPal"):
            raise HTTPException(422, "Payment method is invalid.")
        now = datetime.now(timezone.utc)
        order = Order(
            id=order_id, buyer_id=account.id, seller_id=seller_id,
            buyer=buyer_name, buyer_email=buyer_email, buyer_phone=buyer_phone,
            pickup_area=pickup_area, total=subtotal, status="pending",
            ordered_at=now, payment_method=payment_method,
        )
        db.add(order)
        db.flush()
        for product, quantity in verified_items:
            db.add(OrderItem(
                order_id=order_id, product_id=product.id, name=product.name,
                price=product.price, quantity=quantity,
            ))
        first_amount = (subtotal * 50 + 50) // 100
        second_amount = (subtotal * 30 + 50) // 100
        for label, amount, days in (
            ("First installment", first_amount, 0),
            ("Second installment", second_amount, 3),
            ("Final installment", subtotal - first_amount - second_amount, 6),
        ):
            db.add(Installment(
                order_id=order_id, label=label, amount=amount,
                due_at=now + timedelta(days=days), paid=False,
            ))
        account.phone = buyer_phone

    if "liveSessions" in body:
        incoming_sessions = body["liveSessions"]
        if account.type not in ("seller", "admin"):
            if incoming_sessions != current["liveSessions"]:
                raise HTTPException(403, "Only sellers can manage live sessions.")
        else:
            for item in incoming_sessions:
                if not isinstance(item, dict):
                    raise HTTPException(422, "Live session data is invalid.")
                session_id = _string(item.get("id"), "Session id", 100)
                session = db.get(LiveSession, session_id)
                if session and session.seller_id != account.id and account.type != "admin":
                    continue
                seller_id = account.id if account.type == "seller" else item.get("sellerId")
                if not session and (account.type != "seller" or item.get("sellerId") != account.id):
                    continue
                product_ids = item.get("productIds")
                if not isinstance(product_ids, list) or len(product_ids) > 100:
                    raise HTTPException(422, "Live session products are invalid.")
                if account.type == "seller" and any(
                    not db.scalar(select(Product.id).where(Product.id == product_id, Product.seller_id == account.id))
                    for product_id in product_ids
                ):
                    raise HTTPException(403, "A live session can only include your products.")
                active = item.get("active") is True
                platform = _string(item.get("platform"), "Platform", 40)
                started = datetime.now(timezone.utc)
                if session:
                    session.platform = platform
                    session.product_ids = json.dumps(product_ids)
                    session.active = active
                    if not active and session.ended_at is None:
                        session.ended_at = started
                else:
                    session = LiveSession(
                        id=session_id, seller_id=seller_id, platform=platform,
                        product_ids=json.dumps(product_ids), active=active, started_at=started,
                    )
                    db.add(session)
            deleted_session_ids = body.get("deletedLiveSessionIds", [])
            if not isinstance(deleted_session_ids, list):
                raise HTTPException(422, "Deleted live session ids must be a list.")
            for session_id in deleted_session_ids:
                session = db.get(LiveSession, _string(session_id, "Session id", 100))
                if not session:
                    continue
                if account.type != "admin" and session.seller_id != account.id:
                    raise HTTPException(403, "You cannot remove that live session.")
                db.delete(session)


app = FastAPI(title="MarketHub API", version="1.0.0")
bearer = HTTPBearer(auto_error=False)


def _authenticated_account(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(_session),
) -> Account:
    if not credentials:
        raise HTTPException(401, "Please sign in to continue.")
    session = db.get(AuthSession, _token_digest(credentials.credentials))
    if not session or session.revoked:
        raise HTTPException(401, "Your session has expired. Please sign in again.")
    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= datetime.now(timezone.utc):
        raise HTTPException(401, "Your session has expired. Please sign in again.")
    account = db.get(Account, session.account_id)
    if not account or account.status != "active":
        raise HTTPException(403, "This account is currently blocked.")
    return account


def _issue_session(db: Session, account: Account) -> dict[str, Any]:
    token = secrets.token_urlsafe(40)
    db.add(AuthSession(
        token_hash=_token_digest(token),
        account_id=account.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    ))
    db.commit()
    return {"token": token, "state": _market_state(db, account)}


def initialize_database() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal.begin() as db:
        for name in ("Fashion", "Home", "Accessories"):
            if not db.get(Category, name):
                db.add(Category(name=name))


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app.router.lifespan_context = lifespan


@app.get("/api/health")
def health(db: Session = Depends(_session)) -> dict[str, str]:
    db.execute(select(Category.name).limit(1)).first()
    return {"status": "ok", "database": "connected"}


@app.get("/api/state")
def read_state(
    db: Session = Depends(_session),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict[str, Any]:
    if credentials:
        account = _authenticated_account(credentials, db)
    else:
        account = None
    return {"state": _market_state(db, account)}


@app.post("/api/auth/register", status_code=201)
async def register(request: Request, db: Session = Depends(_session)) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(422, "Registration data must be an object.")
    name = _string(body.get("name"), "Name", 100)
    email = _string(body.get("email"), "Email", 254).lower()
    phone = _string(body.get("phone"), "Phone", 30)
    password = body.get("password")
    if not isinstance(password, str) or len(password) < 10 or len(password) > 128:
        raise HTTPException(422, "Password must be between 10 and 128 characters.")
    if not _valid_email(email):
        raise HTTPException(422, "Enter a valid email address.")
    if not _valid_phone(phone):
        raise HTTPException(422, "Enter a valid phone number.")
    account_type = body.get("type")
    if account_type not in ("seller", "buyer"):
        raise HTTPException(422, "Choose a valid account type.")
    if db.scalar(select(Account.id).where(Account.email == email)):
        raise HTTPException(409, "An account with this email already exists.")
    referred_by = None
    referral = str(body.get("referral", "")).strip().upper()
    if referral:
        seller = db.scalar(select(Account).where(Account.code == referral, Account.type == "seller", Account.status == "active"))
        if not seller:
            raise HTTPException(422, "That seller referral code is not valid.")
        referred_by = seller.id
        account_type = "buyer"
    prefix = "".join(char for char in name if char.isalpha())[:5].upper() or "SHOP"
    code = f"{prefix}-{secrets.token_hex(4).upper()}" if account_type == "seller" else None
    account = Account(
        id=f"account-{secrets.token_urlsafe(18)}",
        name=name,
        email=email,
        phone=phone,
        type=account_type,
        password_hash=_password_hash(password),
        code=code,
        referred_by=referred_by,
        status="active",
    )
    db.add(account)
    db.commit()
    return _issue_session(db, account)


@app.post("/api/auth/login")
async def login(request: Request, db: Session = Depends(_session)) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(422, "Login data must be an object.")
    email = str(body.get("email", "")).strip().lower()
    password = body.get("password")
    account = db.scalar(select(Account).where(Account.email == email))
    if not account or not isinstance(password, str) or not _verify_password(password, account.password_hash):
        raise HTTPException(401, "Email or password is incorrect.")
    if account.status != "active":
        raise HTTPException(403, "This account is currently blocked. Contact support for assistance.")
    return _issue_session(db, account)


@app.post("/api/auth/logout")
def logout(
    account: Account = Depends(_authenticated_account),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(_session),
) -> dict[str, bool]:
    del account
    session = db.get(AuthSession, _token_digest(credentials.credentials)) if credentials else None
    if session:
        session.revoked = True
        db.commit()
    return {"ok": True}


@app.put("/api/state")
async def write_state(
    request: Request,
    account: Account = Depends(_authenticated_account),
    db: Session = Depends(_session),
) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(422, "The state payload must be an object.")
    try:
        _sync_state(db, account, body)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"state": _market_state(db, account)}


@app.get("/")
def index():
    from fastapi.responses import FileResponse

    return FileResponse(FRONTEND_ROOT / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND_ROOT), name="static")
