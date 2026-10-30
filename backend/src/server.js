import express from "express";
import helmet from "helmet";
import cors from "cors";
import multer from "multer";
import { parse } from "csv-parse/sync";
import readXlsxFile from "read-excel-file/node";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./db.js";
import { authenticate, allowRoles, canManageDepartment } from "./auth.js";
import { audit, workloadFor } from "./domain.js";

const app = express();
// Render and Netlify proxy requests; trust the first platform proxy for secure cookies and client IPs.
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
const port = Number(process.env.PORT ?? 4000);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: clientOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const idParam = (req) => Number(req.params.id);
const ownTenant = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  next();
};
const manager = [authenticate, allowRoles("ADMIN", "HOD")];

function assertDepartmentAccess(req, res, departmentId) {
  const department = db.prepare("SELECT id, institution_id FROM departments WHERE id = ?").get(departmentId);
  if (!department || department.institution_id !== req.user.institution_id) {
    res.status(404).json({ error: "Department not found" });
    return false;
  }
  if (!canManageDepartment(req, departmentId)) {
    res.status(403).json({ error: "Department access denied" });
    return false;
  }
  return true;
}

function allocationViolations(section, facultyId, excludeSectionId = section.id) {
  const person = db.prepare(`SELECT u.department_id, p.max_hours FROM users u
    LEFT JOIN faculty_profiles p ON p.user_id=u.id WHERE u.id=? AND u.institution_id=? AND u.role='FACULTY'`)
    .get(facultyId, section.institution_id);
  if (!person) return ["Faculty member does not belong to this institution."];
  const issues = [];
  if (person.department_id !== section.department_id) issues.push("Faculty member belongs to a different department.");
  if (!db.prepare("SELECT 1 FROM expertise WHERE faculty_id=? AND lower(subject)=lower(?)").get(facultyId, section.subject)) {
    issues.push(`Faculty expertise does not match ${section.subject}.`);
  }
  if (section.day && section.slot) {
    const availability = db.prepare("SELECT available FROM availability WHERE faculty_id=? AND day=? AND slot=?").get(facultyId, section.day, section.slot);
    if (availability?.available === 0) issues.push("Faculty member is unavailable at the section's scheduled time.");
    const collision = db.prepare(`SELECT 1 FROM allocations a JOIN sections other ON other.id=a.section_id
      WHERE a.institution_id=? AND a.faculty_id=? AND a.status='official' AND other.id<>? AND other.day=? AND other.slot=? LIMIT 1`)
      .get(section.institution_id, facultyId, excludeSectionId, section.day, section.slot);
    if (collision) issues.push("Faculty member already has a section at this time.");
  }
  const workload = workloadFor(facultyId, section.institution_id).hours;
  const current = db.prepare("SELECT faculty_id FROM allocations WHERE section_id=? AND status='official'").get(excludeSectionId);
  const currentHours = current?.faculty_id === facultyId
    ? section.lecture_hours + section.tutorial_hours + section.lab_hours : 0;
  const assignmentHours = section.lecture_hours + section.tutorial_hours + section.lab_hours;
  if (workload - currentHours + assignmentHours > (person.max_hours ?? 16)) issues.push("Assignment would exceed the faculty member's maximum weekly capacity.");
  return issues;
}

app.get("/api/health", (_req, res) => res.json({ status: "ok", database: "connected" }));

app.get("/api/demo/session", authenticate, (req, res) => res.json({ user: req.user }));

app.get("/api/departments", authenticate, (req, res) => {
  const rows = db.prepare("SELECT id, name FROM departments WHERE institution_id = ? ORDER BY name").all(req.user.institution_id);
  res.json(rows.filter((row) => req.user.role !== "HOD" || row.id === req.user.department_id));
});

app.post("/api/departments", ...manager, (req, res, next) => {
  try {
    if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Only administrators can add departments" });
    const { name } = z.object({ name: z.string().trim().min(2).max(120) }).parse(req.body);
    const result = db.prepare("INSERT INTO departments (institution_id, name) VALUES (?, ?)").run(req.user.institution_id, name);
    const record = { id: Number(result.lastInsertRowid), name };
    audit(req.user.id, req.user.institution_id, "create", "department", record.id, null, record);
    res.status(201).json(record);
  } catch (error) { next(error); }
});

app.patch("/api/departments/:id", ...manager, (req, res, next) => {
  try {
    if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Only administrators can edit departments" });
    const id = idParam(req);
    const current = db.prepare("SELECT * FROM departments WHERE id=? AND institution_id=?").get(id, req.user.institution_id);
    if (!current) return res.status(404).json({ error: "Department not found" });
    const { name } = z.object({ name: z.string().trim().min(2).max(120) }).parse(req.body);
    db.prepare("UPDATE departments SET name=? WHERE id=?").run(name, id);
    audit(req.user.id, req.user.institution_id, "update", "department", id, current, { id, name });
    res.json({ id, name });
  } catch (error) { next(error); }
});

