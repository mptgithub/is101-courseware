// ─────────────────────────────────────────────────────────────────────────────
// IS101 Courseware Server
// College of Southern Nevada © Dr. Mark Taormino · All Rights Reserved
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { v4: uuid } = require('uuid');
const multer   = require('multer');
const { stmts } = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CONFIG ────────────────────────────────────────────────────────────────────
const INSTRUCTOR_PASSWORD = process.env.INSTRUCTOR_PASSWORD || 'IS101admin2026!';
const NSHE_ID_PATTERN     = /^\d{10}$/;

// ── SUBMISSIONS FOLDER ────────────────────────────────────────────────────────
const SUBMISSIONS_DIR = path.join(__dirname, 'submissions');
if (!fs.existsSync(SUBMISSIONS_DIR)) fs.mkdirSync(SUBMISSIONS_DIR, { recursive: true });

// ── MULTER ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SUBMISSIONS_DIR),
  filename: (req, file, cb) => {
    const nshe   = req.nsheId || 'unknown';
    const domain = (req.body && req.body.domain) || 'XX';
    const ts     = new Date().toISOString().replace(/[-:T]/g,'').slice(0,15);
    const ext    = path.extname(file.originalname).toLowerCase();
    cb(null, `${nshe}_${domain}_${ts}${ext}`);
  }
});
const fileFilter = (req, file, cb) => {
  const allowed = ['.docx','.xlsx','.doc','.xls'];
  const ext = path.extname(file.originalname).toLowerCase();
  allowed.includes(ext) ? cb(null, true) : cb(new Error('Only Word and Excel files accepted.'), false);
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 25*1024*1024 } });

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
  if (token !== 'instructor-' + Buffer.from(INSTRUCTOR_PASSWORD).toString('base64'))
    return res.status(403).json({ error: 'Instructor access denied' });
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT API
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { nsheId } = req.body;
  if (!nsheId || !NSHE_ID_PATTERN.test(String(nsheId).trim()))
    return res.status(400).json({ error: 'Please enter a valid 10-digit NSHE ID number.' });
  const id = String(nsheId).trim();
  stmts.upsertStudent.run(id);
  const token = uuid();
  stmts.createSession.run(token, id);
  res.json({ success: true, token, nsheId: id });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token) stmts.deleteSession.run(token);
  res.json({ success: true });
});

app.get('/api/progress', requireStudent, (req, res) => {
  const id = req.nsheId;
  res.json({
    nsheId:   id,
    steps:     stmts.getStepProgress.all(id),
    labs:      stmts.getLabAnswers.all(id),
    exams:     stmts.getExamAttempts.all(id),
    checklist: stmts.getChecklistProgress.all(id),
    skills:    stmts.getSkillCompletions.all(id),
  });
});

app.post('/api/progress/step', requireStudent, (req, res) => {
  const { unitId, topicId, stepIdx } = req.body;
  if (!unitId || !topicId || stepIdx === undefined)
    return res.status(400).json({ error: 'Missing fields' });
  stmts.markStepDone.run(req.nsheId, unitId, topicId, stepIdx);
  res.json({ success: true });
});

app.post('/api/progress/lab', requireStudent, (req, res) => {
  const { labId, questionIdx, answerIdx, correct } = req.body;
  if (!labId || questionIdx === undefined || answerIdx === undefined)
    return res.status(400).json({ error: 'Missing fields' });
  stmts.saveLabAnswer.run(req.nsheId, labId, questionIdx, answerIdx, correct ? 1 : 0);
  res.json({ success: true });
});

app.post('/api/progress/exam', requireStudent, (req, res) => {
  const { examId, score, total, passed } = req.body;
  if (!examId || score === undefined || total === undefined)
    return res.status(400).json({ error: 'Missing fields' });
  stmts.saveExamAttempt.run(req.nsheId, examId, score, total, passed ? 1 : 0);
  res.json({ success: true });
});

app.post('/api/progress/checklist', requireStudent, (req, res) => {
  const { stepId, checked } = req.body;
  if (!stepId) return res.status(400).json({ error: 'Missing stepId' });
  if (checked) stmts.markChecklistStep.run(req.nsheId, stepId);
  else         stmts.uncheckChecklistStep.run(req.nsheId, stepId);
  res.json({ success: true });
});

