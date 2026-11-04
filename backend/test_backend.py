import os
import copy
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4


database_file = Path(tempfile.gettempdir()) / f"markethub-tests-{uuid4().hex}.sqlite3"
os.environ["DATABASE_URL"] = f"sqlite:///{database_file.as_posix()}"

from fastapi.testclient import TestClient

from backend.main import Account, SessionLocal, app
from backend.main import Base


class MarketplaceApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls):
        from backend.main import engine

        cls.client_context.__exit__(None, None, None)
        engine.dispose()
        database_file.unlink(missing_ok=True)

    def register(self, email: str, account_type: str) -> dict:
        response = self.client.post("/api/auth/register", json={
            "name": "Test User",
            "email": email,
            "phone": "+254712345678",
            "password": "test-password-123",
            "type": account_type,
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_registration_password_login_and_role_protection(self):
        result = self.register(f"{uuid4().hex}@example.com", "seller")
        account = next(item for item in result["state"]["accounts"] if item["id"] == result["state"]["session"])
        self.assertNotIn("password_hash", account)

        with SessionLocal() as db:
            stored = db.get(Account, account["id"])
            self.assertNotEqual(stored.password_hash, "test-password-123")

        valid_login = self.client.post("/api/auth/login", json={
            "email": account["email"],
            "password": "test-password-123",
        })
        self.assertEqual(valid_login.status_code, 200, valid_login.text)
        self.assertEqual(valid_login.json()["state"]["session"], account["id"])

        login = self.client.post("/api/auth/login", json={
            "email": account["email"],
            "password": "wrong-password",
        })
        self.assertEqual(login.status_code, 401)

        admin_signup = self.client.post("/api/auth/register", json={
            "name": "Pretend Admin",
            "email": f"{uuid4().hex}@example.com",
            "phone": "+254712345679",
            "password": "test-password-123",
            "type": "admin",
        })
        self.assertEqual(admin_signup.status_code, 422)

    def test_products_orders_inventory_and_seller_visibility(self):
        seller = self.register(f"{uuid4().hex}@example.com", "seller")
        seller_headers = {"Authorization": f"Bearer {seller['token']}"}
        seller_state = seller["state"]
        stale_seller_state = copy.deepcopy(seller_state)
        seller_account = next(item for item in seller_state["accounts"] if item["id"] == seller_state["session"])
        product = {
            "id": f"product-{uuid4().hex}",
            "name": "Handwoven basket",
            "category": "Woven goods",
            "price": 2500,
            "stock": 5,
            "seller": seller_account["name"],
            "sellerId": seller_account["id"],
            "image": "product-placeholder.svg",
            "tag": "New",
        }
        seller_state["products"].append(product)
        seller_state["liveSessions"].append({
            "id": f"live-{uuid4().hex}",
            "sellerId": seller_account["id"],
            "platform": "instagram",
            "productIds": [product["id"]],
            "active": True,
            "startedAt": "2026-11-04T00:00:00+00:00",
        })
        seller_state["categories"].append("Woven goods")
        created_product = self.client.put(
            "/api/state",
            headers=seller_headers,
            json={**seller_state, "categoryMutation": {"action": "add", "name": "Woven goods"}},
        )
        self.assertEqual(created_product.status_code, 200, created_product.text)
        stale_write = self.client.put("/api/state", headers=seller_headers, json=stale_seller_state)
        self.assertEqual(stale_write.status_code, 200, stale_write.text)
        self.assertTrue(any(item["id"] == product["id"] for item in stale_write.json()["state"]["products"]))
        self.assertEqual(len(stale_write.json()["state"]["liveSessions"]), 1)

        renamed_state = created_product.json()["state"]
        renamed_state["categories"] = [
            "Handmade" if name == "Woven goods" else name for name in renamed_state["categories"]
        ]
        for item in renamed_state["products"]:
            if item["id"] == product["id"]:
                item["category"] = "Handmade"
        renamed = self.client.put(
            "/api/state",
            headers=seller_headers,
            json={
                **renamed_state,
                "categoryMutation": {"action": "rename", "oldName": "Woven goods", "name": "Handmade"},
            },
        )
        self.assertEqual(renamed.status_code, 200, renamed.text)
        product = next(item for item in renamed.json()["state"]["products"] if item["id"] == product["id"])
        self.assertEqual(product["category"], "Handmade")

        buyer = self.register(f"{uuid4().hex}@example.com", "buyer")
        buyer_headers = {"Authorization": f"Bearer {buyer['token']}"}
        buyer_state = buyer["state"]
        buyer_account = next(item for item in buyer_state["accounts"] if item["id"] == buyer_state["session"])
        self.assertTrue(any(item["id"] == product["id"] for item in buyer_state["products"]))
        public_seller = next(item for item in buyer_state["accounts"] if item["id"] == seller_account["id"])
        self.assertNotIn("email", public_seller)
        self.assertTrue(buyer_state["liveSessions"])
        buyer_state["cart"] = [{"productId": product["id"], "quantity": 2}]
        cart_response = self.client.put("/api/state", headers=buyer_headers, json=buyer_state)
        self.assertEqual(cart_response.status_code, 200, cart_response.text)

        order = {
            "id": f"MH-{uuid4().hex[:12]}",
            "sellerId": seller_account["id"],
            "buyer": buyer_account["name"],
            "buyerId": buyer_account["id"],
            "buyerEmail": buyer_account["email"],
            "buyerPhone": buyer_account["phone"],
            "pickupArea": "Nairobi",
            "items": [{
                "productId": product["id"],
                "name": product["name"],
                "price": product["price"],
                "quantity": 2,
            }],
            "total": 5000,
            "status": "Pending",
            "date": "Just now",
            "orderedAt": "2026-11-04T00:00:00+00:00",
            "paymentMethod": "M-Pesa STK push",
            "paymentPlan": [],
        }
        buyer_state["orders"].append(order)
        buyer_state["cart"] = []
        created_order = self.client.put("/api/state", headers=buyer_headers, json=buyer_state)
        self.assertEqual(created_order.status_code, 200, created_order.text)
        created_product = next(
            item for item in created_order.json()["state"]["products"] if item["id"] == product["id"]
        )
        self.assertEqual(created_product["stock"], 3)

        seller_reload = self.client.get("/api/state", headers=seller_headers).json()["state"]
        self.assertEqual(len(seller_reload["orders"]), 1)
        seller_reload["orders"][0]["status"] = "Received"
        received = self.client.put("/api/state", headers=seller_headers, json=seller_reload)
        self.assertEqual(received.status_code, 200, received.text)
        buyer_reload = self.client.get("/api/state", headers=buyer_headers).json()["state"]
        self.assertEqual(buyer_reload["orders"][0]["status"], "Received")
        buyer_reload["orders"][0]["paymentPlan"][0]["paid"] = True
        fake_payment = self.client.put("/api/state", headers=buyer_headers, json=buyer_reload)
        self.assertEqual(fake_payment.status_code, 200, fake_payment.text)
        self.assertFalse(fake_payment.json()["state"]["orders"][0]["paymentPlan"][0]["paid"])

    def test_unauthenticated_write_and_overselling_are_rejected(self):
        self.assertEqual(self.client.put("/api/state", json={}).status_code, 401)
        seller = self.register(f"{uuid4().hex}@example.com", "seller")
        headers = {"Authorization": f"Bearer {seller['token']}"}
        state = seller["state"]
        account = next(item for item in state["accounts"] if item["id"] == state["session"])
        product = {
            "id": f"product-{uuid4().hex}",
            "name": "One item",
            "category": "Fashion",
            "price": 100,
            "stock": 1,
            "seller": account["name"],
            "sellerId": account["id"],
            "image": "product-placeholder.svg",
            "tag": "New",
        }
        state["products"].append(product)
        self.assertEqual(self.client.put("/api/state", headers=headers, json=state).status_code, 200)

        buyer = self.register(f"{uuid4().hex}@example.com", "buyer")
        buyer_state = buyer["state"]
        buyer_state["cart"] = [{"productId": product["id"], "quantity": 2}]
        response = self.client.put(
            "/api/state",
            headers={"Authorization": f"Bearer {buyer['token']}"},
            json=buyer_state,
        )
        self.assertEqual(response.status_code, 409)

    def test_health_reports_database_connection(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "database": "connected"})

    def test_frontend_is_served_from_frontend_directory(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("MarketHub", response.text)

        script = self.client.get("/app.js")
        self.assertEqual(script.status_code, 200)
        self.assertIn("apiRequest", script.text)
        self.assertIn("/state", script.text)

    def test_postgres_schema_covers_every_orm_table(self):
        schema = (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")
        declared_tables = {
            line.split()[5]
            for line in schema.splitlines()
            if line.strip().upper().startswith("CREATE TABLE IF NOT EXISTS ")
        }
        self.assertEqual(declared_tables, set(Base.metadata.tables))


if __name__ == "__main__":
    unittest.main()