app.delete("/api/departments/:id", ...manager, (req, res, next) => {
  try {
    if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Only administrators can delete departments" });
    const id = idParam(req);
    const current = db.prepare("SELECT * FROM departments WHERE id=? AND institution_id=?").get(id, req.user.institution_id);
    if (!current) return res.status(404).json({ error: "Department not found" });
    const dependent = db.prepare(`SELECT
      (SELECT COUNT(*) FROM users WHERE department_id=?) +
      (SELECT COUNT(*) FROM courses WHERE department_id=?) AS total`).get(id, id).total;
    if (dependent) return res.status(409).json({ error: "Move or remove faculty and courses before deleting this department" });
    db.prepare("DELETE FROM departments WHERE id=?").run(id);
    audit(req.user.id, req.user.institution_id, "delete", "department", id, current, null);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get("/api/hods", authenticate, allowRoles("ADMIN"), (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.name, u.email, u.department_id AS departmentId, d.name AS department
    FROM users u LEFT JOIN departments d ON d.id=u.department_id
    WHERE u.institution_id=? AND u.role='HOD' ORDER BY u.name`).all(req.user.institution_id));
});

app.post("/api/hods", authenticate, allowRoles("ADMIN"), (req, res, next) => {
  try {
    const data = z.object({
      name: z.string().trim().min(2).max(100),
      email: z.string().email().transform((value) => value.toLowerCase()),
      password: z.string().min(10).max(128),
      departmentId: z.coerce.number().int().positive()
    }).parse(req.body);
    if (!assertDepartmentAccess(req, res, data.departmentId)) return;
    const created = db.prepare(`INSERT INTO users(institution_id, department_id, name, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?, 'HOD')`).run(req.user.institution_id, data.departmentId, data.name, data.email, bcrypt.hashSync(data.password, 12));
    const id = Number(created.lastInsertRowid);
    audit(req.user.id, req.user.institution_id, "create", "department_head", id, null, { name: data.name, email: data.email, departmentId: data.departmentId });
    res.status(201).json({ id, name: data.name, email: data.email, departmentId: data.departmentId });
  } catch (error) { next(error); }
});

app.patch("/api/hods/:id", authenticate, allowRoles("ADMIN"), (req, res, next) => {
  try {
    const id = idParam(req);
    const current = db.prepare("SELECT * FROM users WHERE id=? AND institution_id=? AND role='HOD'").get(id, req.user.institution_id);
    if (!current) return res.status(404).json({ error: "Department head not found" });
    const data = z.object({ name: z.string().trim().min(2).max(100).optional(), departmentId: z.coerce.number().int().positive().optional() }).parse(req.body);
    if (data.departmentId && !assertDepartmentAccess(req, res, data.departmentId)) return;
    if (data.departmentId && data.departmentId !== current.department_id) {
      const count = db.prepare("SELECT COUNT(*) AS total FROM recommendations WHERE created_by=? OR reviewed_by=?").get(id, id).total;
      if (count) return res.status(409).json({ error: "Department head cannot be moved while recommendation history exists" });
    }
    db.prepare("UPDATE users SET name=?, department_id=? WHERE id=?").run(data.name ?? current.name, data.departmentId ?? current.department_id, id);
    audit(req.user.id, req.user.institution_id, "update", "department_head", id, { name: current.name, departmentId: current.department_id }, data);
    res.json({ id, name: data.name ?? current.name, departmentId: data.departmentId ?? current.department_id });
  } catch (error) { next(error); }
});

app.delete("/api/hods/:id", authenticate, allowRoles("ADMIN"), (req, res, next) => {
  try {
    const id = idParam(req);
    const current = db.prepare("SELECT id, name, email, department_id FROM users WHERE id=? AND institution_id=? AND role='HOD'").get(id, req.user.institution_id);
    if (!current) return res.status(404).json({ error: "Department head not found" });
    const recommendations = db.prepare("SELECT COUNT(*) AS total FROM recommendations WHERE created_by=? OR reviewed_by=?").get(id, id).total;
    if (recommendations) return res.status(409).json({ error: "Department head cannot be removed while recommendation history exists" });
    db.prepare("DELETE FROM users WHERE id=?").run(id);
    audit(req.user.id, req.user.institution_id, "delete", "department_head", id, current, null);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get("/api/faculty", authenticate, (req, res) => {
  let where = "u.institution_id = ? AND u.role = 'FACULTY'";
  const params = [req.user.institution_id];
  if (req.user.role === "HOD") { where += " AND u.department_id = ?"; params.push(req.user.department_id); }
  if (req.user.role === "FACULTY") { where += " AND u.id = ?"; params.push(req.user.id); }
  const rows = db.prepare(`SELECT u.id, u.name, u.email, u.department_id AS departmentId, d.name AS department,
    p.designation, p.min_hours AS minHours, p.max_hours AS maxHours
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN faculty_profiles p ON p.user_id = u.id WHERE ${where} ORDER BY u.name`).all(...params);
  res.json(rows.map((faculty) => ({
    ...faculty,
    expertise: db.prepare("SELECT subject FROM expertise WHERE faculty_id = ? ORDER BY subject").all(faculty.id).map((r) => r.subject),
    availability: db.prepare("SELECT day, slot, available FROM availability WHERE faculty_id = ? ORDER BY day, slot").all(faculty.id)
  })));
});

app.post("/api/faculty", ...manager, (req, res, next) => {
  try {
    const data = z.object({
      name: z.string().trim().min(2).max(100), email: z.string().email().transform((v) => v.toLowerCase()),
      password: z.string().min(10).max(128), departmentId: z.coerce.number().int().positive(),
      designation: z.string().trim().min(2).max(80).default("Faculty"),
      minHours: z.coerce.number().min(0).max(80).default(8), maxHours: z.coerce.number().min(1).max(80).default(16),
      expertise: z.array(z.string().trim().min(1).max(100)).default([])
    }).parse(req.body);
    if (!assertDepartmentAccess(req, res, data.departmentId)) return;
    if (data.minHours > data.maxHours) return res.status(400).json({ error: "Minimum hours cannot exceed maximum hours" });
    const id = db.transaction(() => {
      const added = db.prepare(`INSERT INTO users
        (institution_id, department_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, 'FACULTY')`)
        .run(req.user.institution_id, data.departmentId, data.name, data.email, bcrypt.hashSync(data.password, 12));
      const userId = Number(added.lastInsertRowid);
      db.prepare("INSERT INTO faculty_profiles (user_id, designation, min_hours, max_hours) VALUES (?, ?, ?, ?)")
        .run(userId, data.designation, data.minHours, data.maxHours);
      const insertExpertise = db.prepare("INSERT OR IGNORE INTO expertise (faculty_id, subject) VALUES (?, ?)");
      data.expertise.forEach((subject) => insertExpertise.run(userId, subject));
      return userId;
    })();
    audit(req.user.id, req.user.institution_id, "create", "faculty", id, null, { name: data.name, email: data.email });
    res.status(201).json({ id, name: data.name, email: data.email, departmentId: data.departmentId, designation: data.designation, minHours: data.minHours, maxHours: data.maxHours, expertise: data.expertise });
  } catch (error) { next(error); }
});

app.patch("/api/faculty/:id", ...manager, (req, res, next) => {
  try {
    const id = idParam(req);
    const current = db.prepare("SELECT * FROM users WHERE id = ? AND institution_id = ? AND role = 'FACULTY'").get(id, req.user.institution_id);
    if (!current) return res.status(404).json({ error: "Faculty member not found" });
    if (!assertDepartmentAccess(req, res, current.department_id)) return;
    const currentProfile = db.prepare("SELECT * FROM faculty_profiles WHERE user_id=?").get(id)
      ?? { designation: "Faculty", min_hours: 8, max_hours: 16 };
    const data = z.object({
      name: z.string().trim().min(2).max(100).optional(),
      departmentId: z.coerce.number().int().positive().optional(),
      designation: z.string().trim().min(2).max(80).optional(),
      minHours: z.coerce.number().min(0).max(80).optional(),
      maxHours: z.coerce.number().min(1).max(80).optional(),
      expertise: z.array(z.string().trim().min(1).max(100)).optional()
    }).parse(req.body);
    if (data.departmentId && !assertDepartmentAccess(req, res, data.departmentId)) return;
    const nextMin = data.minHours ?? currentProfile.min_hours;
    const nextMax = data.maxHours ?? currentProfile.max_hours;
    if (nextMin > nextMax) return res.status(400).json({ error: "Minimum hours cannot exceed maximum hours" });
    db.transaction(() => {
      db.prepare(`UPDATE users SET name = ?, department_id = ? WHERE id = ?`).run(data.name ?? current.name, data.departmentId ?? current.department_id, id);
      if (data.designation !== undefined || data.minHours !== undefined || data.maxHours !== undefined) {
        db.prepare(`INSERT INTO faculty_profiles(user_id, designation, min_hours, max_hours) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET designation=excluded.designation, min_hours=excluded.min_hours, max_hours=excluded.max_hours`)
          .run(id, data.designation ?? currentProfile.designation, nextMin, nextMax);
      }
      if (data.expertise) {
        db.prepare("DELETE FROM expertise WHERE faculty_id = ?").run(id);
        const insert = db.prepare("INSERT INTO expertise (faculty_id, subject) VALUES (?, ?)");
        data.expertise.forEach((subject) => insert.run(id, subject));
      }
    })();
    const after = db.prepare("SELECT id, name, email, department_id AS departmentId FROM users WHERE id = ?").get(id);
    audit(req.user.id, req.user.institution_id, "update", "faculty", id, { name: current.name, departmentId: current.department_id }, after);
    res.json(after);
  } catch (error) { next(error); }
});

app.delete("/api/faculty/:id", ...manager, (req, res, next) => {
  try {
    const id = idParam(req);
    const current = db.prepare("SELECT id, name, email, department_id FROM users WHERE id=? AND institution_id=? AND role='FACULTY'").get(id, req.user.institution_id);
    if (!current) return res.status(404).json({ error: "Faculty member not found" });
    if (!assertDepartmentAccess(req, res, current.department_id)) return;
    db.prepare("DELETE FROM users WHERE id=?").run(id);
    audit(req.user.id, req.user.institution_id, "delete", "faculty", id, current, null);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get("/api/courses", authenticate, (req, res) => {
  let sql = `SELECT c.id, c.code, c.name, c.subject, c.department_id AS departmentId, d.name AS department
    FROM courses c JOIN departments d ON d.id = c.department_id WHERE c.institution_id = ?`;
  const params = [req.user.institution_id];
  if (req.user.role === "HOD") { sql += " AND c.department_id = ?"; params.push(req.user.department_id); }
  if (req.user.role === "FACULTY") sql += " AND c.department_id = ?";
  if (req.user.role === "FACULTY") params.push(req.user.department_id);
  res.json(db.prepare(`${sql} ORDER BY c.code`).all(...params));
});

app.post("/api/courses", ...manager, (req, res, next) => {
  try {
    const data = z.object({
      code: z.string().trim().min(2).max(20), name: z.string().trim().min(2).max(120),
      subject: z.string().trim().min(2).max(100), departmentId: z.coerce.number().int().positive()
    }).parse(req.body);
    if (!assertDepartmentAccess(req, res, data.departmentId)) return;
    const added = db.prepare(`INSERT INTO courses (institution_id, department_id, code, name, subject) VALUES (?, ?, ?, ?, ?)`)
      .run(req.user.institution_id, data.departmentId, data.code, data.name, data.subject);
    const id = Number(added.lastInsertRowid);
    audit(req.user.id, req.user.institution_id, "create", "course", id, null, data);
    res.status(201).json({ id, ...data });
  } catch (error) { next(error); }
});

app.patch("/api/courses/:id", ...manager, (req, res, next) => {
  try {
    const id = idParam(req);
    const current = db.prepare("SELECT * FROM courses WHERE id=? AND institution_id=?").get(id, req.user.institution_id);
    if (!current) return res.status(404).json({ error: "Course not found" });
    if (!assertDepartmentAccess(req, res, current.department_id)) return;
    const data = z.object({
      code: z.string().trim().min(2).max(20).optional(), name: z.string().trim().min(2).max(120).optional(),
      subject: z.string().trim().min(2).max(100).optional(), departmentId: z.coerce.number().int().positive().optional()
    }).parse(req.body);
    if (data.departmentId && !assertDepartmentAccess(req, res, data.departmentId)) return;
    db.prepare("UPDATE courses SET code=?, name=?, subject=?, department_id=? WHERE id=?")
      .run(data.code ?? current.code, data.name ?? current.name, data.subject ?? current.subject, data.departmentId ?? current.department_id, id);
    const after = db.prepare("SELECT * FROM courses WHERE id=?").get(id);
    audit(req.user.id, req.user.institution_id, "update", "course", id, current, after);
    res.json(after);
  } catch (error) { next(error); }
});

app.delete("/api/courses/:id", ...manager, (req, res, next) => {
  try {
    const id = idParam(req);
    const current = db.prepare("SELECT * FROM courses WHERE id=? AND institution_id=?").get(id, req.user.institution_id);
    if (!current) return res.status(404).json({ error: "Course not found" });
    if (!assertDepartmentAccess(req, res, current.department_id)) return;
    db.prepare("DELETE FROM courses WHERE id=?").run(id);
    audit(req.user.id, req.user.institution_id, "delete", "course", id, current, null);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get("/api/sections", authenticate, (req, res) => {
  let sql = `SELECT s.id, s.section_name AS sectionName, s.course_id AS courseId, c.code AS courseCode, c.name AS courseName,
    c.subject, s.lecture_hours AS lectureHours, s.tutorial_hours AS tutorialHours, s.lab_hours AS labHours,
    s.day, s.slot, s.term, u.id AS facultyId, u.name AS facultyName
    FROM sections s JOIN courses c ON c.id = s.course_id
    LEFT JOIN allocations a ON a.section_id = s.id AND a.status = 'official'
    LEFT JOIN users u ON u.id = a.faculty_id WHERE s.institution_id = ?`;
  const params = [req.user.institution_id];
  if (req.user.role === "HOD") { sql += " AND c.department_id = ?"; params.push(req.user.department_id); }
  if (req.user.role === "FACULTY") { sql += " AND a.faculty_id = ?"; params.push(req.user.id); }
  res.json(db.prepare(`${sql} ORDER BY c.code, s.section_name`).all(...params));
});

app.post("/api/sections", ...manager, (req, res, next) => {
  try {
    const data = z.object({
      courseId: z.coerce.number().int().positive(), sectionName: z.string().trim().min(1).max(20),
      lectureHours: z.coerce.number().min(0).max(40).default(0), tutorialHours: z.coerce.number().min(0).max(40).default(0),
      labHours: z.coerce.number().min(0).max(40).default(0), day: z.string().max(20).nullable().default(null),
      slot: z.string().max(30).nullable().default(null), term: z.string().trim().min(1).max(50).default("Current")
    }).parse(req.body);
    const course = db.prepare("SELECT * FROM courses WHERE id = ? AND institution_id = ?").get(data.courseId, req.user.institution_id);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (!assertDepartmentAccess(req, res, course.department_id)) return;
    const result = db.prepare(`INSERT INTO sections
      (institution_id, course_id, section_name, lecture_hours, tutorial_hours, lab_hours, day, slot, term)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user.institution_id, data.courseId, data.sectionName, data.lectureHours, data.tutorialHours,
        data.labHours, data.day, data.slot, data.term);
    const id = Number(result.lastInsertRowid);
    audit(req.user.id, req.user.institution_id, "create", "section", id, null, data);
    res.status(201).json({ id, ...data, courseCode: course.code, courseName: course.name });
  } catch (error) { next(error); }
});

app.patch("/api/sections/:id", ...manager, (req, res, next) => {
  try {
    const id = idParam(req);
    const current = db.prepare(`SELECT s.*, c.department_id FROM sections s JOIN courses c ON c.id=s.course_id
      WHERE s.id=? AND s.institution_id=?`).get(id, req.user.institution_id);
    if (!current) return res.status(404).json({ error: "Section not found" });
    if (!assertDepartmentAccess(req, res, current.department_id)) return;
    const data = z.object({
      lectureHours: z.coerce.number().min(0).max(40).optional(), tutorialHours: z.coerce.number().min(0).max(40).optional(),
      labHours: z.coerce.number().min(0).max(40).optional(), day: z.string().max(20).nullable().optional(),
      slot: z.string().max(30).nullable().optional(), term: z.string().trim().min(1).max(50).optional()
    }).parse(req.body);
    db.prepare(`UPDATE sections SET lecture_hours=?, tutorial_hours=?, lab_hours=?, day=?, slot=?, term=? WHERE id=?`)
      .run(data.lectureHours ?? current.lecture_hours, data.tutorialHours ?? current.tutorial_hours, data.labHours ?? current.lab_hours,
        data.day === undefined ? current.day : data.day, data.slot === undefined ? current.slot : data.slot, data.term ?? current.term, id);
    const after = db.prepare("SELECT * FROM sections WHERE id=?").get(id);
    audit(req.user.id, req.user.institution_id, "update", "section", id, current, after);
    res.json(after);
  } catch (error) { next(error); }
});

app.delete("/api/sections/:id", ...manager, (req, res, next) => {
  try {
    const id = idParam(req);
    const current = db.prepare(`SELECT s.*, c.department_id FROM sections s JOIN courses c ON c.id=s.course_id
      WHERE s.id=? AND s.institution_id=?`).get(id, req.user.institution_id);
    if (!current) return res.status(404).json({ error: "Section not found" });
    if (!assertDepartmentAccess(req, res, current.department_id)) return;
    db.prepare("DELETE FROM sections WHERE id=?").run(id);
    audit(req.user.id, req.user.institution_id, "delete", "section", id, current, null);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get("/api/duties", authenticate, (req, res) => {
  let sql = `SELECT ad.id, ad.faculty_id AS facultyId, u.name AS facultyName, ad.title, ad.hours_per_week AS hoursPerWeek, ad.counted
    FROM additional_duties ad JOIN users u ON u.id=ad.faculty_id WHERE ad.institution_id=?`;
  const params = [req.user.institution_id];
  if (req.user.role === "FACULTY") { sql += " AND ad.faculty_id=?"; params.push(req.user.id); }
  if (req.user.role === "HOD") { sql += " AND u.department_id=?"; params.push(req.user.department_id); }
  res.json(db.prepare(`${sql} ORDER BY u.name, ad.title`).all(...params));
});

app.post("/api/duties", ...manager, (req, res, next) => {
  try {
    const data = z.object({
      facultyId: z.coerce.number().int().positive(), title: z.string().trim().min(2).max(120),
      hoursPerWeek: z.coerce.number().min(0).max(80), counted: z.coerce.boolean().default(true)
    }).parse(req.body);
    const faculty = db.prepare("SELECT * FROM users WHERE id=? AND institution_id=? AND role='FACULTY'").get(data.facultyId, req.user.institution_id);
    if (!faculty) return res.status(404).json({ error: "Faculty member not found" });
    if (!assertDepartmentAccess(req, res, faculty.department_id)) return;
    const result = db.prepare(`INSERT INTO additional_duties
      (institution_id, faculty_id, title, hours_per_week, counted) VALUES (?, ?, ?, ?, ?)`)
      .run(req.user.institution_id, data.facultyId, data.title, data.hoursPerWeek, Number(data.counted));
    const id = Number(result.lastInsertRowid);
    audit(req.user.id, req.user.institution_id, "create", "additional_duty", id, null, data);
    res.status(201).json({ id, ...data });
  } catch (error) { next(error); }
});

app.patch("/api/duties/:id", ...manager, (req, res, next) => {
  try {
    const id = idParam(req);
    const current = db.prepare(`SELECT ad.*, u.department_id FROM additional_duties ad JOIN users u ON u.id=ad.faculty_id
      WHERE ad.id=? AND ad.institution_id=?`).get(id, req.user.institution_id);
    if (!current) return res.status(404).json({ error: "Additional duty not found" });
    if (!assertDepartmentAccess(req, res, current.department_id)) return;
    const data = z.object({ title: z.string().trim().min(2).max(120).optional(), hoursPerWeek: z.coerce.number().min(0).max(80).optional(), counted: z.coerce.boolean().optional() }).parse(req.body);
    db.prepare("UPDATE additional_duties SET title=?, hours_per_week=?, counted=? WHERE id=?")
      .run(data.title ?? current.title, data.hoursPerWeek ?? current.hours_per_week, data.counted === undefined ? current.counted : Number(data.counted), id);
    const after = db.prepare("SELECT * FROM additional_duties WHERE id=?").get(id);
    audit(req.user.id, req.user.institution_id, "update", "additional_duty", id, current, after);
    res.json(after);
  } catch (error) { next(error); }
});

app.delete("/api/duties/:id", ...manager, (req, res, next) => {
  try {
    const id = idParam(req);
    const current = db.prepare(`SELECT ad.*, u.department_id FROM additional_duties ad JOIN users u ON u.id=ad.faculty_id
      WHERE ad.id=? AND ad.institution_id=?`).get(id, req.user.institution_id);
    if (!current) return res.status(404).json({ error: "Additional duty not found" });
    if (!assertDepartmentAccess(req, res, current.department_id)) return;
    db.prepare("DELETE FROM additional_duties WHERE id=?").run(id);
    audit(req.user.id, req.user.institution_id, "delete", "additional_duty", id, current, null);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get("/api/policy", authenticate, (req, res) => {
  const policy = db.prepare("SELECT * FROM workload_policies WHERE institution_id=?").get(req.user.institution_id);
  res.json(policy);
});

app.put("/api/policy", ...manager, (req, res, next) => {
  try {
    const data = z.object({
      balancedMin: z.coerce.number().min(0).max(80), balancedMax: z.coerce.number().min(1).max(80),
      overloadThreshold: z.coerce.number().min(1).max(100), dutyHoursCounted: z.coerce.boolean()
    }).parse(req.body);
    if (data.balancedMin > data.balancedMax || data.balancedMax > data.overloadThreshold) {
      return res.status(400).json({ error: "Workload thresholds must satisfy balanced minimum ≤ balanced maximum ≤ overload threshold" });
    }
    const before = db.prepare("SELECT * FROM workload_policies WHERE institution_id=?").get(req.user.institution_id);
    db.prepare(`UPDATE workload_policies SET balanced_min=?, balanced_max=?, overload_threshold=?, duty_hours_counted=?
      WHERE institution_id=?`).run(data.balancedMin, data.balancedMax, data.overloadThreshold, Number(data.dutyHoursCounted), req.user.institution_id);
    const after = db.prepare("SELECT * FROM workload_policies WHERE institution_id=?").get(req.user.institution_id);
    audit(req.user.id, req.user.institution_id, "update", "workload_policy", req.user.institution_id, before, after);
    res.json(after);
  } catch (error) { next(error); }
});

app.put("/api/faculty/:id/availability", authenticate, (req, res, next) => {
  try {
    const facultyId = idParam(req);
    if (req.user.role === "FACULTY" && req.user.id !== facultyId) return res.status(403).json({ error: "You can only manage your own availability" });
    const faculty = db.prepare("SELECT * FROM users WHERE id=? AND institution_id=? AND role='FACULTY'").get(facultyId, req.user.institution_id);
    if (!faculty) return res.status(404).json({ error: "Faculty member not found" });
    if (req.user.role !== "FACULTY" && !canManageDepartment(req, faculty.department_id)) return res.status(403).json({ error: "Department access denied" });
    const slots = z.array(z.object({ day: z.string().min(1).max(20), slot: z.string().min(1).max(30), available: z.coerce.boolean() })).max(100).parse(req.body.slots);
    db.transaction(() => {
      db.prepare("DELETE FROM availability WHERE faculty_id=?").run(facultyId);
      const insert = db.prepare("INSERT INTO availability(faculty_id, day, slot, available) VALUES (?, ?, ?, ?)");
      slots.forEach((item) => insert.run(facultyId, item.day, item.slot, Number(item.available)));
    })();
    audit(req.user.id, req.user.institution_id, "update", "availability", facultyId, null, slots);
    res.json({ facultyId, slots });
  } catch (error) { next(error); }
});

app.get("/api/faculty/:id/availability", authenticate, (req, res) => {
  const facultyId = idParam(req);
  if (req.user.role === "FACULTY" && req.user.id !== facultyId) return res.status(403).json({ error: "You can only view your own availability" });
  const faculty = db.prepare("SELECT id, department_id FROM users WHERE id=? AND institution_id=? AND role='FACULTY'").get(facultyId, req.user.institution_id);
  if (!faculty) return res.status(404).json({ error: "Faculty member not found" });
  if (req.user.role !== "FACULTY" && !canManageDepartment(req, faculty.department_id)) return res.status(403).json({ error: "Department access denied" });
  res.json({ facultyId, slots: db.prepare("SELECT day, slot, available FROM availability WHERE faculty_id=? ORDER BY day, slot").all(facultyId) });
});

app.get("/api/dashboard", authenticate, (req, res) => {
  let facultySql = "SELECT id, name, department_id FROM users WHERE institution_id=? AND role='FACULTY'";
  const facultyParams = [req.user.institution_id];
  if (req.user.role === "FACULTY") { facultySql += " AND id=?"; facultyParams.push(req.user.id); }
  if (req.user.role === "HOD") { facultySql += " AND department_id=?"; facultyParams.push(req.user.department_id); }
  const faculty = db.prepare(facultySql).all(...facultyParams);
  const workloads = faculty.map((person) => ({ id: person.id, name: person.name, departmentId: person.department_id, ...workloadFor(person.id, req.user.institution_id) }));
  const sectionFilter = req.user.role === "FACULTY" ? " AND a.faculty_id=?" : req.user.role === "HOD" ? " AND c.department_id=?" : "";
  const sectionParam = req.user.role === "FACULTY" ? req.user.id : req.user.department_id;
  const workloadStats = {
    faculty: workloads.length,
    balanced: workloads.filter((item) => item.status === "Balanced").length,
    underloaded: workloads.filter((item) => item.status === "Underloaded").length,
    highWorkload: workloads.filter((item) => item.status === "High Workload").length
  };
  const sectionCounts = db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN a.faculty_id IS NOT NULL THEN 1 ELSE 0 END) AS assigned
    FROM sections s JOIN courses c ON c.id=s.course_id
    LEFT JOIN allocations a ON a.section_id=s.id AND a.status='official'
    WHERE s.institution_id=?${sectionFilter}`).get(req.user.institution_id, ...(sectionFilter ? [sectionParam] : []));
  const pending = req.user.role === "FACULTY" ? 0 : req.user.role === "HOD"
    ? db.prepare(`SELECT COUNT(*) AS total FROM recommendations r JOIN users u ON u.id=r.created_by
      WHERE r.institution_id=? AND r.status='pending' AND u.role='HOD' AND u.department_id=?`)
      .get(req.user.institution_id, req.user.department_id).total
    : db.prepare("SELECT COUNT(*) AS total FROM recommendations WHERE institution_id=? AND status='pending'").get(req.user.institution_id).total;
  const ml = { status: "check ML service on the ML status page", endpoint: process.env.ML_SERVICE_URL ?? "http://127.0.0.1:8000" };
  res.json({
    role: req.user.role, workloadStats, workloads,
    allocations: { totalSections: sectionCounts.total ?? 0, assigned: sectionCounts.assigned ?? 0 },
    pendingApprovals: pending, ml
  });
});

app.get("/api/workloads", authenticate, (req, res) => {
  let sql = "SELECT id, name, department_id FROM users WHERE institution_id=? AND role='FACULTY'";
  const params = [req.user.institution_id];
  if (req.user.role === "FACULTY") { sql += " AND id=?"; params.push(req.user.id); }
  if (req.user.role === "HOD") { sql += " AND department_id=?"; params.push(req.user.department_id); }
  const rows = db.prepare(sql).all(...params).map((person) => ({ id: person.id, name: person.name, departmentId: person.department_id, ...workloadFor(person.id, req.user.institution_id) }));
  res.json(rows);
});

app.post("/api/workflows/analyze", ...manager, (req, res) => {
  const assignedCount = db.prepare(`SELECT COUNT(*) AS total FROM allocations a
    JOIN sections s ON s.id=a.section_id JOIN courses c ON c.id=s.course_id
    WHERE a.institution_id=? AND a.status='official'${req.user.role === "HOD" ? " AND c.department_id=?" : ""}`)
    .get(...(req.user.role === "HOD" ? [req.user.institution_id, req.user.department_id] : [req.user.institution_id])).total;
  if (!assignedCount) return res.status(400).json({ error: "Analyze existing workload requires at least one official allocation in your authorized scope." });
  const workloads = db.prepare(`SELECT id, name, department_id FROM users
    WHERE institution_id=? AND role='FACULTY'${req.user.role === "HOD" ? " AND department_id=?" : ""}`)
    .all(...(req.user.role === "HOD" ? [req.user.institution_id, req.user.department_id] : [req.user.institution_id]))
    .map((person) => {
      const workload = workloadFor(person.id, req.user.institution_id);
      const recommendations = [];
      if (workload.status === "High Workload") recommendations.push(workload.overThreshold
        ? "Workload is above the institutional overload alert threshold; review duties or reassign a compatible section."
        : "Workload is above the balanced range; review duties or reassign a compatible section.");
      if (workload.status === "Underloaded") recommendations.push("Consider assigning a compatible unallocated section.");
      if (workload.status === "Balanced") recommendations.push("No workload change recommended.");
      return { facultyId: person.id, name: person.name, ...workload, recommendations };
    });
  const missing = db.prepare(`SELECT COUNT(*) AS total FROM sections s
    LEFT JOIN allocations a ON a.section_id=s.id AND a.status='official'
    JOIN courses c ON c.id=s.course_id WHERE s.institution_id=? AND a.id IS NULL
    ${req.user.role === "HOD" ? "AND c.department_id=?" : ""}`)
    .get(...(req.user.role === "HOD" ? [req.user.institution_id, req.user.department_id] : [req.user.institution_id])).total;
  res.json({ workloads, unallocatedSections: missing, message: missing ? "Existing allocation analysis includes unallocated sections." : "Analysis uses official allocations and institution workload policy." });
});

app.post("/api/workflows/generate", ...manager, (req, res, next) => {
  try {
    const departmentClause = req.user.role === "HOD" ? " AND c.department_id=?" : "";
    const params = req.user.role === "HOD" ? [req.user.institution_id, req.user.department_id] : [req.user.institution_id];
    const sections = db.prepare(`SELECT s.*, c.code AS course_code, c.name AS course_name, c.subject, c.department_id FROM sections s
      JOIN courses c ON c.id=s.course_id WHERE s.institution_id=? ${departmentClause}
      ORDER BY (s.lecture_hours+s.tutorial_hours+s.lab_hours) DESC, s.id`).all(...params);
    const facultySql = `SELECT u.id, u.name, u.department_id, p.min_hours, p.max_hours FROM users u
      LEFT JOIN faculty_profiles p ON p.user_id=u.id WHERE u.institution_id=? AND u.role='FACULTY'${req.user.role === "HOD" ? " AND u.department_id=?" : ""}`;
    const faculty = db.prepare(facultySql).all(...params);
    const official = db.prepare(`SELECT a.section_id, a.faculty_id FROM allocations a
      JOIN sections s ON s.id=a.section_id JOIN courses c ON c.id=s.course_id
      WHERE a.institution_id=? AND a.status='official'${req.user.role === "HOD" ? " AND c.department_id=?" : ""}`).all(...params);
    const previous = new Map(official.map((item) => [item.section_id, item.faculty_id]));
    const sectionsById = new Map(sections.map((section) => [section.id, section]));
    const loads = new Map(faculty.map((person) => [person.id, workloadFor(person.id, req.user.institution_id).hours]));
    for (const assignment of official) {
      const currentSection = sectionsById.get(assignment.section_id);
      if (currentSection) {
        const teaching = currentSection.lecture_hours + currentSection.tutorial_hours + currentSection.lab_hours;
        loads.set(assignment.faculty_id, (loads.get(assignment.faculty_id) ?? 0) - teaching);
      }
    }
    const slotUse = new Set();
    const proposals = [];
    for (const section of sections) {
      const hours = section.lecture_hours + section.tutorial_hours + section.lab_hours;
      const currentId = previous.get(section.id) ?? null;
      const current = faculty.find((item) => item.id === currentId);
      const candidates = faculty.map((person) => {
        const expertise = db.prepare("SELECT 1 FROM expertise WHERE faculty_id=? AND lower(subject)=lower(?)").get(person.id, section.subject);
        const availability = section.day && section.slot ? db.prepare(`SELECT available FROM availability
          WHERE faculty_id=? AND day=? AND slot=?`).get(person.id, section.day, section.slot) : null;
        const available = !availability || availability.available === 1;
        const collision = section.day && section.slot && slotUse.has(`${person.id}:${section.day}:${section.slot}`);
        const capacity = (person.max_hours ?? 16) - (loads.get(person.id) ?? 0) >= hours;
        if (person.department_id !== section.department_id || !expertise || !available || collision || !capacity) return null;
        const keepBonus = person.id === currentId ? -1000 : 0;
        return { person, score: (loads.get(person.id) ?? 0) + hours + keepBonus };
      }).filter(Boolean).sort((a, b) => a.score - b.score);
      const chosen = candidates[0]?.person ?? null;
      const suggestedId = chosen?.id ?? null;
      if (chosen) {
        loads.set(chosen.id, (loads.get(chosen.id) ?? 0) + hours);
        if (section.day && section.slot) slotUse.add(`${chosen.id}:${section.day}:${section.slot}`);
      }
      const reason = !chosen
        ? "No faculty member met expertise, availability, timetable and capacity constraints."
        : chosen.id === currentId ? "Kept the current assignment; it remains feasible and minimizes changes."
          : `Assigned by subject expertise, availability and remaining workload capacity${currentId ? "; the previous assignment was not feasible" : ""}.`;
      proposals.push({
        sectionId: section.id, sectionName: `${section.course_code}-${section.section_name} · ${section.course_name}`,
        facultyId: suggestedId, facultyName: chosen?.name ?? null, previousFacultyId: currentId,
        previousFacultyName: current?.name ?? null, hours, reason, feasible: Boolean(chosen)
      });
    }
    const recommendationId = db.transaction(() => {
      const created = db.prepare(`INSERT INTO recommendations(institution_id, created_by, summary)
        VALUES (?, ?, ?)`).run(req.user.institution_id, req.user.id, `${proposals.filter((item) => item.feasible).length} of ${proposals.length} sections assigned`);
      const id = Number(created.lastInsertRowid);
      const insert = db.prepare(`INSERT INTO recommendation_items
        (recommendation_id, section_id, faculty_id, previous_faculty_id, reason) VALUES (?, ?, ?, ?, ?)`);
      proposals.forEach((item) => insert.run(id, item.sectionId, item.facultyId, item.previousFacultyId, item.reason));
      return id;
    })();
    audit(req.user.id, req.user.institution_id, "generate", "recommendation", recommendationId, null, { count: proposals.length });
    res.status(201).json({
      recommendationId, proposals, unassigned: proposals.filter((item) => !item.feasible),
      notice: "Heuristic recommendations only; results are not guaranteed optimal. Official allocations change only after approval."
    });
  } catch (error) { next(error); }
});

app.get("/api/recommendations", ...manager, (req, res) => {
  const rows = db.prepare(`SELECT r.id, r.status, r.summary, r.created_at AS createdAt, u.name AS createdBy
    FROM recommendations r JOIN users u ON u.id=r.created_by
    WHERE r.institution_id=? AND (?='ADMIN' OR (u.role='HOD' AND u.department_id=?))
    ORDER BY r.created_at DESC`).all(req.user.institution_id, req.user.role, req.user.department_id);
  res.json(rows);
});

app.get("/api/recommendations/:id", ...manager, (req, res) => {
  const rec = db.prepare(`SELECT r.*, u.department_id, u.role AS creator_role FROM recommendations r JOIN users u ON u.id=r.created_by
    WHERE r.id=? AND r.institution_id=?`).get(idParam(req), req.user.institution_id);
  if (!rec) return res.status(404).json({ error: "Recommendation not found" });
  if (req.user.role === "HOD" && (rec.creator_role !== "HOD" || rec.department_id !== req.user.department_id)) return res.status(403).json({ error: "Department access denied" });
  const items = db.prepare(`SELECT ri.id, ri.section_id AS sectionId, s.section_name AS sectionName,
    c.code AS courseCode, c.name AS courseName, c.subject,
    ri.faculty_id AS facultyId, f.name AS facultyName, ri.previous_faculty_id AS previousFacultyId,
    p.name AS previousFacultyName, ri.reason
    FROM recommendation_items ri JOIN sections s ON s.id=ri.section_id JOIN courses c ON c.id=s.course_id
    LEFT JOIN users f ON f.id=ri.faculty_id LEFT JOIN users p ON p.id=ri.previous_faculty_id
    WHERE ri.recommendation_id=? ORDER BY ri.id`).all(rec.id);
  res.json({ id: rec.id, status: rec.status, summary: rec.summary, items });
});

app.patch("/api/recommendations/:id/items/:itemId", ...manager, (req, res, next) => {
  try {
    const data = z.object({ facultyId: z.coerce.number().int().positive().nullable() }).parse(req.body);
    const recommendation = db.prepare("SELECT * FROM recommendations WHERE id=? AND institution_id=?").get(idParam(req), req.user.institution_id);
    if (!recommendation || recommendation.status !== "pending") return res.status(404).json({ error: "Pending recommendation not found" });
    const item = db.prepare(`SELECT ri.*, c.department_id FROM recommendation_items ri
      JOIN sections s ON s.id=ri.section_id JOIN courses c ON c.id=s.course_id
      WHERE ri.id=? AND ri.recommendation_id=?`).get(idParam({ params: { id: req.params.itemId } }), recommendation.id);
    if (!item) return res.status(404).json({ error: "Recommendation item not found" });
    if (!assertDepartmentAccess(req, res, item.department_id)) return;
    if (data.facultyId !== null) {
      const faculty = db.prepare("SELECT id FROM users WHERE id=? AND institution_id=? AND role='FACULTY'").get(data.facultyId, req.user.institution_id);
      if (!faculty) return res.status(400).json({ error: "Faculty member does not belong to this institution" });
      const assignee = db.prepare("SELECT department_id FROM users WHERE id=?").get(data.facultyId);
      if (assignee.department_id !== item.department_id) return res.status(400).json({ error: "Faculty member must belong to the section's department" });
      if (req.user.role === "HOD") {
        if (assignee.department_id !== req.user.department_id) return res.status(403).json({ error: "Faculty member is outside your department" });
      }
      const section = db.prepare(`SELECT s.*, c.subject, c.department_id FROM sections s JOIN courses c ON c.id=s.course_id WHERE s.id=?`).get(item.section_id);
      const violations = allocationViolations(section, data.facultyId);
      if (violations.length) return res.status(400).json({ error: "Assignment violates constraints", details: violations });
    }
    db.prepare("UPDATE recommendation_items SET faculty_id=?, reason='Manually adjusted by reviewer.' WHERE id=?").run(data.facultyId, item.id);
    res.json({ updated: true });
  } catch (error) { next(error); }
});

app.post("/api/recommendations/:id/review", ...manager, (req, res, next) => {
  try {
    const { decision } = z.object({ decision: z.enum(["approve", "reject"]) }).parse(req.body);
    const recommendation = db.prepare(`SELECT r.*, u.department_id, u.role AS creator_role FROM recommendations r JOIN users u ON u.id=r.created_by
      WHERE r.id=? AND r.institution_id=?`).get(idParam(req), req.user.institution_id);
    if (!recommendation || recommendation.status !== "pending") return res.status(404).json({ error: "Pending recommendation not found" });
    if (req.user.role === "HOD" && (recommendation.creator_role !== "HOD" || recommendation.department_id !== req.user.department_id)) return res.status(403).json({ error: "Department access denied" });
    if (req.user.role === "HOD") {
      const outsideDepartment = db.prepare(`SELECT 1 FROM recommendation_items ri
        JOIN sections s ON s.id=ri.section_id JOIN courses c ON c.id=s.course_id
        WHERE ri.recommendation_id=? AND c.department_id<>? LIMIT 1`).get(recommendation.id, req.user.department_id);
      if (outsideDepartment) return res.status(403).json({ error: "Recommendation includes a section outside your department" });
    }
    const result = db.transaction(() => {
      const items = db.prepare(`SELECT ri.*, s.institution_id FROM recommendation_items ri JOIN sections s ON s.id=ri.section_id
        WHERE ri.recommendation_id=?`).all(recommendation.id);
      let changedCount = 0;
      if (decision === "approve") {
        const changes = items.filter((item) => item.previous_faculty_id !== item.faculty_id);
        changedCount = changes.length;
        for (const item of changes) {
          const current = db.prepare("SELECT faculty_id FROM allocations WHERE section_id=? AND status='official'").get(item.section_id);
          if ((current?.faculty_id ?? null) !== item.previous_faculty_id) {
            throw Object.assign(new Error("Official allocation changed since this recommendation was created; regenerate the recommendation."), { status: 409 });
          }
        }
        const beforeBySection = new Map(changes.map((item) => [item.section_id,
          db.prepare("SELECT * FROM allocations WHERE section_id=? AND status='official'").get(item.section_id) ?? null]));
        db.prepare(`DELETE FROM allocations WHERE status='official' AND section_id IN
          (SELECT ri.section_id FROM recommendation_items ri WHERE ri.recommendation_id=?
            AND ri.previous_faculty_id IS NOT ri.faculty_id)`).run(recommendation.id);
        for (const item of changes) {
          if (item.faculty_id !== null) {
            const section = db.prepare(`SELECT s.*, c.subject, c.department_id FROM sections s
              JOIN courses c ON c.id=s.course_id WHERE s.id=?`).get(item.section_id);
            const violations = allocationViolations(section, item.faculty_id);
            if (violations.length) throw Object.assign(new Error(`Cannot approve assignment for section ${section.section_name}: ${violations.join(" ")}`), { status: 400 });
            db.prepare(`INSERT INTO allocations(institution_id, section_id, faculty_id, status, source)
              VALUES (?, ?, ?, 'official', 'approved-recommendation')`).run(req.user.institution_id, item.section_id, item.faculty_id);
          }
          const before = beforeBySection.get(item.section_id);
          const after = item.faculty_id === null ? null : { section_id: item.section_id, faculty_id: item.faculty_id, status: "official" };
          audit(req.user.id, req.user.institution_id, "approve_allocation_change", "allocation", item.section_id, before, after);
        }
      }
      db.prepare("UPDATE recommendations SET status=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(decision === "approve" ? "approved" : "rejected", req.user.id, recommendation.id);
      return changedCount;
    })();
    audit(req.user.id, req.user.institution_id, decision, "recommendation", recommendation.id, { status: "pending" }, { status: decision === "approve" ? "approved" : "rejected", changes: result });
    res.json({ status: decision === "approve" ? "approved" : "rejected", allocationsChanged: decision === "approve" ? result : 0 });
  } catch (error) { next(error); }
});

app.get("/api/allocations", authenticate, (req, res) => {
  let sql = `SELECT a.id, s.id AS sectionId, c.code AS courseCode, c.subject, s.section_name AS sectionName,
    s.lecture_hours AS lectureHours, s.tutorial_hours AS tutorialHours, s.lab_hours AS labHours,
    a.faculty_id AS facultyId, u.name AS facultyName, s.day, s.slot
    FROM allocations a JOIN sections s ON s.id=a.section_id JOIN courses c ON c.id=s.course_id
    JOIN users u ON u.id=a.faculty_id WHERE a.institution_id=? AND a.status='official'`;
  const params = [req.user.institution_id];
  if (req.user.role === "FACULTY") { sql += " AND a.faculty_id=?"; params.push(req.user.id); }
  if (req.user.role === "HOD") { sql += " AND c.department_id=?"; params.push(req.user.department_id); }
  res.json(db.prepare(`${sql} ORDER BY c.code, s.section_name`).all(...params));
});

app.post("/api/allocations", ...manager, (req, res, next) => {
  try {
    const data = z.object({ sectionId: z.coerce.number().int().positive(), facultyId: z.coerce.number().int().positive() }).parse(req.body);
    const section = db.prepare(`SELECT s.*, c.department_id, c.subject FROM sections s JOIN courses c ON c.id=s.course_id
      WHERE s.id=? AND s.institution_id=?`).get(data.sectionId, req.user.institution_id);
    const faculty = db.prepare("SELECT id, department_id FROM users WHERE id=? AND institution_id=? AND role='FACULTY'").get(data.facultyId, req.user.institution_id);
    if (!section || !faculty) return res.status(404).json({ error: "Section or faculty member not found" });
    if (!assertDepartmentAccess(req, res, section.department_id)) return;
    if (faculty.department_id !== section.department_id) return res.status(400).json({ error: "Cross-department allocation is not permitted" });
    const before = db.prepare("SELECT * FROM allocations WHERE section_id=? AND status='official'").get(data.sectionId);
    if (before?.faculty_id === data.facultyId) return res.status(409).json({ error: "Section is already assigned to this faculty member" });
    const violations = allocationViolations(section, data.facultyId, data.sectionId);
    if (violations.length) return res.status(400).json({ error: "Allocation violates constraints", details: violations });
    const recommendationId = db.transaction(() => {
      const created = db.prepare("INSERT INTO recommendations(institution_id, created_by, summary) VALUES (?, ?, ?)")
        .run(req.user.institution_id, req.user.id, "Manual allocation change awaiting review");
      const id = Number(created.lastInsertRowid);
      db.prepare(`INSERT INTO recommendation_items(recommendation_id, section_id, faculty_id, previous_faculty_id, reason)
        VALUES (?, ?, ?, ?, ?)`).run(id, data.sectionId, data.facultyId, before?.faculty_id ?? null,
        "Manually proposed by an authorized user; requires approval before changing the official allocation.");
      return id;
    })();
    audit(req.user.id, req.user.institution_id, "propose_manual_allocation", "allocation", data.sectionId, before, { faculty_id: data.facultyId, status: "pending", recommendationId });
    res.status(202).json({ recommendationId, status: "pending", message: "Manual allocation proposal created; official allocations are unchanged until approval." });
  } catch (error) { next(error); }
});

app.delete("/api/allocations/:sectionId", ...manager, (req, res, next) => {
  try {
    const sectionId = Number(req.params.sectionId);
    if (!Number.isInteger(sectionId) || sectionId < 1) return res.status(400).json({ error: "Invalid section id" });
    const current = db.prepare(`SELECT a.* , c.department_id FROM allocations a
      JOIN sections s ON s.id=a.section_id JOIN courses c ON c.id=s.course_id
      WHERE a.section_id=? AND a.institution_id=? AND a.status='official'`).get(sectionId, req.user.institution_id);
    if (!current) return res.status(404).json({ error: "Official allocation not found" });
    if (!assertDepartmentAccess(req, res, current.department_id)) return;
    const recommendationId = db.transaction(() => {
      const created = db.prepare("INSERT INTO recommendations(institution_id, created_by, summary) VALUES (?, ?, ?)")
        .run(req.user.institution_id, req.user.id, "Manual unassignment awaiting review");
      const id = Number(created.lastInsertRowid);
      db.prepare(`INSERT INTO recommendation_items(recommendation_id, section_id, faculty_id, previous_faculty_id, reason)
        VALUES (?, ?, NULL, ?, ?)`).run(id, sectionId, current.faculty_id,
        "Manually proposed unassignment; requires approval before the official allocation is removed.");
      return id;
    })();
    audit(req.user.id, req.user.institution_id, "propose_unassignment", "allocation", sectionId, current, { faculty_id: null, status: "pending", recommendationId });
    res.status(202).json({ recommendationId, status: "pending", message: "Unassignment proposal created; official allocations are unchanged until approval." });
  } catch (error) { next(error); }
});

app.get("/api/reports/workload.csv", authenticate, (req, res) => {
  let sql = "SELECT id, name, department_id FROM users WHERE institution_id=? AND role='FACULTY'";
  const params = [req.user.institution_id];
  if (req.user.role === "FACULTY") { sql += " AND id=?"; params.push(req.user.id); }
  if (req.user.role === "HOD") { sql += " AND department_id=?"; params.push(req.user.department_id); }
  const rows = db.prepare(sql).all(...params).map((person) => ({ name: person.name, ...workloadFor(person.id, req.user.institution_id) }));
  const csv = ["Faculty,Teaching Hours,Duty Hours,Total Hours,Status", ...rows.map((row) =>
    [row.name, row.teachingHours, row.dutyHours, row.hours, row.status].map(csvCell).join(","))].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="workload-report.csv"');
  res.send(csv);
});
function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

const importSchemas = {
  faculty: ["name", "email", "department", "designation", "minHours", "maxHours", "expertise"],
  courses: ["code", "name", "subject", "department"],
  sections: ["courseCode", "sectionName", "lectureHours", "tutorialHours", "labHours", "day", "slot", "term"],
  duties: ["email", "title", "hoursPerWeek", "counted"]
};
function validateImportRows(entity, rows, mapping) {
  const required = { faculty: ["name", "email", "department"], courses: ["code", "name", "subject", "department"], sections: ["courseCode", "sectionName"], duties: ["email", "title", "hoursPerWeek"] }[entity];
  const errors = [];
  rows.forEach((row, index) => {
    for (const field of required) {
      const source = mapping[field];
      if (!source || !String(row[source] ?? "").trim()) errors.push({ row: index + 2, field, message: `Required value "${field}" is missing` });
    }
    for (const field of ["lectureHours", "tutorialHours", "labHours", "hoursPerWeek", "minHours", "maxHours"]) {
      const source = mapping[field];
      if (source && row[source] !== "") {
        const value = Number(row[source]);
        if (!Number.isFinite(value) || value < 0 || value > 80) errors.push({ row: index + 2, field, message: `${field} must be a number from 0 to 80` });
      }
    }
    if (entity === "faculty" && mapping.email && row[mapping.email] && !z.string().email().safeParse(row[mapping.email]).success) {
      errors.push({ row: index + 2, field: "email", message: "Email address is invalid" });
    }
  });
  if (entity === "faculty" && mapping.minHours && mapping.maxHours) {
    rows.forEach((row, index) => {
      const minimum = Number(row[mapping.minHours] || 8);
      const maximum = Number(row[mapping.maxHours] || 16);
      if (minimum > maximum) errors.push({ row: index + 2, field: "maxHours", message: "Maximum hours cannot be below minimum hours" });
    });
  }
  return errors;
}

async function parseImportFile(file) {
  try {
    const extension = file.originalname.toLowerCase().split(".").pop();
    let headers;
    let rows;
    if (extension === "csv") {
      const records = parse(file.buffer, { skip_empty_lines: true, trim: true, bom: true });
      headers = (records.shift() ?? []).map((value) => String(value).trim());
      rows = records.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
    } else if (extension === "xlsx") {
      const sheets = await readXlsxFile(file.buffer);
      const records = sheets[0]?.data ?? [];
      headers = (records.shift() ?? []).map((value) => String(value ?? "").trim());
      rows = records.map((record) => Object.fromEntries(headers.map((header, index) => {
        const value = record[index];
        return [header, value instanceof Date ? value.toISOString() : String(value ?? "")];
      }))).filter((row) => Object.values(row).some((value) => value !== ""));
    } else {
      throw Object.assign(new Error("Upload a CSV or XLSX file"), { status: 400 });
    }
    if (!headers.length || headers.some((header) => !header) || new Set(headers).size !== headers.length) {
      throw Object.assign(new Error("File must have unique, non-empty column headers in its first row"), { status: 400 });
    }
    return { headers, rows };
  } catch (error) {
    if (error.status) throw error;
    const message = process.env.NODE_ENV === "production"
      ? "Could not parse uploaded file. Check its format and contents."
      : `Could not parse uploaded file: ${error.message}`;
    throw Object.assign(new Error(message), { status: 400 });
  }
}

app.get("/api/import/templates/:entity", authenticate, (req, res) => {
  const headers = importSchemas[req.params.entity];
  if (!headers) return res.status(404).json({ error: "Unknown import template" });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.entity}-template.csv"`);
  res.send(`${headers.join(",")}\r\n`);
});

app.post("/api/import/headers", ...manager, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload one CSV or XLSX file" });
    const { headers } = await parseImportFile(req.file);
    res.json({ headers });
  } catch (error) { next(error); }
});

app.post("/api/import/preview", ...manager, upload.single("file"), async (req, res, next) => {
  try {
    const entity = z.enum(["faculty", "courses", "sections", "duties"]).parse(req.body.entity);
    if (!req.file) return res.status(400).json({ error: "Upload one CSV or XLSX file" });
    let mappingPayload;
    try { mappingPayload = JSON.parse(req.body.mapping ?? "{}"); }
    catch { return res.status(400).json({ error: "Column mapping must be valid JSON" }); }
    const mapping = z.record(z.string(), z.string()).parse(mappingPayload);
    const { headers: parsedHeaders, rows } = await parseImportFile(req.file);
    if (!rows.length) return res.status(400).json({ error: "Import file must contain at least one data row" });
    if (rows.length > 2000) return res.status(400).json({ error: "Import is limited to 2,000 rows per batch" });
    const headers = new Set(parsedHeaders);
    const invalidMapping = Object.entries(mapping).filter(([field, header]) =>
      !importSchemas[entity].includes(field) || !headers.has(header));
    if (invalidMapping.length) return res.status(400).json({ error: "Column mapping references an unknown field or CSV header" });
    const errors = validateImportRows(entity, rows, mapping);
    rows.forEach((row, index) => {
      const departmentName = mapping.department ? row[mapping.department] : null;
      const courseCode = mapping.courseCode ? row[mapping.courseCode] : null;
      const email = mapping.email ? row[mapping.email] : null;
      if ((entity === "faculty" || entity === "courses") && departmentName) {
        const department = db.prepare("SELECT id FROM departments WHERE institution_id=? AND lower(name)=lower(?)").get(req.user.institution_id, departmentName);
        if (!department || !canManageDepartment(req, department.id)) errors.push({ row: index + 2, field: "department", message: `Unknown or unauthorized department: ${departmentName}` });
      }
      if (entity === "sections" && courseCode) {
        const course = db.prepare("SELECT id, department_id FROM courses WHERE institution_id=? AND lower(code)=lower(?)").get(req.user.institution_id, courseCode);
        if (!course || !canManageDepartment(req, course.department_id)) errors.push({ row: index + 2, field: "courseCode", message: `Unknown or unauthorized course: ${courseCode}` });
      }
      if (entity === "duties" && email) {
        const person = db.prepare("SELECT id, department_id FROM users WHERE institution_id=? AND lower(email)=lower(?) AND role='FACULTY'").get(req.user.institution_id, email);
        if (!person || !canManageDepartment(req, person.department_id)) errors.push({ row: index + 2, field: "email", message: `Unknown or unauthorized faculty: ${email}` });
      }
    });
    const batchId = randomUUID();
    db.prepare(`INSERT INTO import_batches(id, institution_id, created_by, entity, column_map, rows_json, errors_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(batchId, req.user.institution_id, req.user.id, entity, JSON.stringify(mapping), JSON.stringify(rows), JSON.stringify(errors));
    res.status(201).json({ batchId, entity, totalRows: rows.length, validRows: rows.length - new Set(errors.map((e) => e.row)).size, errors });
  } catch (error) { next(error); }
});

app.post("/api/import/:batchId/confirm", ...manager, (req, res, next) => {
  try {
    const batch = db.prepare("SELECT * FROM import_batches WHERE id=? AND institution_id=?").get(req.params.batchId, req.user.institution_id);
    if (!batch || batch.status !== "preview") return res.status(404).json({ error: "Import preview not found or already processed" });
    const rows = JSON.parse(batch.rows_json);
    const mapping = JSON.parse(batch.column_map);
    const errors = JSON.parse(batch.errors_json);
    if (errors.length) return res.status(400).json({ error: "Fix preview errors before confirming import", errors });
    const val = (row, field) => row[mapping[field]];
    const initialCredentials = [];
    const imported = db.transaction(() => {
      for (const row of rows) {
        if (batch.entity === "faculty") {
          const department = db.prepare("SELECT id FROM departments WHERE institution_id=? AND lower(name)=lower(?)").get(req.user.institution_id, val(row, "department"));
          if (!department || !canManageDepartment(req, department.id)) throw new Error(`Unknown or unauthorized department: ${val(row, "department")}`);
          const temporaryPassword = `${randomUUID()}A1!`;
          const added = db.prepare(`INSERT INTO users(institution_id, department_id, name, email, password_hash, role)
            VALUES (?, ?, ?, ?, ?, 'FACULTY')`).run(req.user.institution_id, department.id, val(row, "name"), val(row, "email").toLowerCase(), bcrypt.hashSync(temporaryPassword, 12));
          initialCredentials.push({ email: val(row, "email").toLowerCase(), temporaryPassword });
          const id = Number(added.lastInsertRowid);
          db.prepare("INSERT INTO faculty_profiles(user_id, designation, min_hours, max_hours) VALUES (?, ?, ?, ?)")
            .run(id, val(row, "designation") || "Faculty", Number(val(row, "minHours") || 8), Number(val(row, "maxHours") || 16));
          for (const subject of String(val(row, "expertise") || "").split("|").filter(Boolean)) db.prepare("INSERT OR IGNORE INTO expertise(faculty_id, subject) VALUES (?, ?)").run(id, subject);
        } else if (batch.entity === "courses") {
          const department = db.prepare("SELECT id FROM departments WHERE institution_id=? AND lower(name)=lower(?)").get(req.user.institution_id, val(row, "department"));
          if (!department || !canManageDepartment(req, department.id)) throw new Error(`Unknown or unauthorized department: ${val(row, "department")}`);
          db.prepare("INSERT INTO courses(institution_id, department_id, code, name, subject) VALUES (?, ?, ?, ?, ?)")
            .run(req.user.institution_id, department.id, val(row, "code"), val(row, "name"), val(row, "subject"));
        } else if (batch.entity === "sections") {
          const course = db.prepare("SELECT id, department_id FROM courses WHERE institution_id=? AND lower(code)=lower(?)").get(req.user.institution_id, val(row, "courseCode"));
          if (!course || !canManageDepartment(req, course.department_id)) throw new Error(`Unknown or unauthorized course: ${val(row, "courseCode")}`);
          db.prepare(`INSERT INTO sections(institution_id, course_id, section_name, lecture_hours, tutorial_hours, lab_hours, day, slot, term)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.user.institution_id, course.id, val(row, "sectionName"),
            Number(val(row, "lectureHours") || 0), Number(val(row, "tutorialHours") || 0), Number(val(row, "labHours") || 0),
            val(row, "day") || null, val(row, "slot") || null, val(row, "term") || "Current");
        } else {
          const faculty = db.prepare("SELECT id, department_id FROM users WHERE institution_id=? AND lower(email)=lower(?) AND role='FACULTY'").get(req.user.institution_id, val(row, "email"));
          if (!faculty || !canManageDepartment(req, faculty.department_id)) throw new Error(`Unknown or unauthorized faculty: ${val(row, "email")}`);
          db.prepare("INSERT INTO additional_duties(institution_id, faculty_id, title, hours_per_week, counted) VALUES (?, ?, ?, ?, ?)")
            .run(req.user.institution_id, faculty.id, val(row, "title"), Number(val(row, "hoursPerWeek")), String(val(row, "counted") ?? "true").toLowerCase() !== "false" ? 1 : 0);
        }
      }
      db.prepare("UPDATE import_batches SET status='imported' WHERE id=?").run(batch.id);
      return rows.length;
    })();
    audit(req.user.id, req.user.institution_id, "import", batch.entity, null, null, { rows: imported, batchId: batch.id });
    res.json({ imported, ...(initialCredentials.length ? { initialCredentials } : {}) });
  } catch (error) { next(error); }
});

