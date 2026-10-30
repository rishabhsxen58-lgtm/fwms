import { db } from "./db.js";

export function workloadFor(facultyId, institutionId) {
  const policy = db.prepare("SELECT * FROM workload_policies WHERE institution_id = ?").get(institutionId)
    ?? { balanced_min: 8, balanced_max: 16, overload_threshold: 18, duty_hours_counted: 1 };
  const allocated = db.prepare(`
    SELECT COALESCE(SUM(s.lecture_hours + s.tutorial_hours + s.lab_hours), 0) AS hours
    FROM allocations a JOIN sections s ON s.id = a.section_id
    WHERE a.institution_id = ? AND a.faculty_id = ? AND a.status = 'official'
  `).get(institutionId, facultyId).hours;
  const dutyHours = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN counted = 1 AND ? = 1 THEN hours_per_week ELSE 0 END), 0) AS hours
    FROM additional_duties WHERE institution_id = ? AND faculty_id = ?
  `).get(policy.duty_hours_counted, institutionId, facultyId).hours;
  const hours = allocated + dutyHours;
  let status = "Balanced";
  if (hours < policy.balanced_min) status = "Underloaded";
  else if (hours > policy.balanced_max) status = "High Workload";
  return { hours, teachingHours: allocated, dutyHours, status, overThreshold: hours > policy.overload_threshold, policy };
}

export function audit(actorId, institutionId, action, entity, entityId, before, after) {
  db.prepare(`INSERT INTO audit_log
    (actor_id, institution_id, action, entity, entity_id, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    actorId, institutionId, action, entity, entityId ?? null,
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after)
  );
}

export function jsonRows(value) {
  try { return JSON.parse(value ?? "[]"); } catch { return []; }
}
