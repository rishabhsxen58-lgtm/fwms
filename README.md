# Faculty Workload Management Platform

A presentation-only public demo of an academic workload application built with React/Vite/Tailwind, Express, SQLite and an optional FastAPI/Random Forest service. The website opens directly to the workspace with no sign-in, registration, password or session flow. Workload totals come from database records and institution policy; ML is explanatory only.

**Security warning:** Public Demo Mode bypasses authentication and exposes demo workspace operations to every visitor. Use only synthetic/sample data. Do not deploy this configuration for real institutions or real personal/faculty records.

## Run locally

Requirements: Node.js 20+ and npm. Python is optional unless you want the ML classifier.

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`. The API listens on `http://localhost:4000`; SQLite data is stored in `backend/data/workload.sqlite` by default. `SEED_DEMO=true` creates the clearly named **Northstar University (Demo)** institution on first launch. Public Demo Mode requires this setting.

### Public demo access

The app automatically opens the seeded Northstar University (Demo) workspace. There is no login, registration, logout, password or user-session flow. The backend assigns every visitor the demo administrator context so the presentation modules can load.

This is intentionally insecure and must be used only with synthetic demonstration data. Never add real faculty, student, institution or employee information.

## Optional ML service

Open a second terminal:

```powershell
python -m venv ml\.venv
ml\.venv\Scripts\Activate.ps1
python -m pip install -r ml\requirements.txt
python -m uvicorn app:app --app-dir ml --reload --host 127.0.0.1 --port 8000
```

The model trains a Random Forest from clearly labeled synthetic data at startup. The Settings page shows the actual held-out evaluation metrics reported by scikit-learn and can retrain the classifier. If this service is stopped, the UI reports that state; workload calculation, CSV/XLSX imports, reporting and allocation planning remain operational. The estimator never replaces policy-based workload totals.

## Build and tests

```powershell
npm run build
npm test
```

The backend integration tests use an isolated temporary SQLite database and exercise authentication, tenant isolation, RBAC, approval-only allocation changes, validation and ML-unavailable behavior.

With the optional ML dependencies installed:

```powershell
python -m unittest discover -s ml -p "test_*.py"
```

No expected accuracy or test outcome is hardcoded; metrics are computed during actual model evaluation.

## Configuration and production notes

- Copy `.env.example` to `.env`. Set `NODE_ENV=production` before deployment. JWT authentication is not used in this public demo build.
- Use HTTPS in production; the session cookie is HTTP-only, SameSite Strict and Secure in production.
- Set `CLIENT_ORIGIN` to the exact deployed frontend origin. Keep the ML service private to the application network.
- Keep `SEED_DEMO=true` only for this public sample-data demo; do not use this build for production records.
- Database migrations run automatically and are stored in `backend/migrations/`. Back up the SQLite database file before deployment or upgrades.
- The application has no email provider, external identity provider or password-reset delivery integration. Imported faculty receive one-time temporary passwords in the import confirmation response; distribute them only through a secure channel and clear them from the screen afterward.
- The canonical URL, sitemap URL and robots sitemap URL currently use an example deployment host. Replace `facultyworkload.example` with the production domain before publishing.
- CSV and XLSX import currently supports the first worksheet in an `.xlsx` workbook; XLS (legacy binary) is not accepted. CSV workload export is available.
- This implementation uses a greedy constraint-aware assignment heuristic, not a mathematical solver, and does not guarantee a globally optimal assignment.

## Free-tier deployment (Netlify + Render)

This repository includes `netlify.toml` and `render.yaml` for a low-cost demo deployment.

### Important data warning

The default `render.yaml` uses Render's **free** web service and stores SQLite at `/tmp/workload.sqlite`. This is suitable for a public demo with disposable/sample data only. Render free services have an ephemeral filesystem and spin down when idle; SQLite data can disappear on restart, spin-down or redeploy. Do not store real faculty records on this configuration. Render's free Postgres also expires after 30 days, so it is not a durable production database.

For persistent records, use `render-persistent.yaml` with a paid Render Starter service and attached disk (`/var/data`), or migrate the data layer to a managed PostgreSQL provider before production. The current code uses synchronous `better-sqlite3`; a managed Postgres URL cannot simply be pasted into `DATABASE_FILE`.

