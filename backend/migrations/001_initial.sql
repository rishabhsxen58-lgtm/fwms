CREATE TABLE institutions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE departments (
  id INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE(institution_id, name)
);
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN', 'HOD', 'FACULTY')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE faculty_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  max_hours REAL NOT NULL DEFAULT 16,
  min_hours REAL NOT NULL DEFAULT 8,
  designation TEXT NOT NULL DEFAULT 'Faculty'
);
CREATE TABLE expertise (
  id INTEGER PRIMARY KEY,
  faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  UNIQUE(faculty_id, subject)
);
CREATE TABLE availability (
  id INTEGER PRIMARY KEY,
  faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  slot TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  UNIQUE(faculty_id, day, slot)
);
CREATE TABLE courses (
  id INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  UNIQUE(institution_id, code)
);
CREATE TABLE sections (
  id INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  section_name TEXT NOT NULL,
  lecture_hours REAL NOT NULL DEFAULT 0,
  tutorial_hours REAL NOT NULL DEFAULT 0,
  lab_hours REAL NOT NULL DEFAULT 0,
  day TEXT,
  slot TEXT,
  term TEXT NOT NULL DEFAULT 'Current',
  UNIQUE(course_id, section_name, term)
);
CREATE TABLE additional_duties (
  id INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  hours_per_week REAL NOT NULL,
  counted INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE workload_policies (
  institution_id INTEGER PRIMARY KEY REFERENCES institutions(id) ON DELETE CASCADE,
  balanced_min REAL NOT NULL DEFAULT 8,
  balanced_max REAL NOT NULL DEFAULT 16,
  overload_threshold REAL NOT NULL DEFAULT 18,
  duty_hours_counted INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE allocations (
  id INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  faculty_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'official' CHECK(status IN ('official', 'pending')),
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(section_id, status)
);
CREATE TABLE recommendations (
  id INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT
);
CREATE TABLE recommendation_items (
  id INTEGER PRIMARY KEY,
  recommendation_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  faculty_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  previous_faculty_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_users_tenant_department ON users(institution_id, department_id, role);
CREATE INDEX idx_sections_tenant_term ON sections(institution_id, term);
CREATE INDEX idx_allocations_tenant_status ON allocations(institution_id, status);
CREATE INDEX idx_duties_tenant_faculty ON additional_duties(institution_id, faculty_id);
CREATE INDEX idx_audit_tenant_created ON audit_log(institution_id, created_at);