app.get("/api/audit", ...manager, (req, res) => {
  const rows = db.prepare(`SELECT a.id, a.action, a.entity, a.entity_id AS entityId, a.before_json AS before,
    a.after_json AS after, a.created_at AS createdAt, u.name AS actor
    FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE a.institution_id=?
    ORDER BY a.created_at DESC LIMIT 200`).all(req.user.institution_id);
  res.json(rows);
});

app.get("/api/ml/status", authenticate, async (_req, res) => {
  const base = process.env.ML_SERVICE_URL ?? "http://127.0.0.1:8000";
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return res.json({ available: false, status: `ML service returned HTTP ${response.status}` });
    const health = await response.json();
    res.json({ available: Boolean(health.modelReady), ...health });
  } catch {
    res.json({ available: false, status: "ML service is unavailable; workload calculations and assignment planning remain operational." });
  }
});

app.get("/api/ml/metrics", authenticate, async (_req, res) => {
  const base = process.env.ML_SERVICE_URL ?? "http://127.0.0.1:8000";
  try {
    const response = await fetch(`${base}/metrics`, { signal: AbortSignal.timeout(5000) });
    const payload = await response.json();
    if (!response.ok) return res.status(503).json({ error: payload.detail ?? "ML metrics unavailable" });
    res.json(payload);
  } catch {
    res.status(503).json({ error: "ML service is unavailable. No evaluation metrics are available." });
  }
});