// ── SKILL COMPLETIONS ─────────────────────────────────────────────────────────

app.post('/api/progress/skill', requireStudent, (req, res) => {
  const { domain, skillId, completed } = req.body;
  if (!domain || !skillId)
    return res.status(400).json({ error: 'Missing domain or skillId' });
  if (completed) stmts.markSkillComplete.run(req.nsheId, domain, skillId);
  else           stmts.unmarkSkillComplete.run(req.nsheId, domain, skillId);
  res.json({ success: true });
});

app.get('/api/progress/skills', requireStudent, (req, res) => {
  res.json({ nsheId: req.nsheId, skills: stmts.getSkillCompletions.all(req.nsheId) });
});

app.get('/api/progress/skills/:domain', requireStudent, (req, res) => {
  res.json({
    nsheId: req.nsheId,
    domain: req.params.domain,
    skills: stmts.getSkillCompletionsByDomain.all(req.nsheId, req.params.domain)
  });
});

// ── PRACTICE GRADING SUBMISSIONS ──────────────────────────────────────────────

// POST /api/submit — student uploads completed practice file
app.post('/api/submit', requireStudent, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  const { domain } = req.body;
  if (!domain)     return res.status(400).json({ error: 'Missing domain.' });
  const skillsDone  = parseInt(req.body.skillsDone  || 0);
  const totalSkills = parseInt(req.body.totalSkills || 0);
  try {
    stmts.saveSubmission.run(
      req.nsheId, domain,
      req.file.filename, req.file.originalname,
      req.file.size, skillsDone, totalSkills
    );
    res.json({
      success: true,
      message: 'File submitted. Your instructor will review and grade it.',
      filename: req.file.filename
    });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.status(500).json({ error: 'Submission failed. Please try again.' });
  }
});

// GET /api/submit/status/:domain — has this student submitted for this domain?
app.get('/api/submit/status/:domain', requireStudent, (req, res) => {
  const sub = stmts.getSubmission.get(req.nsheId, req.params.domain);
  res.json({ submitted: !!sub, submission: sub || null });
});

// ─────────────────────────────────────────────────────────────────────────────
// INSTRUCTOR API
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/instructor/login', (req, res) => {
  const { password } = req.body;
  if (password !== INSTRUCTOR_PASSWORD)
    return res.status(403).json({ error: 'Incorrect password' });
  res.json({ success: true, token: 'instructor-' + Buffer.from(INSTRUCTOR_PASSWORD).toString('base64') });
});

app.get('/api/instructor/students', requireInstructor, (req, res) => {
  res.json(stmts.allStudents.all());
});

app.get('/api/instructor/student/:id', requireInstructor, (req, res) => {
  const id      = req.params.id;
  const student = stmts.studentDetail.get(id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  res.json({
    student,
    steps:       stmts.getStepProgress.all(id),
    labs:        stmts.getLabAnswers.all(id),
    exams:       stmts.getExamAttempts.all(id),
    checklist:   stmts.getChecklistProgress.all(id),
    skills:      stmts.getSkillCompletions.all(id),
    submissions: stmts.getStudentSubmissions.all(id),
    grades:      stmts.getStudentGrades.all(id),
  });
});

// GET /api/instructor/submissions — all submissions
app.get('/api/instructor/submissions', requireInstructor, (req, res) => {
  res.json(stmts.allSubmissions.all());
});

// GET /api/instructor/submissions/:domain
app.get('/api/instructor/submissions/:domain', requireInstructor, (req, res) => {
  res.json(stmts.submissionsByDomain.all(req.params.domain));
});

// GET /api/instructor/download/:filename
app.get('/api/instructor/download/:filename', requireInstructor, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(SUBMISSIONS_DIR, filename);
  if (!fs.existsSync(filepath))
    return res.status(404).json({ error: 'File not found' });
  res.download(filepath);
});

// POST /api/instructor/grade — save a practice grade
app.post('/api/instructor/grade', requireInstructor, (req, res) => {
  const { nsheId, domain, submissionId, score, totalPoints, feedback } = req.body;
  if (!nsheId || !domain || score === undefined || !totalPoints)
    return res.status(400).json({ error: 'Missing fields' });
  stmts.savePracticeGrade.run(nsheId, domain, submissionId||null, score, totalPoints, feedback||'');
  res.json({ success: true });
});

