import os
from pathlib import Path

import psycopg
from psycopg import sql
from dotenv import load_dotenv
from sqlalchemy.engine import make_url


BACKEND_ROOT = Path(__file__).resolve().parent
load_dotenv(BACKEND_ROOT / ".env")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://postgres:postgres@localhost:5432/markethub",
)
POSTGRES_ADMIN_URL = os.getenv(
    "POSTGRES_ADMIN_URL",
    "postgresql://postgres:postgres@localhost:5432/postgres",
)
database_name = make_url(DATABASE_URL).database
if not database_name or database_name != "markethub":
    raise ValueError("DATABASE_URL must target the 'markethub' database.")
admin_dsn = make_url(POSTGRES_ADMIN_URL).set(drivername="postgresql").render_as_string(
    hide_password=False
)
database_dsn = make_url(DATABASE_URL).set(drivername="postgresql").render_as_string(
    hide_password=False
)

with psycopg.connect(admin_dsn, autocommit=True) as connection:
    database_exists = connection.execute(
        "SELECT 1 FROM pg_database WHERE datname = %s",
        (database_name,),
    ).fetchone()
    if not database_exists:
        connection.execute(
            sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name))
        )
        print(f"Created PostgreSQL database '{database_name}'.")
    else:
        print(f"PostgreSQL database '{database_name}' already exists.")

with psycopg.connect(database_dsn) as connection:
    schema = (BACKEND_ROOT / "schema.sql").read_text(encoding="utf-8")
    for statement in schema.split(";"):
        if statement.strip():
            connection.execute(statement)

    with connection.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO categories (name) VALUES (%s) ON CONFLICT (name) DO NOTHING",
            [("Fashion",), ("Home",), ("Accessories",)],
        )

print("Created/verified all MarketHub tables and starter categories.")
