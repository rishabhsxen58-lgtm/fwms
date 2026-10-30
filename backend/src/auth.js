import { db } from "./db.js";

// PUBLIC DEMO MODE ONLY: every visitor receives the seeded demo administrator identity.
// Never enable this mode for real institutional or personal data.
export function authenticate(_req, res, next) {
  const user = db.prepare(`SELECT u.id, u.institution_id, u.department_id, u.name, u.email, u.role, u.active
    FROM users u
    JOIN institutions i ON i.id = u.institution_id
    WHERE i.name = 'Northstar University (Demo)' AND u.email = 'admin@northstar.demo'
    LIMIT 1`).get();

  if (!user || !user.active) {
    return res.status(503).json({ error: "Demo workspace is not initialized. Enable SEED_DEMO=true and redeploy the API." });
  }
  req.user = user;
  next();
}

export function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "Insufficient permission" });
    next();
  };
}

export function canManageDepartment(req, departmentId) {
  return req.user.role === "ADMIN"
    || (req.user.role === "HOD" && Number(departmentId) === req.user.department_id);
}

// Retained as no-op compatibility exports for existing auth endpoints.
export function setAuthCookie() {}
export function clearAuthCookie() {}
