CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  entity TEXT NOT NULL,
  column_map TEXT NOT NULL,
  rows_json TEXT NOT NULL,
  errors_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'preview',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
