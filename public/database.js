// ─────────────────────────────────────────────────────────────────────────────
// DATABASE PATCH — Skill Completions
// Add these to database.js
// College of Southern Nevada © Dr. Mark Taormino · All Rights Reserved
// June 13, 2026
// ─────────────────────────────────────────────────────────────────────────────

// ── STEP 1: Add this table creation to the db.exec() block ───────────────────
// Find your existing db.exec(`...`) that creates tables and add this inside it:

/*
  CREATE TABLE IF NOT EXISTS skill_completions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nshe_id      TEXT    NOT NULL,
    domain       TEXT    NOT NULL,
    skill_id     TEXT    NOT NULL,
    completed_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(nshe_id, domain, skill_id)
  );
*/

// ── STEP 2: Add these prepared statements to the stmts object ────────────────
// Find where you define stmts = { ... } and add these entries:

/*
  // Skill completions
  markSkillComplete: db.prepare(`
    INSERT OR IGNORE INTO skill_completions (nshe_id, domain, skill_id)
    VALUES (?, ?, ?)
  `),

  unmarkSkillComplete: db.prepare(`
    DELETE FROM skill_completions
    WHERE nshe_id = ? AND domain = ? AND skill_id = ?
  `),

  getSkillCompletions: db.prepare(`
    SELECT domain, skill_id, completed_at
    FROM skill_completions
    WHERE nshe_id = ?
    ORDER BY domain, skill_id
  `),

  getSkillCompletionsByDomain: db.prepare(`
    SELECT domain, skill_id, completed_at
    FROM skill_completions
    WHERE nshe_id = ? AND domain = ?
    ORDER BY skill_id
  `),

  allSkillCompletions: db.prepare(`
    SELECT
      sc.nshe_id,
      r.name,
      r.section,
      sc.domain,
      sc.skill_id,
      sc.completed_at
    FROM skill_completions sc
    LEFT JOIN roster r ON r.nshe_id = sc.nshe_id
    ORDER BY sc.nshe_id, sc.domain, sc.skill_id
  `),
*/

// ─────────────────────────────────────────────────────────────────────────────
// COMPLETE EXAMPLE — what database.js should look like after the patch
// (Only showing the additions in context — your existing code stays the same)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';
const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'is101.db');
const db      = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── CREATE TABLES ─────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    nshe_id    TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    last_seen  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS roster (
    nshe_id TEXT PRIMARY KEY,
    name    TEXT NOT NULL DEFAULT '',
    section TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    nshe_id    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS step_progress (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    nshe_id  TEXT NOT NULL,
    unit_id  TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    step_idx INTEGER NOT NULL,
    done_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(nshe_id, unit_id, topic_id, step_idx)
  );

  CREATE TABLE IF NOT EXISTS lab_answers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nshe_id      TEXT NOT NULL,
    lab_id       TEXT NOT NULL,
    question_idx INTEGER NOT NULL,
    answer_idx   INTEGER NOT NULL,
    correct      INTEGER NOT NULL DEFAULT 0,
    answered_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(nshe_id, lab_id, question_idx)
  );

  CREATE TABLE IF NOT EXISTS exam_attempts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nshe_id    TEXT NOT NULL,
    exam_id    TEXT NOT NULL,
    score      INTEGER NOT NULL,
    total      INTEGER NOT NULL,
    passed     INTEGER NOT NULL DEFAULT 0,
    taken_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS checklist_progress (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    nshe_id  TEXT NOT NULL,
    step_id  TEXT NOT NULL,
    done_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(nshe_id, step_id)
  );

  CREATE TABLE IF NOT EXISTS skill_completions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nshe_id      TEXT NOT NULL,
    domain       TEXT NOT NULL,
    skill_id     TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(nshe_id, domain, skill_id)
  );