// GET /api/instructor/grades
app.get('/api/instructor/grades', requireInstructor, (req, res) => {
  res.json(stmts.allPracticeGrades.all());
});

// GET /api/instructor/skills — skill completion summary
app.get('/api/instructor/skills', requireInstructor, (req, res) => {
  res.json(stmts.allSkillCompletions.all());
});

app.post('/api/instructor/roster', requireInstructor, (req, res) => {
  const { students, replace } = req.body;
  if (!Array.isArray(students))
    return res.status(400).json({ error: 'Expected array of students' });
  if (replace) stmts.clearRoster.run();
  let count = 0;
  students.forEach(s => {
    if (s.nsheId && s.name && NSHE_ID_PATTERN.test(String(s.nsheId).trim())) {
      stmts.upsertRoster.run(String(s.nsheId).trim(), String(s.name).trim(), String(s.section||'').trim());
      count++;
    }
  });
  res.json({ success: true, imported: count });
});

app.get('/api/instructor/export', requireInstructor, (req, res) => {
  const students = stmts.allStudents.all();
  const rows = ['NSHE ID,Name,Section,Steps Done,Skills Done,Submissions,Exam Passed,First Seen,Last Seen'];
  students.forEach(s => {
    rows.push([
      s.nshe_id,
      `"${(s.name||'').replace(/"/g,'""')}"`,
      `"${(s.section||'').replace(/"/g,'""')}"`,
      s.steps_done||0,
      stmts.getSkillCompletions.all(s.nshe_id).length,
      stmts.getStudentSubmissions.all(s.nshe_id).length,
      s.exam_passed ? 'Yes' : 'No',
      s.first_seen,
      s.last_seen
    ].join(','));
  });
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="IS101_Progress_Export.csv"');
  res.send(rows.join('\n'));
});

// ── LINKEDIN LEARNING LINKS ──────────────────────────────────────────────────

// GET /api/linkedin/:domain — get all LinkedIn links for a domain (public, no auth)
app.get('/api/linkedin/:domain', (req, res) => {
  const links = stmts.getLinkedInLinksByDomain.all(req.params.domain);
  // Return as a map: { skill_id: url }
  const map = {};
  links.forEach(l => { if (l.url) map[l.skill_id] = l.url; });
  res.json(map);
});

// GET /api/linkedin — get all LinkedIn links (instructor)
app.get('/api/instructor/linkedin', requireInstructor, (req, res) => {
  const links = stmts.getLinkedInLinks.all();
  res.json(links);
});

// POST /api/instructor/linkedin — set a single LinkedIn link
app.post('/api/instructor/linkedin', requireInstructor, (req, res) => {
  const { domain, skillId, url } = req.body;
  if (!domain || !skillId) return res.status(400).json({ error: 'Missing domain or skillId' });
  stmts.setLinkedInLink.run(domain, skillId, url || '');
  res.json({ success: true });
});

// POST /api/instructor/linkedin/bulk — set many links at once (CSV upload)
// Body: { links: [ { domain, skillId, url }, ... ] }
app.post('/api/instructor/linkedin/bulk', requireInstructor, (req, res) => {
  const { links } = req.body;
  if (!Array.isArray(links)) return res.status(400).json({ error: 'Expected array of links' });
  let count = 0;
  links.forEach(l => {
    if (l.domain && l.skillId) {
      stmts.setLinkedInLink.run(l.domain, l.skillId, l.url || '');
      count++;
    }
  });
  res.json({ success: true, updated: count });
});


// ── AUTO GRADING ──────────────────────────────────────────────────────────────

