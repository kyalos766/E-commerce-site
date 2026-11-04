# MarketHub

The application is separated into `frontend/` and `backend/`. The FastAPI
backend serves the frontend and API on the same origin. PostgreSQL stores
accounts, products, categories, carts, orders, inventory, installments, and live
sessions.

## Create the PostgreSQL database

The PostgreSQL 18 Windows binaries are installed for the current Windows user
under `%LOCALAPPDATA%\Programs\PostgreSQL\18`; the data files live under
`%LOCALAPPDATA%\MarketHub\postgres\data`. This local setup does not require
Docker or a Windows service.

Connection settings and a generated local database password are stored in the
ignored file `backend\.env`. To start PostgreSQL after restarting Windows, run
from the project root:

```powershell
$pgBin = Join-Path $env:LOCALAPPDATA 'Programs\PostgreSQL\18\pgsql\bin'
$data = Join-Path $env:LOCALAPPDATA 'MarketHub\postgres\data'
$log = Join-Path $env:LOCALAPPDATA 'MarketHub\postgres\postgresql.log'
& "$pgBin\pg_ctl.exe" start -D $data -l $log -o "-h 127.0.0.1 -p 5432" -w
```

Install the Python dependencies if needed, create/verify the database and
tables, and start the backend:

```powershell
python -m pip install -r backend\requirements.txt
python -m backend.init_db
python -m uvicorn backend.main:app --reload
```

The website is at `http://127.0.0.1:8000`. Verify the API/database at
`http://127.0.0.1:8000/api/health`. To stop PostgreSQL, first stop the backend,
then run:

```powershell
& "$pgBin\pg_ctl.exe" stop -D $data -m fast
```

Keep `backend\.env` private; it is ignored by Git.

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