`);

// ── PREPARED STATEMENTS ───────────────────────────────────────────────────────
const stmts = {

  // Students
  upsertStudent: db.prepare(`
    INSERT INTO students (nshe_id) VALUES (?)
    ON CONFLICT(nshe_id) DO UPDATE SET last_seen = datetime('now','localtime')
  `),
  studentDetail: db.prepare(`
    SELECT s.nshe_id, r.name, r.section, s.first_seen, s.last_seen
    FROM students s
    LEFT JOIN roster r ON r.nshe_id = s.nshe_id
    WHERE s.nshe_id = ?
  `),
  allStudents: db.prepare(`
    SELECT
      s.nshe_id,
      r.name,
      r.section,
      s.first_seen,
      s.last_seen,
      (SELECT COUNT(*) FROM step_progress WHERE nshe_id = s.nshe_id) AS steps_done,
      (SELECT COUNT(*) FROM skill_completions WHERE nshe_id = s.nshe_id) AS skills_done,
      (SELECT MAX(passed) FROM exam_attempts WHERE nshe_id = s.nshe_id) AS exam_passed
    FROM students s
    LEFT JOIN roster r ON r.nshe_id = s.nshe_id
    ORDER BY r.section, r.name, s.nshe_id
  `),

  // Roster
  upsertRoster: db.prepare(`
    INSERT INTO roster (nshe_id, name, section) VALUES (?, ?, ?)
    ON CONFLICT(nshe_id) DO UPDATE SET name = excluded.name, section = excluded.section
  `),
  clearRoster: db.prepare(`DELETE FROM roster`),

  // Sessions
  createSession: db.prepare(`
    INSERT INTO sessions (token, nshe_id) VALUES (?, ?)
  `),
  getSession: db.prepare(`
    SELECT nshe_id FROM sessions WHERE token = ?
    AND created_at > datetime('now', '-8 hours', 'localtime')
  `),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),

  // Step progress
  markStepDone: db.prepare(`
    INSERT OR IGNORE INTO step_progress (nshe_id, unit_id, topic_id, step_idx)
    VALUES (?, ?, ?, ?)
  `),
  getStepProgress: db.prepare(`
    SELECT unit_id, topic_id, step_idx, done_at
    FROM step_progress WHERE nshe_id = ?
  `),

  // Lab answers
  saveLabAnswer: db.prepare(`
    INSERT INTO lab_answers (nshe_id, lab_id, question_idx, answer_idx, correct)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(nshe_id, lab_id, question_idx)
    DO UPDATE SET answer_idx = excluded.answer_idx, correct = excluded.correct,
                  answered_at = datetime('now','localtime')
  `),
  getLabAnswers: db.prepare(`
    SELECT lab_id, question_idx, answer_idx, correct, answered_at
    FROM lab_answers WHERE nshe_id = ?
  `),

  // Exam attempts
  saveExamAttempt: db.prepare(`
    INSERT INTO exam_attempts (nshe_id, exam_id, score, total, passed)
    VALUES (?, ?, ?, ?, ?)
  `),
  getExamAttempts: db.prepare(`
    SELECT exam_id, score, total, passed, taken_at
    FROM exam_attempts WHERE nshe_id = ?
    ORDER BY taken_at DESC
  `),

  // Checklist
  markChecklistStep: db.prepare(`
    INSERT OR IGNORE INTO checklist_progress (nshe_id, step_id) VALUES (?, ?)
  `),
  uncheckChecklistStep: db.prepare(`
    DELETE FROM checklist_progress WHERE nshe_id = ? AND step_id = ?
  `),
  getChecklistProgress: db.prepare(`
    SELECT step_id, done_at FROM checklist_progress WHERE nshe_id = ?
  `),

  // ── SKILL COMPLETIONS (new — June 13, 2026) ──────────────────────────────
  markSkillComplete: db.prepare(`
    INSERT OR IGNORE INTO skill_completions (nshe_id, domain, skill_id)
    VALUES (?, ?, ?)
  `),
  unmarkSkillComplete: db.prepare(`
    DELETE FROM skill_completions
    WHERE nshe_id = ? AND domain = ? AND skill_id = ?
  `),
  getSkillCompletions: db.prepare(`
    SELECT domain, skill_id, completed_at
    FROM skill_completions
    WHERE nshe_id = ?
    ORDER BY domain, skill_id
  `),
  getSkillCompletionsByDomain: db.prepare(`
    SELECT domain, skill_id, completed_at
    FROM skill_completions
    WHERE nshe_id = ? AND domain = ?
    ORDER BY skill_id
  `),
  allSkillCompletions: db.prepare(`
    SELECT
      sc.nshe_id,
      r.name,
      r.section,
      sc.domain,
      sc.skill_id,
      sc.completed_at
    FROM skill_completions sc
    LEFT JOIN roster r ON r.nshe_id = sc.nshe_id
    ORDER BY sc.nshe_id, sc.domain, sc.skill_id
  `),

};

module.exports = { db, stmts };
