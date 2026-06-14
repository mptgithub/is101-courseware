// ─────────────────────────────────────────────────────────────────────────────
// IS101 Courseware — Database
// College of Southern Nevada © Dr. Mark Taormino · All Rights Reserved
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
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    nshe_id  TEXT NOT NULL,
    exam_id  TEXT NOT NULL,
    score    INTEGER NOT NULL,
    total    INTEGER NOT NULL,
    passed   INTEGER NOT NULL DEFAULT 0,
    taken_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS checklist_progress (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    nshe_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    done_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
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

  CREATE TABLE IF NOT EXISTS practice_submissions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nshe_id         TEXT NOT NULL,
    domain          TEXT NOT NULL,
    filename        TEXT NOT NULL,
    original_name   TEXT NOT NULL,
    file_size       INTEGER NOT NULL DEFAULT 0,
    skills_done     INTEGER NOT NULL DEFAULT 0,
    total_skills    INTEGER NOT NULL DEFAULT 0,
    submitted_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    graded          INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS linkedin_links (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    domain     TEXT NOT NULL,
    skill_id   TEXT NOT NULL,
    url        TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(domain, skill_id)
  );

  CREATE TABLE IF NOT EXISTS practice_grades (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nshe_id      TEXT NOT NULL,
    domain       TEXT NOT NULL,
    submission_id INTEGER,
    score        INTEGER NOT NULL,
    total_points INTEGER NOT NULL,
    feedback     TEXT NOT NULL DEFAULT '',
    graded_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(nshe_id, domain)
  );
`);

// ── PREPARED STATEMENTS ───────────────────────────────────────────────────────
const stmts = {

  // ── Students ────────────────────────────────────────────────────────────────
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
      (SELECT COUNT(*) FROM step_progress      WHERE nshe_id = s.nshe_id) AS steps_done,
      (SELECT COUNT(*) FROM skill_completions  WHERE nshe_id = s.nshe_id) AS skills_done,
      (SELECT COUNT(*) FROM practice_submissions WHERE nshe_id = s.nshe_id) AS submissions,
      (SELECT MAX(passed) FROM exam_attempts   WHERE nshe_id = s.nshe_id) AS exam_passed
    FROM students s
    LEFT JOIN roster r ON r.nshe_id = s.nshe_id
    ORDER BY r.section, r.name, s.nshe_id
  `),

  // ── Roster ──────────────────────────────────────────────────────────────────
  upsertRoster: db.prepare(`
    INSERT INTO roster (nshe_id, name, section) VALUES (?, ?, ?)
    ON CONFLICT(nshe_id) DO UPDATE SET name = excluded.name, section = excluded.section
  `),
  clearRoster: db.prepare(`DELETE FROM roster`),

  // ── Sessions ────────────────────────────────────────────────────────────────
  createSession: db.prepare(`INSERT INTO sessions (token, nshe_id) VALUES (?, ?)`),
  getSession: db.prepare(`
    SELECT nshe_id FROM sessions WHERE token = ?
    AND created_at > datetime('now', '-8 hours', 'localtime')
  `),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),

  // ── Step progress ────────────────────────────────────────────────────────────
  markStepDone: db.prepare(`
    INSERT OR IGNORE INTO step_progress (nshe_id, unit_id, topic_id, step_idx)
    VALUES (?, ?, ?, ?)
  `),
  getStepProgress: db.prepare(`
    SELECT unit_id, topic_id, step_idx, done_at FROM step_progress WHERE nshe_id = ?
  `),

  // ── Lab answers ──────────────────────────────────────────────────────────────
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

  // ── Exam attempts ────────────────────────────────────────────────────────────
  saveExamAttempt: db.prepare(`
    INSERT INTO exam_attempts (nshe_id, exam_id, score, total, passed) VALUES (?, ?, ?, ?, ?)
  `),
  getExamAttempts: db.prepare(`
    SELECT exam_id, score, total, passed, taken_at
    FROM exam_attempts WHERE nshe_id = ? ORDER BY taken_at DESC
  `),

  // ── Checklist ────────────────────────────────────────────────────────────────
  markChecklistStep: db.prepare(`
    INSERT OR IGNORE INTO checklist_progress (nshe_id, step_id) VALUES (?, ?)
  `),
  uncheckChecklistStep: db.prepare(`
    DELETE FROM checklist_progress WHERE nshe_id = ? AND step_id = ?
  `),
  getChecklistProgress: db.prepare(`
    SELECT step_id, done_at FROM checklist_progress WHERE nshe_id = ?
  `),

  // ── Skill completions ────────────────────────────────────────────────────────
  markSkillComplete: db.prepare(`
    INSERT OR IGNORE INTO skill_completions (nshe_id, domain, skill_id) VALUES (?, ?, ?)
  `),
  unmarkSkillComplete: db.prepare(`
    DELETE FROM skill_completions WHERE nshe_id = ? AND domain = ? AND skill_id = ?
  `),
  getSkillCompletions: db.prepare(`
    SELECT domain, skill_id, completed_at
    FROM skill_completions WHERE nshe_id = ? ORDER BY domain, skill_id
  `),
  getSkillCompletionsByDomain: db.prepare(`
    SELECT domain, skill_id, completed_at
    FROM skill_completions WHERE nshe_id = ? AND domain = ? ORDER BY skill_id
  `),
  allSkillCompletions: db.prepare(`
    SELECT sc.nshe_id, r.name, r.section, sc.domain, sc.skill_id, sc.completed_at
    FROM skill_completions sc
    LEFT JOIN roster r ON r.nshe_id = sc.nshe_id
    ORDER BY sc.nshe_id, sc.domain, sc.skill_id
  `),

  // ── Practice submissions ──────────────────────────────────────────────────────
  saveSubmission: db.prepare(`
    INSERT INTO practice_submissions
      (nshe_id, domain, filename, original_name, file_size, skills_done, total_skills)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getSubmission: db.prepare(`
    SELECT * FROM practice_submissions
    WHERE nshe_id = ? AND domain = ?
    ORDER BY submitted_at DESC LIMIT 1
  `),
  getStudentSubmissions: db.prepare(`
    SELECT * FROM practice_submissions WHERE nshe_id = ? ORDER BY submitted_at DESC
  `),
  allSubmissions: db.prepare(`
    SELECT ps.*, r.name, r.section
    FROM practice_submissions ps
    LEFT JOIN roster r ON r.nshe_id = ps.nshe_id
    ORDER BY ps.submitted_at DESC
  `),
  submissionsByDomain: db.prepare(`
    SELECT ps.*, r.name, r.section
    FROM practice_submissions ps
    LEFT JOIN roster r ON r.nshe_id = ps.nshe_id
    WHERE ps.domain = ?
    ORDER BY ps.submitted_at DESC
  `),
  markSubmissionGraded: db.prepare(`
    UPDATE practice_submissions SET graded = 1 WHERE id = ?
  `),

  // ── Practice grades ──────────────────────────────────────────────────────────
  savePracticeGrade: db.prepare(`
    INSERT INTO practice_grades (nshe_id, domain, submission_id, score, total_points, feedback)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(nshe_id, domain)
    DO UPDATE SET score = excluded.score, total_points = excluded.total_points,
                  feedback = excluded.feedback, graded_at = datetime('now','localtime'),
                  submission_id = excluded.submission_id
  `),
  getStudentGrades: db.prepare(`
    SELECT * FROM practice_grades WHERE nshe_id = ? ORDER BY graded_at DESC
  `),
  allPracticeGrades: db.prepare(`
    SELECT pg.*, r.name, r.section
    FROM practice_grades pg
    LEFT JOIN roster r ON r.nshe_id = pg.nshe_id
    ORDER BY pg.graded_at DESC
  `),

};

  // ── LinkedIn Learning Links ──────────────────────────────────────────────────
  setLinkedInLink: db.prepare(`
    INSERT INTO linkedin_links (domain, skill_id, url)
    VALUES (?, ?, ?)
    ON CONFLICT(domain, skill_id) DO UPDATE SET url = excluded.url,
      updated_at = datetime('now','localtime')
  `),
  getLinkedInLinks: db.prepare(`
    SELECT domain, skill_id, url FROM linkedin_links ORDER BY domain, skill_id
  `),
  getLinkedInLinksByDomain: db.prepare(`
    SELECT skill_id, url FROM linkedin_links WHERE domain = ? ORDER BY skill_id
  `),
  getLinkedInLink: db.prepare(`
    SELECT url FROM linkedin_links WHERE domain = ? AND skill_id = ?
  `),

};

module.exports = { db, stmts };
