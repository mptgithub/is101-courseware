// ─────────────────────────────────────────────────────────────────────────────
// IS101 Courseware — Database Module
// College of Southern Nevada © Dr. Mark Taormino · All Rights Reserved
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'is101.db'));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── SCHEMA ──────────────────────────────────────────────────────────────────
db.exec(`
  -- Students who have logged in
  CREATE TABLE IF NOT EXISTS students (
    nshe_id     TEXT PRIMARY KEY,
    first_seen  DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Instructor-uploaded roster (NSHE ID → Name mapping)
  CREATE TABLE IF NOT EXISTS roster (
    nshe_id     TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    section     TEXT DEFAULT '',
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Session tokens for authenticated students
  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    nshe_id     TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL
  );

  -- Step completions (unit steps marked done)
  CREATE TABLE IF NOT EXISTS step_progress (
    nshe_id      TEXT NOT NULL,
    unit_id      TEXT NOT NULL,
    topic_id     TEXT NOT NULL,
    step_idx     INTEGER NOT NULL,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (nshe_id, unit_id, topic_id, step_idx)
  );

  -- Lab answers (Word, Excel, AI practice labs)
  CREATE TABLE IF NOT EXISTS lab_answers (
    nshe_id      TEXT NOT NULL,
    lab_id       TEXT NOT NULL,
    question_idx INTEGER NOT NULL,
    answer_idx   INTEGER NOT NULL,
    correct      INTEGER NOT NULL DEFAULT 0,
    answered_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (nshe_id, lab_id, question_idx)
  );

  -- Exam attempts (AI knowledge check)
  CREATE TABLE IF NOT EXISTS exam_attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nshe_id      TEXT NOT NULL,
    exam_id      TEXT NOT NULL,
    score        INTEGER NOT NULL,
    total        INTEGER NOT NULL,
    passed       INTEGER NOT NULL DEFAULT 0,
    attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- NotebookLM checklist step completions
  CREATE TABLE IF NOT EXISTS checklist_progress (
    nshe_id      TEXT NOT NULL,
    step_id      TEXT NOT NULL,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (nshe_id, step_id)
  );
`);

// ── STUDENT AUTH ─────────────────────────────────────────────────────────────
const stmts = {
  upsertStudent: db.prepare(`
    INSERT INTO students (nshe_id) VALUES (?)
    ON CONFLICT(nshe_id) DO UPDATE SET last_seen = CURRENT_TIMESTAMP
  `),
  createSession: db.prepare(`
    INSERT INTO sessions (token, nshe_id, expires_at)
    VALUES (?, ?, datetime('now', '+8 hours'))
  `),
  getSession: db.prepare(`
    SELECT nshe_id FROM sessions
    WHERE token = ? AND expires_at > datetime('now')
  `),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),
  cleanSessions: db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`),

  // Step progress
  markStepDone: db.prepare(`
    INSERT OR IGNORE INTO step_progress (nshe_id, unit_id, topic_id, step_idx)
    VALUES (?, ?, ?, ?)
  `),
  getStepProgress: db.prepare(`
    SELECT unit_id, topic_id, step_idx, completed_at
    FROM step_progress WHERE nshe_id = ?
  `),

  // Lab answers
  saveLabAnswer: db.prepare(`
    INSERT INTO lab_answers (nshe_id, lab_id, question_idx, answer_idx, correct)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(nshe_id, lab_id, question_idx) DO UPDATE SET
      answer_idx = excluded.answer_idx,
      correct = excluded.correct,
      answered_at = CURRENT_TIMESTAMP
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
    SELECT exam_id, score, total, passed, attempted_at
    FROM exam_attempts WHERE nshe_id = ? ORDER BY attempted_at DESC
  `),
  getBestExamScore: db.prepare(`
    SELECT MAX(score) as best, COUNT(*) as attempts, MAX(passed) as passed
    FROM exam_attempts WHERE nshe_id = ? AND exam_id = ?
  `),

  // Checklist
  markChecklistStep: db.prepare(`
    INSERT OR IGNORE INTO checklist_progress (nshe_id, step_id)
    VALUES (?, ?)
  `),
  uncheckChecklistStep: db.prepare(`
    DELETE FROM checklist_progress WHERE nshe_id = ? AND step_id = ?
  `),
  getChecklistProgress: db.prepare(`
    SELECT step_id, completed_at FROM checklist_progress WHERE nshe_id = ?
  `),

  // Roster
  upsertRoster: db.prepare(`
    INSERT INTO roster (nshe_id, name, section)
    VALUES (?, ?, ?)
    ON CONFLICT(nshe_id) DO UPDATE SET
      name = excluded.name,
      section = excluded.section,
      uploaded_at = CURRENT_TIMESTAMP
  `),
  clearRoster: db.prepare(`DELETE FROM roster`),

  // Instructor queries
  allStudents: db.prepare(`
    SELECT s.nshe_id, r.name, r.section,
           s.first_seen, s.last_seen,
           (SELECT COUNT(*) FROM step_progress sp WHERE sp.nshe_id = s.nshe_id) as steps_done,
           (SELECT MAX(passed) FROM exam_attempts ea WHERE ea.nshe_id = s.nshe_id AND exam_id = 'ai-exam') as exam_passed
    FROM students s
    LEFT JOIN roster r ON s.nshe_id = r.nshe_id
    ORDER BY r.name ASC, s.nshe_id ASC
  `),
  studentDetail: db.prepare(`
    SELECT s.nshe_id, r.name, r.section, s.first_seen, s.last_seen
    FROM students s LEFT JOIN roster r ON s.nshe_id = r.nshe_id
    WHERE s.nshe_id = ?
  `),
};

// Clean expired sessions on startup
stmts.cleanSessions.run();

module.exports = { db, stmts };