app.post("/api/ml/train", ...manager, async (_req, res) => {
  const base = process.env.ML_SERVICE_URL ?? "http://127.0.0.1:8000";
  try {
    const response = await fetch(`${base}/train`, { method: "POST", signal: AbortSignal.timeout(15000) });
    const payload = await response.json();
    if (!response.ok) return res.status(502).json({ error: payload.detail ?? "ML training failed" });
    res.json(payload);
  } catch {
    res.status(503).json({ error: "ML service is unavailable. Core workload features are still available." });
  }
});

app.post("/api/ml/predict", authenticate, async (req, res, next) => {
  try {
    const input = z.object({ teachingHours: z.number().min(0).max(80), dutyHours: z.number().min(0).max(80) }).parse(req.body);
    const base = process.env.ML_SERVICE_URL ?? "http://127.0.0.1:8000";
    const response = await fetch(`${base}/predict`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(5000)
    });
    const payload = await response.json();
    if (!response.ok) return res.status(503).json({ error: payload.detail ?? "ML prediction unavailable" });
    res.json(payload);
  } catch (error) {
    if (error instanceof z.ZodError) return next(error);
    res.status(503).json({ error: "ML service is unavailable. Calculated workload status remains authoritative." });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: "Input validation failed", details: error.issues });
  if (error.status) return res.status(error.status).json({ error: error.message });
  if (error instanceof multer.MulterError) return res.status(400).json({ error: "Upload rejected", details: error.message });
  if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "A record with the same unique value already exists" });
  if (error.code === "SQLITE_CONSTRAINT_FOREIGNKEY") return res.status(400).json({ error: "Related record does not exist in this institution" });
  console.error(error);
  res.status(500).json({ error: process.env.NODE_ENV === "production" ? "Internal server error" : error.message });
});

