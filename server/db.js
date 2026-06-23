"use strict";

const { DatabaseSync } = require("node:sqlite");
const path = require("path");

/**
 * Open (and migrate) a SQLite database. Pass ":memory:" for tests.
 */
function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  if (dbPath !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      slug       TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('owner','instructor','student')),
      cohort_id     INTEGER REFERENCES cohorts(id) ON DELETE SET NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cohorts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS briefs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      cohort_id  INTEGER NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cohort_instructors (
      cohort_id INTEGER NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (cohort_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS invites (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      role       TEXT NOT NULL CHECK (role IN ('instructor','student')),
      cohort_id  INTEGER REFERENCES cohorts(id) ON DELETE SET NULL,
      code       TEXT NOT NULL UNIQUE,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      revoked    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS blockages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      cohort_id       INTEGER NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
      brief_id        INTEGER REFERENCES briefs(id) ON DELETE SET NULL,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assignee_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      title           TEXT NOT NULL,
      difficulty      TEXT,
      details         TEXT,
      status          TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','in_support','resolved')),
      resolution_type TEXT,
      resolution_note TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at     TEXT
    );

    CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      blockage_id INTEGER NOT NULL REFERENCES blockages(id) ON DELETE CASCADE,
      user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
      is_ai      INTEGER NOT NULL DEFAULT 0,
      ai_author  TEXT,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS status_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      blockage_id INTEGER NOT NULL REFERENCES blockages(id) ON DELETE CASCADE,
      type        TEXT NOT NULL CHECK (type IN ('created','claimed','comment','ai_reply','resolved','reopened')),
      actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      meta        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,
      blockage_id INTEGER REFERENCES blockages(id) ON DELETE CASCADE,
      body        TEXT NOT NULL,
      read        INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token       TEXT NOT NULL UNIQUE,
      expires_at  TEXT NOT NULL,
      used        INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      blockage_id INTEGER REFERENCES blockages(id) ON DELETE CASCADE,
      comment_id  INTEGER REFERENCES comments(id) ON DELETE CASCADE,
      uploader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename    TEXT NOT NULL,
      mime        TEXT NOT NULL,
      size        INTEGER NOT NULL,
      stored_path TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
    CREATE INDEX IF NOT EXISTS idx_blk_org ON blockages(org_id);
    CREATE INDEX IF NOT EXISTS idx_blk_cohort ON blockages(cohort_id);
    CREATE INDEX IF NOT EXISTS idx_blk_user ON blockages(user_id);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_events_blk ON status_events(blockage_id);
    CREATE TABLE IF NOT EXISTS tags (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      color      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (org_id, name)
    );

    CREATE TABLE IF NOT EXISTS blockage_tags (
      blockage_id INTEGER NOT NULL REFERENCES blockages(id) ON DELETE CASCADE,
      tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (blockage_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS saved_views (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      status     TEXT,
      cohort_id  INTEGER REFERENCES cohorts(id) ON DELETE SET NULL,
      tag_id     INTEGER REFERENCES tags(id) ON DELETE SET NULL,
      search     TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS csat (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      blockage_id INTEGER NOT NULL UNIQUE REFERENCES blockages(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS canned_responses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sla_config (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id        INTEGER NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
      response_hours INTEGER NOT NULL DEFAULT 4,
      resolve_hours  INTEGER NOT NULL DEFAULT 48,
      bh_start       INTEGER NOT NULL DEFAULT 9,
      bh_end         INTEGER NOT NULL DEFAULT 17,
      bh_days        TEXT NOT NULL DEFAULT '1,2,3,4,5',
      tz_offset_min  INTEGER NOT NULL DEFAULT 0,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action      TEXT NOT NULL,
      target_type TEXT,
      target_id   INTEGER,
      ip          TEXT,
      meta        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(org_id);
    CREATE INDEX IF NOT EXISTS idx_att_org ON attachments(org_id);
    CREATE INDEX IF NOT EXISTS idx_att_blk ON attachments(blockage_id);
    CREATE INDEX IF NOT EXISTS idx_att_cmt ON attachments(comment_id);
    CREATE INDEX IF NOT EXISTS idx_pwreset_token ON password_resets(token);
    CREATE INDEX IF NOT EXISTS idx_btags_blk ON blockage_tags(blockage_id);
    CREATE INDEX IF NOT EXISTS idx_btags_tag ON blockage_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_views_user ON saved_views(user_id);
    CREATE INDEX IF NOT EXISTS idx_csat_org ON csat(org_id);
    CREATE INDEX IF NOT EXISTS idx_canned_org ON canned_responses(org_id);

    CREATE TABLE IF NOT EXISTS hotspot_alerts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      cohort_id  INTEGER REFERENCES cohorts(id) ON DELETE CASCADE,
      topic      TEXT NOT NULL,
      week       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(org_id, cohort_id, topic, week)
    );

    CREATE TABLE IF NOT EXISTS check_ins (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      student_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      instructor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note          TEXT,
      status        TEXT NOT NULL DEFAULT 'open',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_checkins_org ON check_ins(org_id);
    CREATE INDEX IF NOT EXISTS idx_checkins_student ON check_ins(student_id);
  `);
  // Additive columns (safe on an existing data.db).
  addColumnIfMissing(db, "comments", "ai_confidence", "REAL");
  addColumnIfMissing(db, "users", "email_verified", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "users", "verify_token", "TEXT");
  addColumnIfMissing(db, "blockages", "ai_followup_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "blockages", "ai_difficulty", "TEXT");
  addColumnIfMissing(db, "blockages", "ai_topics", "TEXT");
  addColumnIfMissing(db, "blockages", "ai_urgency", "TEXT");
  addColumnIfMissing(db, "cohorts", "assign_strategy", "TEXT NOT NULL DEFAULT 'none'");
  addColumnIfMissing(db, "cohorts", "rr_cursor", "INTEGER NOT NULL DEFAULT 0");
}

function addColumnIfMissing(db, table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

module.exports = { openDb, migrate };
