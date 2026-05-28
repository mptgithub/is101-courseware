// ─────────────────────────────────────────────────────────────────────────────
// IS101 Courseware Server
// College of Southern Nevada © Dr. Mark Taormino · All Rights Reserved
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const express  = require('express');
const path     = require('path');
const { v4: uuid } = require('uuid');
const { stmts } = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Change INSTRUCTOR_PASSWORD before deployment
const INSTRUCTOR_PASSWORD = process.env.INSTRUCTOR_PASSWORD || 'IS101admin2026!';
const NSHE_ID_PATTERN     = /^\d{10}$/;

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── AUTH HELPERS ──────────────────────────────────────────────────────────────
function requireStudent(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  const row = stmts.getSession.get(token);
  if (!row) return res.status(401).json({ error: 'Session expired — please log in again' });
  req.nsheId = row.nshe_id;
  next();
}

function requireInstructor(req, res, next) {
  const token = req.headers['x-instructor-token'];
  if (token !== 'instructor-' + Buffer.from(INSTRUCTOR_PASSWORD).toString('base64')) {
    return res.status(403).json({ error: 'Instructor access denied' });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT API
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/login — student logs in with NSHE ID
app.post('/api/login', (req, res) => {
  const { nsheId } = req.body;
  if (!nsheId || !NSHE_ID_PATTERN.test(String(nsheId).trim())) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit NSHE ID number.' });
  }
  const id = String(nsheId).trim();
  stmts.upsertStudent.run(id);
  const token = uuid();
  stmts.createSession.run(token, id);
  res.json({ success: true, token, nsheId: id });
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token) stmts.deleteSession.run(token);
  res.json({ success: true });
});

// GET /api/progress — load all student progress
app.get('/api/progress', requireStudent, (req, res) => {
  const id = req.nsheId;
  const steps     = stmts.getStepProgress.all(id);
  const labs      = stmts.getLabAnswers.all(id);
  const exams     = stmts.getExamAttempts.all(id);
  const checklist = stmts.getChecklistProgress.all(id);
  res.json({ nsheId: id, steps, labs, exams, checklist });
});

// POST /api/progress/step — mark a step complete
app.post('/api/progress/step', requireStudent, (req, res) => {
  const { unitId, topicId, stepIdx } = req.body;
  if (!unitId || !topicId || stepIdx === undefined) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  stmts.markStepDone.run(req.nsheId, unitId, topicId, stepIdx);
  res.json({ success: true });
});

// POST /api/progress/lab — save a lab answer
app.post('/api/progress/lab', requireStudent, (req, res) => {
  const { labId, questionIdx, answerIdx, correct } = req.body;
  if (!labId || questionIdx === undefined || answerIdx === undefined) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  stmts.saveLabAnswer.run(req.nsheId, labId, questionIdx, answerIdx, correct ? 1 : 0);
  res.json({ success: true });
});

// POST /api/progress/exam — save exam attempt
app.post('/api/progress/exam', requireStudent, (req, res) => {
  const { examId, score, total, passed } = req.body;
  if (!examId || score === undefined || total === undefined) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  stmts.saveExamAttempt.run(req.nsheId, examId, score, total, passed ? 1 : 0);
  res.json({ success: true });
});

// POST /api/progress/checklist — toggle a checklist step
app.post('/api/progress/checklist', requireStudent, (req, res) => {
  const { stepId, checked } = req.body;
  if (!stepId) return res.status(400).json({ error: 'Missing stepId' });
  if (checked) {
    stmts.markChecklistStep.run(req.nsheId, stepId);
  } else {
    stmts.uncheckChecklistStep.run(req.nsheId, stepId);
  }
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// INSTRUCTOR API
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/instructor/login
app.post('/api/instructor/login', (req, res) => {
  const { password } = req.body;
  if (password !== INSTRUCTOR_PASSWORD) {
    return res.status(403).json({ error: 'Incorrect password' });
  }
  const token = 'instructor-' + Buffer.from(INSTRUCTOR_PASSWORD).toString('base64');
  res.json({ success: true, token });
});

// GET /api/instructor/students — all students summary
app.get('/api/instructor/students', requireInstructor, (req, res) => {
  const students = stmts.allStudents.all();
  res.json(students);
});

// GET /api/instructor/student/:id — one student's full detail
app.get('/api/instructor/student/:id', requireInstructor, (req, res) => {
  const id = req.params.id;
  const student   = stmts.studentDetail.get(id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const steps     = stmts.getStepProgress.all(id);
  const labs      = stmts.getLabAnswers.all(id);
  const exams     = stmts.getExamAttempts.all(id);
  const checklist = stmts.getChecklistProgress.all(id);
  res.json({ student, steps, labs, exams, checklist });
});

// POST /api/instructor/roster — upload CSV roster
// Expects JSON array: [{nsheId, name, section}]
app.post('/api/instructor/roster', requireInstructor, (req, res) => {
  const { students, replace } = req.body;
  if (!Array.isArray(students)) return res.status(400).json({ error: 'Expected array of students' });
  if (replace) stmts.clearRoster.run();
  let count = 0;
  const insert = stmts.upsertRoster;
  students.forEach(s => {
    if (s.nsheId && s.name && NSHE_ID_PATTERN.test(String(s.nsheId).trim())) {
      insert.run(String(s.nsheId).trim(), String(s.name).trim(), String(s.section || '').trim());
      count++;
    }
  });
  res.json({ success: true, imported: count });
});

// GET /api/instructor/export — export progress as CSV
app.get('/api/instructor/export', requireInstructor, (req, res) => {
  const students = stmts.allStudents.all();
  const rows = ['NSHE ID,Name,Section,Steps Done,Exam Passed,First Seen,Last Seen'];
  students.forEach(s => {
    rows.push([
      s.nshe_id,
      `"${(s.name||'').replace(/"/g,'""')}"`,
      `"${(s.section||'').replace(/"/g,'""')}"`,
      s.steps_done || 0,
      s.exam_passed ? 'Yes' : 'No',
      s.first_seen,
      s.last_seen
    ].join(','));
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="IS101_Progress_Export.csv"');
  res.send(rows.join('\n'));
});

// ── CATCH-ALL — serve the main app for any unmatched route ────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  IS101 Courseware Server');
  console.log('  College of Southern Nevada');
  console.log('  © Dr. Mark Taormino · All Rights Reserved');
  console.log('');
  console.log(`  Running at: http://localhost:${PORT}`);
  console.log(`  Instructor dashboard: http://localhost:${PORT}/instructor.html`);
  console.log('');
  console.log('  Press Ctrl+C to stop the server');
  console.log('');
});
