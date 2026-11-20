# Local Development — Boot & Run Guide

How to start the NovrPulse app locally (backend + frontend + database), and
how to stop it again.

> Current local setup points the app at the **Docker Postgres database** on
> `localhost:5440` (not Supabase). Supabase credentials are preserved in
> `backend/.env.backup-supabase` — see [Switching database](#switching-database).

---

## Quick start (TL;DR)

```bat
:: 1. Database
docker start np-localtest-db

:: 2. App (backend + frontend together)
cd "C:\Users\Ajibola Adedeji\Documents\GitHub\novrcampaign"
npm run dev
```

Open **http://localhost:5173** and log in:

- **Email:** `admin@novrcampaign.local`
- **Password:** `admin12345`

Leave the terminal open. `Ctrl+C` stops both processes.

---

## 1. Start the database

The backend reads `DATABASE_URL` from `backend/.env`, which currently points at
the Docker container:

```
postgresql://novr:novr@localhost:5440/np_localtest
```

Start it:

```bat
docker start np-localtest-db
```

Verify it is running:

```bat
docker ps --filter name=np-localtest-db
```

You should see the container `Up` with port `5440->5432`.

> If Docker Desktop is not running, open it first and wait for it to finish
> starting before running `docker start`.

### If the container was deleted (not just stopped)

Recreate it, then re-apply the schema and seed the admin user:

```bat
:: 1. Create the container
docker run -d --name np-localtest-db ^
  -e POSTGRES_USER=novr ^
  -e POSTGRES_PASSWORD=novr ^
  -e POSTGRES_DB=np_localtest ^
  -p 5440:5432 postgres:16

:: 2. Apply migrations (from the backend folder, with the Docker URL set)
cd backend
set DATABASE_URL=postgresql://novr:novr@localhost:5440/np_localtest
set DIRECT_URL=postgresql://novr:novr@localhost:5440/np_localtest
npx prisma migrate deploy
npx prisma generate

:: 3. Seed the admin user
node prisma/seed.js
```

---

## 2. Start the app

From the repository root:

```bat
cd "C:\Users\Ajibola Adedeji\Documents\GitHub\novrcampaign"
npm run dev
```

This uses `concurrently` to start both processes:

| Process | Command | Port |
| --- | --- | --- |
| Backend API | `npm run dev:backend` | **4000** |
| Frontend (Vite) | `npm run dev:frontend` | **5173** |

### Run them separately (optional)

```bat
:: Terminal 1 — backend only
npm run dev:backend

:: Terminal 2 — frontend only
npm run dev:frontend
```

---

## 3. Verify it is up

```bat
:: Backend health
curl http://localhost:4000/api/health

:: Pulse API (401 is correct — it means auth is guarding the route)
curl http://localhost:4000/api/pulse/events
```

Then open **http://localhost:5173**.

---

## 4. Stop it

If you started it with `npm run dev`, press **Ctrl+C** in that terminal.

To stop the database as well:

```bat
docker stop np-localtest-db
```

To confirm the ports are free:

```bat
netstat -ano | findstr ":4000 :5173"
```

---

## Common problems

### `EADDRINUSE` — port already in use

Something is still holding 4000 or 5173. Find and kill it:

```bat
netstat -ano | findstr ":4000 :5173"
taskkill /PID <pid> /F
```

### Backend cannot connect to the database

- Confirm the container is running: `docker ps --filter name=np-localtest-db`
- Confirm `backend/.env` points at `localhost:5440` (see below).

### `EPERM` when running `npx prisma generate`

A running backend holds the Prisma engine DLL. Stop the backend (or `npm run
dev`) first, then regenerate.

---

## Switching database

The app currently uses the **Docker** database. To switch back to **Supabase**:

```bat
Copy-Item backend\.env.backup-supabase backend\.env
```

then restart `npm run dev`.

To switch to Docker again, point `DATABASE_URL` and `DIRECT_URL` in
`backend/.env` back at:

```
postgresql://novr:novr@localhost:5440/np_localtest
```

> Migrations have been applied to the **Docker** database only. Standing up
> Supabase again requires `npx prisma migrate deploy` against that database.

---

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start backend + frontend together |
| `npm run dev:backend` | Backend only (port 4000) |
| `npm run dev:frontend` | Frontend only (port 5173) |
| `npm run build` | Build frontend + regenerate the Prisma client (backend "build" is `prisma generate`) |
| `npm run lint` | Lint backend + frontend + `@novr/ingest` |
| `npm test` | Run `@novr/ingest` + backend test suites |
| `npm run db:migrate` | `prisma migrate deploy` (backend) |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:seed` | Seed the database |

---

## Where things live

| Area | Path |
| --- | --- |
| Collector (standalone service) | `..\novr-collection` (separate repo) |
| Ingestion engine | `packages/ingest` |
| Backend API | `backend/src` |
| Frontend app | `frontend/src` |
| NovrPulse docs | `docs/novrpulse` |
| Local dev DB (Docker) | container `np-localtest-db`, port `5440` |
