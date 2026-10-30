# REST API

Base URL: `http://localhost:4000/api`. JSON requests use `Content-Type: application/json`, except multipart import uploads. Successful protected requests require the HTTP-only `session` cookie established by login. CORS is restricted to `CLIENT_ORIGIN`. Error responses use `{ "error": "..." }`; validation errors may include `details`.

## Authentication and tenant setup

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/health` | Public | API/database health |
| POST | `/auth/register` | Public, rate-limited | Create unverified institution, first department and ADMIN |
| POST | `/auth/verify-development` | Development only | Verify a local institution using `DEV-VERIFY` |
| POST | `/auth/login` | Public, rate-limited | Sign in; sets HTTP-only cookie |
| POST | `/auth/logout` | Public | Clear session cookie |
| GET | `/auth/me` | Authenticated | Current account |

Register body: `{ "institution": "Example University", "department": "Science", "name": "Admin Name", "email": "admin@example.edu", "password": "minimum 10 chars" }`. Login body: `{ "email": "...", "password": "..." }`.

## Institution data

All records are automatically scoped to the authenticated institution. HODs are restricted to their department; FACULTY can read only their own profile, assignments, duties, workload and availability.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET/POST | `/departments` | Authenticated / ADMIN | List or add department |
| PATCH/DELETE | `/departments/:id` | ADMIN | Edit or delete empty department |
| GET/POST/PATCH/DELETE | `/faculty`, `/faculty/:id` | Read: scoped; writes: ADMIN/HOD | Faculty profile and expertise CRUD |
| GET/PUT | `/faculty/:id/availability` | Scoped / self | Read or replace weekly availability |
| GET/POST/PATCH/DELETE | `/hods`, `/hods/:id` | ADMIN | Department-head account CRUD |
| GET/POST/PATCH/DELETE | `/courses`, `/courses/:id` | Read: scoped; writes: ADMIN/HOD | Course CRUD |
| GET/POST/PATCH/DELETE | `/sections`, `/sections/:id` | Read: scoped; writes: ADMIN/HOD | Teaching section and hours CRUD |
| GET/POST/PATCH/DELETE | `/duties`, `/duties/:id` | Read: scoped; writes: ADMIN/HOD | Additional-duty CRUD |
| GET/PUT | `/policy` | Read: authenticated; writes: ADMIN/HOD | Institution workload thresholds |
| GET | `/allocations` | Authenticated, scoped | View official allocations |
| POST/DELETE | `/allocations`, `/allocations/:sectionId` | ADMIN/HOD | Create assignment/reassignment or unassignment draft; official allocations remain unchanged until approval |
| GET | `/dashboard`, `/workloads` | Authenticated | Role-scoped database statistics and workload values |
| GET | `/reports/workload.csv` | Authenticated | Download scoped workload CSV |
| GET | `/audit` | ADMIN/HOD | Read recent institution audit events |

Workload policy body:

```json
{
  "balancedMin": 8,
  "balancedMax": 16,
  "overloadThreshold": 18,
  "dutyHoursCounted": true
}
```

## Workload workflows and approvals

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/workflows/analyze` | ADMIN/HOD | Analyze official allocations, policy status and unallocated sections |
| POST | `/workflows/generate` | ADMIN/HOD | Create a heuristic recommendation draft; does not change official allocations |
| GET | `/recommendations` | ADMIN/HOD | List reviewable recommendations |
| GET | `/recommendations/:id` | ADMIN/HOD, creator/department-scoped | Read draft items and reasons |
| PATCH | `/recommendations/:id/items/:itemId` | ADMIN/HOD, scoped | Edit a suggested faculty member |
| POST | `/recommendations/:id/review` | ADMIN/HOD, scoped | `{ "decision": "approve" }` or `{ "decision": "reject" }` |

Approval validates current department, expertise, availability, timetable and capacity constraints before committing official allocation changes. Changes and before/after values are audited. A failed approval does not partially apply.

## CSV/XLSX imports

All import routes require ADMIN/HOD. Upload limit: 2 MB, 2,000 data rows; `.csv` and `.xlsx` (first worksheet) accepted.

| Method | Path | Content | Purpose |
|---|---|---|---|
| GET | `/import/templates/:entity` | — | Download CSV template; entity is `faculty`, `courses`, `sections` or `duties` |
| POST | `/import/headers` | Multipart `file` | Inspect unique headers for column mapping |
| POST | `/import/preview` | Multipart `file`, `entity`, JSON `mapping` | Validate rows/references and create preview batch |
| POST | `/import/:batchId/confirm` | JSON `{}` | Confirm a clean preview; import transactionally |

`mapping` maps target field names to exact uploaded column names, for example `{"name":"Staff Name","email":"Email","department":"Department"}`. Preview reports required-field, data-format and in-tenant reference errors. A preview with errors cannot be confirmed. Faculty imports receive one-time generated temporary passwords in the confirmation response.

## Optional ML service

Routes proxy to `ML_SERVICE_URL`; workload and optimization routes remain available if the service is offline.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/ml/status` | Authenticated | ML service availability |
| GET | `/ml/metrics` | Authenticated | Actual held-out evaluation metrics |
| POST | `/ml/train` | ADMIN/HOD | Retrain on labeled synthetic examples and return measured metrics |
| POST | `/ml/predict` | Authenticated | `{ "teachingHours": 12, "dutyHours": 2 }` |

The Python service also exposes `/health`, `/metrics`, `/train` and `/predict` on its private port. Predictions are informational; SQL-backed policy calculations are authoritative.