### Deploy the API to Render

1. Push this project to a GitHub repository. Do not commit `.env`, database files, credentials or local dependency folders.
2. In Render, choose **New → Blueprint**, connect the repository and select `render.yaml`.
3. Render builds with `npm ci && npm run build` and starts `npm run start --workspace backend`.
4. Set `CLIENT_ORIGIN` temporarily to `https://YOUR-SITE.netlify.app` (replace it after creating the Netlify site). Keep the generated `JWT_SECRET`; never use a sample secret.
5. Wait for deployment, then check `https://YOUR-API.onrender.com/api/health`.

### Deploy the frontend to Netlify

1. Import the same GitHub repository into Netlify.
2. Base directory: repository root. Build command: `npm run build`. Publish directory: `frontend/dist`.
3. In `netlify.toml`, replace `YOUR-RENDER-API` with the actual Render service hostname (no trailing slash), then commit and redeploy.
4. Replace `YOUR-SITE` in `frontend/index.html`, `frontend/public/robots.txt` and `frontend/public/sitemap.xml` with the actual Netlify hostname. Commit and redeploy.
5. In Render, set `CLIENT_ORIGIN` to the exact Netlify origin, e.g. `https://your-site.netlify.app` (no trailing slash), then redeploy the API.
6. Test that the root URL opens the dashboard directly and that the seeded sample faculty, courses, workload, imports and reports load. The `/api/*` Netlify rewrite forwards browser requests to Render.

### ML service

ML is optional. To keep the free deployment simple, do not deploy it initially; the app should report ML as unavailable while calculations and allocation planning continue. If needed, deploy `ml/` as a separate Python web service with `python -m pip install -r requirements.txt` and `uvicorn app:app --host 0.0.0.0 --port $PORT`, then set `ML_SERVICE_URL` to its service URL. This adds another service and may sleep on free hosting.

### Before using real institutional data

- Move to persistent storage and test restore/backup procedures.
- Restore authentication, tenant isolation and role-based authorization before any real-data deployment.
- Replace the example domain in SEO metadata and verify sitemap/canonical URLs.
- Disable demo seeding (`SEED_DEMO=false`) and rotate all credentials/secrets.
- Configure monitoring, access review, data-retention rules and incident response.
- Do not treat the free Render configuration as production storage.

## Feature checklist

### Implemented

- Seeded demo institution and presentation-only public demo context (no authentication or user authorization).
- SQLite migration runner, indexed schema and audit history.
- Departments, HOD accounts, faculty profiles, expertise, availability, courses, sections, allocations, additional duties and workload policy management.
- CSV/XLSX upload → column mapping → row/reference validation → preview errors → explicit import confirmation; sample CSVs in [`samples/`](./samples).
- Workload analysis from official allocations, teaching-hour categories, counted duties and configured policy.
- Heuristic allocation drafts using subject match, department, availability, capacity and timetable checks; existing feasible assignments are preferred.
- Recommendation editing, approve/reject, approval-only official allocation writes and before/after audit records.
- Role-scoped dashboards, chart, searchable faculty table, CSV workload export and audit view.
- Optional synthetic-data Random Forest service with measured held-out metrics; ML status remains explicit if unavailable.
- Public landing metadata, structured data, canonical link, robots.txt, sitemap.xml, responsive layouts and noindex authenticated app.

### Tested

- [x] Backend integration suite: tenant-scoped faculty data, registration and development verification, manual and generated approval-only changes, stale recommendation rejection, policy validation, ML-unavailable behavior and XLSX import.
- [x] Frontend production build with `npm run build`.
- [x] ML unit tests for measured held-out metrics and supported prediction labels.
- [x] Dependency audit with `npm audit` (no known vulnerabilities).

### Pending or intentionally limited

- Production institution verification workflow/email delivery and password reset.
- XLS legacy workbook format; `.xlsx` first worksheet and `.csv` are supported.
- PDF/XLSX report exports; current report export is CSV.
- Fine-grained user lifecycle controls such as password reset, account invitation and MFA.
- Automated accessibility audit and browser-based end-to-end UI suite.
- Production deployment/domain configuration and operational monitoring/backups.