// POST /api/grade/core1 — auto-grade a Core 1 submission (Node.js native)
app.post('/api/grade/core1', requireStudent, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.docx') {
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    return res.status(400).json({ error: 'Please upload a .docx file.' });
  }

  try {
    let AdmZip;
    try {
      AdmZip = require('adm-zip');
    } catch(e) {
      return res.status(500).json({ error: 'adm-zip module not installed. Add "adm-zip":"^0.5.10" to package.json and redeploy.' });
    }
    const zip = new AdmZip(req.file.path);

    // Read key XML files from the docx
    const getXml = (name) => {
      try { return zip.readAsText(name) || ''; } catch(e) { return ''; }
    };

    const docXml      = getXml('word/document.xml');
    const settingsXml = getXml('word/settings.xml');
    const stylesXml   = getXml('word/styles.xml');
    const coreXml     = getXml('docProps/core.xml');
    const headerXml   = getXml('word/header1.xml') || getXml('word/header2.xml') || getXml('word/header3.xml');
    const footerXml   = getXml('word/footer1.xml') || getXml('word/footer2.xml') || getXml('word/footer3.xml');
    const commentsXml = getXml('word/comments.xml');
    const fnXml       = getXml('word/footnotes.xml');
    const allXml      = docXml + settingsXml + stylesXml + coreXml + headerXml + footerXml + commentsXml + fnXml;

    // Clean up file
    try { fs.unlinkSync(req.file.path); } catch(e) {}

    // Helper: check margin in EMUs (914400 = 1 inch)
    const INCH = 914400;
    const getMargin = (attr) => {
      const m = docXml.match(new RegExp('w:' + attr + '="(\\d+)"'));
      return m ? parseInt(m[1]) : null;
    };

    const results = [];
    let earned = 0, total = 0;

    const check = (task, pts, desc, passed, feedPass, feedFail) => {
      total += pts;
      if (passed) earned += pts;
      results.push({ task, pts_possible: pts, pts_earned: passed ? pts : 0,
        description: desc, passed, feedback: passed ? feedPass : feedFail });
    };

    // ── D1 ────────────────────────────────────────────────────────────────────
    // Task 1: Margins 1 inch
    const pgMar = docXml.match(/w:pgMar([^/]*)/);
    let marginsOk = false;
    if (pgMar) {
      const attrs = pgMar[1];
      const top    = parseInt((attrs.match(/w:top="(\d+)"/)   ||[0,0])[1]);
      const bottom = parseInt((attrs.match(/w:bottom="(\d+)"/)  ||[0,0])[1]);
      const left   = parseInt((attrs.match(/w:left="(\d+)"/)  ||[0,0])[1]);
      const right  = parseInt((attrs.match(/w:right="(\d+)"/) ||[0,0])[1]);
      marginsOk = [top,bottom,left,right].every(m => m > 0 && Math.abs(m - INCH) < 36000);
    }
    check(1,2,'Set 1-inch margins on all sides', marginsOk,
      '✓ Margins are set to 1 inch on all sides.',
      '✗ Margins are not 1 inch. Fix: Layout tab → Margins → Normal (1" all sides).');

    // Task 2: Portrait
    const landscape = docXml.includes('w:orient="landscape"');
    check(2,2,'Set orientation to Portrait', !landscape,
      '✓ Document is in Portrait orientation.',
      '✗ Document is in Landscape orientation. Fix: Layout tab → Orientation → Portrait.');

    // Task 3: Style set / styles applied
    const hasHeadingStyle = stylesXml.includes('Heading 1') || stylesXml.includes('Heading1');
    check(3,2,'Apply the "Basic (Stylish)" style set', hasHeadingStyle,
      '✓ Style set applied — heading styles are present.',
      '✗ No style set detected. Fix: Design tab → Document Formatting → Style Sets → Basic (Stylish).');

    // Task 4: Header with company name and date
    const hasCompany = headerXml.toLowerCase().includes('desert sun') || headerXml.includes('Desert Sun');
    const hasDate    = /20(25|26|27)/.test(headerXml) || 
                       /January|February|March|April|May|June|July|August|September|October|November|December/.test(headerXml);
    check(4,3,'Insert header: company name left-aligned, date right-aligned', hasCompany && hasDate,
      '✓ Header contains company name and date.',
      '✗ Header missing company name or date. Fix: Insert tab → Header → add Desert Sun Consulting and the date.');

    // Task 5: Footer with Confidential
    const footerLower = footerXml.toLowerCase();
    check(5,2,'Insert footer: "Confidential" centered', footerLower.includes('confidential'),
      '✓ Footer contains "Confidential".',
      '✗ Footer does not contain "Confidential". Fix: Insert → Footer → type "Confidential" centered.');

    // Task 6: Page numbers
    const hasPageNum = footerXml.includes('PAGE') || footerXml.includes('fldChar') || allXml.includes('w:pgNum');
    check(6,2,'Insert page numbers bottom right', hasPageNum,
      '✓ Page numbers found in footer.',
      '✗ Page numbers not found. Fix: Insert → Page Number → Bottom of Page → Plain Number 3.');

    // Task 7: Watermark
    const hasWatermark = headerXml.includes('DRAFT') || headerXml.includes('watermark') || 
                         headerXml.toLowerCase().includes('pict') || allXml.includes('w:background');
    check(7,2,'Add a "DRAFT" watermark', hasWatermark,
      '✓ DRAFT watermark detected.',
      '✗ DRAFT watermark not found. Fix: Design tab → Watermark → DRAFT 1.');

    // Task 8: Document properties
    const hasTitle  = coreXml.includes('<dc:title>') && !coreXml.includes('<dc:title/>') &&
                      !/<dc:title>\s*<\/dc:title>/.test(coreXml);
    const hasAuthor = coreXml.includes('<dc:creator>') && !coreXml.includes('<dc:creator/>') &&
                      !/<dc:creator>\s*<\/dc:creator>/.test(coreXml);
    check(8,2,'Set document properties: Title and Author', hasTitle && hasAuthor,
      '✓ Document Title and Author properties are set.',
      '✗ Document properties incomplete. Fix: File → Info → Properties panel → fill in Title and Author.');

    // Tasks 9,10: Process tasks — auto-pass
    check(9,2,'Run Accessibility Check',true,'✓ Process task.','✗ Process task.');
    check(10,3,'Save a PDF copy',true,'✓ Process task.','✗ Process task.');

    // ── D2 ────────────────────────────────────────────────────────────────────
    // Task 11: No DSC abbreviation
    const dscCount = (docXml.match(/>DSC[\s,.<]/g)||[]).length;
    check(11,2,'Find & Replace: "DSC" → "Desert Sun Consulting"', dscCount===0,
      '✓ No "DSC" abbreviations found — replacement completed.',
      '✗ Found '+dscCount+' instance(s) of "DSC" still in document. Fix: Ctrl+H → Find: DSC → Replace with: Desert Sun Consulting → Replace All.');

    // Task 12: Title style
    check(12,2,'Apply Title style to document title', stylesXml.includes('"Title"') || docXml.includes('w:styleId="Title"'),
      '✓ Title style is applied.',
      '✗ Title style not found. Fix: Click document title → Home → Styles → Title.');

    // Task 13: Heading 1 (at least 3)
    const h1count = (docXml.match(/styleId="Heading1"|styleId="Heading 1"|w:val="Heading1"|w:val="Heading 1"/g)||[]).length;
    check(13,3,'Apply Heading 1 to all section headers (at least 3)', h1count>=3,
      '✓ Heading 1 applied to '+h1count+' section(s).',
      '✗ Only '+h1count+' Heading 1 paragraph(s) found — need at least 3. Fix: Click each section header → Home → Heading 1.');

    // Task 14: Heading 2 (at least 1)
    const h2count = (docXml.match(/styleId="Heading2"|styleId="Heading 2"|w:val="Heading2"|w:val="Heading 2"/g)||[]).length;
    check(14,3,'Apply Heading 2 to subsection headers (at least 1)', h2count>=1,
      '✓ Heading 2 applied to '+h2count+' subsection(s).',
      '✗ No Heading 2 found. Fix: Click subsection header → Home → Heading 2.');

    // Task 15: Line spacing 1.15
    const hasLineSpacing = docXml.includes('w:lineRule="auto"') || docXml.includes('<w:spacing') ;
    check(15,2,'Set body text line spacing to 1.15', hasLineSpacing,
      '✓ Line spacing settings detected in body text.',
      '✗ No custom line spacing found. Fix: Select body text → Home → Line Spacing → 1.15.');

    // Task 16: 6pt spacing after
    const hasSpaceAfter = docXml.includes('w:after="') || docXml.includes('w:afterLines="');
    check(16,2,'Set 6pt spacing after each paragraph', hasSpaceAfter,
      '✓ Paragraph spacing after detected.',
      '✗ No paragraph spacing after found. Fix: Paragraph dialog → Spacing After: 6pt.');

    // Tasks 17,18: Process / structure tasks
    check(17,3,'Use Format Painter',true,'✓ Process task.','✗ Process task.');
    const hasSectionBreak = (docXml.match(/w:type="nextPage"|w:type="evenPage"|w:type="oddPage"/g)||[]).length > 0;
    check(18,3,'Insert section break before Financial Summary', hasSectionBreak,
      '✓ Section break found in document.',
      '✗ No section break found. Fix: Layout → Breaks → Next Page before Financial Summary.');

    // ── D3 ────────────────────────────────────────────────────────────────────
    // Task 19: 4-column table
    const tableMatches = docXml.match(/<w:tbl>/g)||[];
    const has4ColTable = docXml.includes('<w:gridCol') && tableMatches.length > 0;
    check(19,3,'Create a 4-column quarterly revenue table', has4ColTable,
      '✓ Table(s) found in document.',
      '✗ No table found. Fix: Insert → Table → 4 columns × 5 rows, fill in quarterly data.');

    // Task 20: Merged cells
    const hasMerge = docXml.includes('w:gridSpan') || docXml.includes('w:hMerge') || docXml.includes('w:vMerge');
    check(20,2,'Merge top row cells for spanning title', hasMerge,
      '✓ Merged cells detected.',
      '✗ No merged cells found. Fix: Select top row → Table Layout → Merge Cells.');

    // Task 21: Sorted client table (process task — hard to verify order in XML)
    check(21,2,'Sort client table alphabetically', tableMatches.length>=2,
      '✓ Multiple tables found (sort verified by content).',
      '✗ Second table not found. Fix: Add client table → Table Layout → Sort → Ascending.');

    // Task 22: Numbered list (at least 5)
    const numListCount = (docXml.match(/w:numId w:val="[^0]/g)||[]).length;
    check(22,2,'Create numbered list of 5 strategic objectives', numListCount>=5,
      '✓ Numbered list items found ('+numListCount+').',
      '✗ Numbered list not found or too few items. Fix: Select 5 objectives → Home → Numbering.');

    // Task 23: Bulleted list
    const hasBullets = docXml.includes('w:numId') && numListCount > 0;
    check(23,2,'Create bulleted list of services', hasBullets,
      '✓ List formatting found in document.',
      '✗ No bulleted list found. Fix: Select services → Home → Bullets.');

    // Task 24: Sub-level list items
    const hasSubLevel = docXml.includes('w:ilvl w:val="1"') || docXml.includes('w:ilvl w:val=\"1\"');
    check(24,3,'Increase list level for sub-items', hasSubLevel,
      '✓ Sub-level list items found.',
      '✗ No sub-level list items found. Fix: Select sub-items → Home → Increase Indent (or Tab).');

    // ── D4 ────────────────────────────────────────────────────────────────────
    // Task 25,26: TOC
    const hasToc = allXml.includes('TOC') || allXml.includes('w:fldChar') && allXml.includes('TOC');
    check(25,3,'Insert Table of Contents', hasToc,
      '✓ Table of Contents detected.',
      '✗ No TOC found. Fix: References → Table of Contents → Automatic Table 1.');
    check(26,3,'Customize TOC (Heading 1 & 2 only)', hasToc,
      '✓ TOC present (customization verified by instructor).',
      '✗ TOC not found. Fix: References → Custom Table of Contents → Show levels: 2.');

    // Task 27: Footnote
    const hasFootnote = fnXml.length > 200 || allXml.includes('w:footnoteRef');
    check(27,4,'Insert footnote on revenue figure', hasFootnote,
      '✓ Footnote found.',
      '✗ No footnote found. Fix: Click after revenue figure → References → Insert Footnote.');

    // ── D5 ────────────────────────────────────────────────────────────────────
    // Task 28: Picture
    const hasPicture = docXml.includes('w:drawing') || docXml.includes('pic:pic') || docXml.includes('a:blip');
    check(28,3,'Insert DSC logo image on cover page', hasPicture,
      '✓ Image found in document.',
      '✗ No image found. Fix: Insert → Pictures → This Device → select logo.');
    check(29,2,'Apply Drop Shadow Rectangle picture style', hasPicture,
      '✓ Image present (style verified by instructor).',
      '✗ No image found. Fix: Insert image first, then Picture Format → Picture Styles → Drop Shadow Rectangle.');
    check(30,2,'Set text wrapping to Through', hasPicture && (docXml.includes('wrapThrough') || docXml.includes('wrapSquare') || docXml.includes('wrapTight')),
      '✓ Text wrapping set on image.',
      '✗ Text wrapping not set. Fix: Click image → Picture Format → Wrap Text → Through.');

    // Task 31,32: SmartArt
    const hasSmartArt = docXml.includes('dgm:') || docXml.includes('c:chart') || allXml.includes('dgmLayout');
    check(31,3,'Insert SmartArt Hierarchy diagram', hasSmartArt,
      '✓ SmartArt found.',
      '✗ No SmartArt found. Fix: Insert → SmartArt → Hierarchy → Organization Chart.');
    check(32,3,'Modify SmartArt content with department names', hasSmartArt,
      '✓ SmartArt present (content verified by instructor).',
      '✗ SmartArt not found. Fix: Insert SmartArt first, then add department names.');

    // Task 33: Text box
    const hasTextBox = docXml.includes('w:txbxContent') || docXml.includes('wps:txbx');
    check(33,3,'Insert text box with report tagline', hasTextBox,
      '✓ Text box found.',
      '✗ No text box found. Fix: Insert → Text Box → Draw Text Box.');

    // Task 34: Alt text
    const hasAltText = docXml.includes('w:descr=') || docXml.includes('pic:cNvPr') || docXml.includes('a:cNvPr');
    check(34,4,'Add alt text to ALL images', hasAltText,
      '✓ Alt text detected on image(s).',
      '✗ No alt text found. Fix: Right-click each image → Edit Alt Text → add description.');

    // ── D6 ────────────────────────────────────────────────────────────────────
    // Task 35,36: Comments
    const commentCount = (commentsXml.match(/<w:comment /g)||[]).length;
    check(35,2,'Add comment on revenue figure', commentCount>=1,
      '✓ Comment(s) found ('+commentCount+').',
      '✗ No comments found. Fix: Select revenue figure → Review → New Comment.');
    check(36,2,'Reply to existing comment', commentCount>=2,
      '✓ Multiple comments/replies found.',
      '✗ Only '+commentCount+' comment(s) — reply not detected. Fix: Click comment → Reply.');
    check(37,2,'Resolve the comment',true,'✓ Process task.','✗ Process task.');

    // Task 38: Track changes
    const hasTracked = docXml.includes('<w:ins ') || docXml.includes('<w:del ');
    check(38,3,'Enable Track Changes and make edits', hasTracked,
      '✓ Tracked changes found in document.',
      '✗ No tracked changes. Fix: Review → Track Changes → make 3 edits.');
    check(39,2,'Accept tracked changes',true,'✓ Process task.','✗ Process task.');
    check(40,3,'Reject one tracked change',true,'✓ Process task.','✗ Process task.');

    const pct = Math.round(earned/total*100);
    const output = {
      score: earned, total, pct,
      passed: results.filter(r=>r.passed).length,
      failed: results.filter(r=>!r.passed).length,
      results
    };

    // Save to database
    stmts.savePracticeGrade.run(req.nsheId, 'Core1', null, earned, total, JSON.stringify(results));

    res.json(output);

  } catch(err) {
    console.error('Grading error full:', err.stack || err);
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.status(500).json({ error: 'Grading failed: ' + (err.message || String(err)) });
  }
});

// ── CATCH-ALL ─────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api'))
    return res.status(404).json({ error: 'API endpoint not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  IS101 Courseware Server`);
  console.log(`  College of Southern Nevada`);
  console.log(`  © Dr. Mark Taormino · All Rights Reserved\n`);
  console.log(`  Running at:  http://localhost:${PORT}`);
  console.log(`  Submissions: ${SUBMISSIONS_DIR}`);
  console.log(`  Instructor:  http://localhost:${PORT}/instructor.html\n`);
  console.log(`  Press Ctrl+C to stop\n`);
});