if (process.env.SEED_DEMO === "true") {
  const existing = db.prepare("SELECT id FROM institutions WHERE name='Northstar University (Demo)'").get();
  if (!existing) {
    const password = bcrypt.hashSync("FacultyDemo2026!", 12);
    db.transaction(() => {
      const institutionId = Number(db.prepare("INSERT INTO institutions(name, domain, verified) VALUES (?, ?, 1)")
        .run("Northstar University (Demo)", "demo.northstar.edu").lastInsertRowid);
      const deptId = Number(db.prepare("INSERT INTO departments(institution_id, name) VALUES (?, ?)").run(institutionId, "Computer Science").lastInsertRowid);
      db.prepare("INSERT INTO workload_policies(institution_id, balanced_min, balanced_max, overload_threshold) VALUES (?, 8, 16, 18)").run(institutionId);
      const addUser = db.prepare(`INSERT INTO users(institution_id, department_id, name, email, password_hash, role)
        VALUES (?, ?, ?, ?, ?, ?)`);
      const adminId = Number(addUser.run(institutionId, deptId, "Demo Administrator", "admin@northstar.demo", password, "ADMIN").lastInsertRowid);
      addUser.run(institutionId, deptId, "Department Head", "hod@northstar.demo", password, "HOD");
      const people = [
        ["Ava Morgan", "ava@northstar.demo", "Software Engineering", 8, 16],
        ["Noah Patel", "noah@northstar.demo", "Data Science", 8, 16],
        ["Mia Chen", "mia@northstar.demo", "Networks", 8, 16],
        ["Ethan Brooks", "ethan@northstar.demo", "Software Engineering", 8, 16]
      ];
      const facultyIds = [];
      for (const [name, email, subject, min, max] of people) {
        const id = Number(addUser.run(institutionId, deptId, name, email, password, "FACULTY").lastInsertRowid);
        facultyIds.push(id);
        db.prepare("INSERT INTO faculty_profiles(user_id, designation, min_hours, max_hours) VALUES (?, 'Lecturer', ?, ?)")
          .run(id, min, max);
        db.prepare("INSERT INTO expertise(faculty_id, subject) VALUES (?, ?)").run(id, subject);
      }
      const subjects = [
        ["CS101", "Programming Fundamentals", "Software Engineering", 3, 1, 0],
        ["CS205", "Data Structures", "Software Engineering", 3, 1, 0],
        ["DS210", "Applied Data Science", "Data Science", 2, 1, 2],
        ["NW220", "Computer Networks", "Networks", 3, 0, 1],
        ["CS315", "Software Design", "Software Engineering", 2, 1, 0]
      ];
      let sectionIndex = 0;
      for (const [code, name, subject, lecture, tutorial, lab] of subjects) {
        const courseId = Number(db.prepare("INSERT INTO courses(institution_id, department_id, code, name, subject) VALUES (?, ?, ?, ?, ?)")
          .run(institutionId, deptId, code, name, subject).lastInsertRowid);
        const sectionId = Number(db.prepare(`INSERT INTO sections(institution_id, course_id, section_name, lecture_hours, tutorial_hours, lab_hours, day, slot)
          VALUES (?, ?, 'A', ?, ?, ?, ?, ?)`).run(institutionId, courseId, lecture, tutorial, lab,
          ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][sectionIndex], "09:00").lastInsertRowid);
        if (sectionIndex < 4) {
          db.prepare(`INSERT INTO allocations(institution_id, section_id, faculty_id, status, source)
            VALUES (?, ?, ?, 'official', 'demo-seed')`).run(institutionId, sectionId, facultyIds[sectionIndex]);
        }
        sectionIndex += 1;
      }
      db.prepare("INSERT INTO additional_duties(institution_id, faculty_id, title, hours_per_week) VALUES (?, ?, 'First-year mentoring', 2)")
        .run(institutionId, facultyIds[0]);
      db.prepare("INSERT INTO additional_duties(institution_id, faculty_id, title, hours_per_week, counted) VALUES (?, ?, 'Library committee', 1, 0)")
        .run(institutionId, facultyIds[2]);
      audit(adminId, institutionId, "seed_demo", "institution", institutionId, null, { demo: true });
    })();
  }
}

const server = app.listen(port, () => console.log(`Faculty Workload API listening on http://localhost:${port}`));
export { app, server };
