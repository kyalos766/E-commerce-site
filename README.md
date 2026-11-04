# MarketHub

The application is separated into `frontend/` and `backend/`. The FastAPI
backend serves the frontend and API on the same origin. PostgreSQL stores
accounts, products, categories, carts, orders, inventory, installments, and live
sessions.

## Create the PostgreSQL database

Install PostgreSQL for Windows and start its service first. The database
initializer does not install or start PostgreSQL; it connects to your running
local PostgreSQL server, creates the `markethub` database when missing, and
applies [`backend/schema.sql`](backend/schema.sql) to create/verify the application
tables and starter categories.

From the project root:

```powershell
Copy-Item backend\.env.example backend\.env
```

Edit `backend\.env` and replace `CHANGE_ME` in both connection URLs with the
password for your PostgreSQL user. Then run:

```powershell
python -m pip install -r backend\requirements.txt
python -m backend.init_db
python -m uvicorn backend.main:app --reload
```

Open `http://127.0.0.1:8000`. Confirm the API and database connection at
`http://127.0.0.1:8000/api/health`.

The PostgreSQL user in `POSTGRES_ADMIN_URL` must be allowed to create databases.
Set both connection URLs in `backend\.env` if you use a different local
PostgreSQL user or port. Keep `backend\.env` private; it is ignored by Git.

## Tests

From the project root:

```powershell
python -m unittest -v backend.test_backend
```

The integration tests use a temporary SQLite database; the application itself
is configured for PostgreSQL.

New accounts require a password of at least 10 characters. Admin accounts must
be provisioned by a trusted database administrator; public registration cannot
create an admin account. To create or reset one, set `ADMIN_EMAIL`,
`ADMIN_PASSWORD`, `ADMIN_NAME`, and `ADMIN_PHONE` in PowerShell, then run
`python -m backend.seed_admin`.

Payment methods are recorded as order preferences only: real M-Pesa/PayPal
processing requires separate provider credentials and setup.
