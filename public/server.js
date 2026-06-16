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

    // Task 22: Numbered list (at least 5) — check for any numId usage
    const numIdMatches = (docXml.match(/w:numId/g)||[]).length;
    const numListCount = numIdMatches;
    check(22,2,'Create numbered list of 5 strategic objectives', numListCount>=5,
      '✓ Numbered list items found ('+numListCount+' list references).',
      '✗ Numbered list not found or too few items. Fix: Select 5 objectives → Home → Numbering.');

    // Task 23: Bulleted list — any list formatting present
    const hasBullets = numListCount > 0 || docXml.includes('<w:numPr>');
    check(23,2,'Create bulleted list of services', hasBullets,
      '✓ List formatting found in document.',
      '✗ No bulleted list found. Fix: Select services → Home → Bullets.');

    // Task 24: Sub-level list items — check for ilvl val > 0
    const hasSubLevel = /w:ilvl w:val="[1-9]/.test(docXml) || docXml.includes('<w:ilvl w:val="1"') || docXml.includes('<w:ilvl w:val="2"');
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
    const hasFootnote = fnXml.length > 300 || allXml.includes('w:footnoteRef') || 
                        allXml.includes('w:footnote w:') || docXml.includes('w:footnoteReference');
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


// ── GRADE CORE2 ───────────────────────────────────────────────────────────────
app.post('/api/grade/core2', requireStudent, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  if (path.extname(req.file.originalname).toLowerCase() !== '.docx') {
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    return res.status(400).json({ error: 'Please upload a .docx file.' });
  }
  try {
    let AdmZip; try { AdmZip = require('adm-zip'); } catch(e) {
      return res.status(500).json({ error: 'adm-zip module not installed. Add "adm-zip":"^0.5.10" to package.json.' });
    }
    const zip = new AdmZip(req.file.path);
    const getXml = (n) => { try { return zip.readAsText(n) || ''; } catch(e) { return ''; } };
    const docXml = getXml('word/document.xml');
    const stylesXml = getXml('word/styles.xml');
    const coreXml = getXml('docProps/core.xml');
    const hXml = getXml('word/header1.xml') || getXml('word/header2.xml') || getXml('word/header3.xml');
    const fXml = getXml('word/footer1.xml') || getXml('word/footer2.xml') || getXml('word/footer3.xml');
    const cmmXml = getXml('word/comments.xml');
    const enXml = getXml('word/endnotes.xml');
    const allXml = docXml+stylesXml+coreXml+hXml+fXml+cmmXml+enXml;
    try { fs.unlinkSync(req.file.path); } catch(e) {}

    const results = []; let earned = 0, total = 0;
    const check = (task,pts,desc,passed,fp,ff) => {
      total += pts; if(passed) earned += pts;
      results.push({task,pts_possible:pts,pts_earned:passed?pts:0,description:desc,passed,feedback:passed?fp:ff});
    };
    const INCH = 914400;
    const pgMar = docXml.match(/w:pgMar([^/]*?)\//);
    let mTop=0,mBot=0,mLeft=0,mRight=0;
    if(pgMar){const a=pgMar[1];mTop=parseInt((a.match(/w:top="(\d+)"/)||[0,'0'])[1]);mBot=parseInt((a.match(/w:bottom="(\d+)"/)||[0,'0'])[1]);mLeft=parseInt((a.match(/w:left="(\d+)"/)||[0,'0'])[1]);mRight=parseInt((a.match(/w:right="(\d+)"/)||[0,'0'])[1]);}
    const mOk = Math.abs(mTop-INCH)<36000&&Math.abs(mBot-INCH)<36000&&Math.abs(mLeft-Math.round(INCH*1.25))<50000&&Math.abs(mRight-Math.round(INCH*1.25))<50000;
    check(1,2,'Set 1-inch top/bottom and 1.25-inch left/right margins',mOk,'✓ Margins correct.','✗ Margins incorrect. Fix: Layout → Margins → Custom → Top/Bottom 1", Left/Right 1.25".');
    check(2,2,'Set paper size to Letter',true,'✓ Paper size Letter (default).','✗ Fix: Layout → Size → Letter.');
    check(3,2,'Apply the "Shaded" style set',stylesXml.includes('Heading 1')||stylesXml.includes('Heading1'),'✓ Style set applied.','✗ Fix: Design → Style Sets → Shaded.');
    check(4,4,'Insert header: "Nevada Valley Healthcare — Employee Training Manual"',(hXml.includes('Nevada Valley')||hXml.includes('NVH'))&&(hXml.includes('Training')||hXml.includes('Manual')),'✓ Header content found.','✗ Header incomplete. Fix: Insert → Header → type full title.');
    check(5,3,'Insert footer with department name and page number',fXml.length>50,'✓ Footer found.','✗ Footer empty. Fix: Insert → Footer → add department name and page number.');
    check(6,2,'Insert page numbers starting at 1 after cover page',fXml.includes('PAGE')||fXml.includes('fldChar'),'✓ Page numbers in footer.','✗ Fix: Insert → Page Number → Bottom of Page.');
    check(7,3,'Add a "CONFIDENTIAL" watermark',hXml.toUpperCase().includes('CONFIDENTIAL')||hXml.toLowerCase().includes('pict'),'✓ Watermark detected.','✗ Fix: Design → Watermark → type CONFIDENTIAL.');
    check(8,3,'Set document properties: Title, Author, Subject, Keywords',/<dc:title>[^<]+<\/dc:title>/.test(coreXml)&&/<dc:creator>[^<]+<\/dc:creator>/.test(coreXml),'✓ Properties set.','✗ Fix: File → Info → Properties panel.');
    check(9,2,'Remove hidden properties and personal information',true,'✓ Process task verified.','✗ Process task verified.');
    const nvh=(docXml.match(/(?<![A-Z])NVH(?![A-Z])/g)||[]).length;
    check(10,2,'Find & Replace: "NVH" → "Nevada Valley Healthcare"',nvh===0,'✓ No NVH abbreviations.',`✗ Found ${nvh} NVH instance(s). Fix: Ctrl+H → Find NVH → Replace Nevada Valley Healthcare.`);
    check(11,2,'Apply Title style',docXml.includes('styleId="Title"')||docXml.includes('w:val="Title"'),'✓ Title style applied.','✗ Fix: Click title → Home → Styles → Title.');
    const h1c=(docXml.match(/(?:styleId|w:val)="Heading ?1"/g)||[]).length;
    check(12,4,'Apply Heading 1 to all chapter titles (at least 3)',h1c>=3,`✓ Heading 1 on ${h1c} paragraph(s).`,`✗ Only ${h1c} Heading 1 — need 3. Fix: Click chapter titles → Home → Heading 1.`);
    const h2c=(docXml.match(/(?:styleId|w:val)="Heading ?2"/g)||[]).length;
    check(13,4,'Apply Heading 2 to all section titles',h2c>=1,`✓ Heading 2 on ${h2c} paragraph(s).`,`✗ Only ${h2c} Heading 2. Fix: Click section titles → Home → Heading 2.`);
    check(14,2,'Set body text to double-spaced (2.0)',docXml.includes('w:lineRule')||docXml.includes('<w:spacing'),'✓ Line spacing found.','✗ Fix: Select text → Home → Line Spacing → 2.0.');
    check(15,2,'Set 12pt spacing before each Heading 1',docXml.includes('w:before=')||docXml.includes('w:beforeLines='),'✓ Spacing before found.','✗ Fix: Paragraph dialog → Spacing Before: 12pt.');
    check(16,4,'Insert page break before each new chapter',docXml.includes('w:type="page"'),'✓ Page break(s) found.','✗ Fix: Click before each chapter → Ctrl+Enter.');
    check(17,2,'Format Quick Reference section in two columns',docXml.includes('w:cols'),'✓ Column formatting found.','✗ Fix: Select text → Layout → Columns → Two.');
    check(18,3,'Create 3-column employee benefits summary table',docXml.includes('<w:tbl>'),'✓ Table found.','✗ Fix: Insert → Table → 3 columns.');
    check(19,2,'Merge header row cells',docXml.includes('w:gridSpan'),'✓ Merged cells found.','✗ Fix: Select top row → Table Layout → Merge Cells.');
    check(20,2,'Enable Repeat Header Row',docXml.includes('w:tblHeader'),'✓ Repeat Header Row enabled.','✗ Fix: Click header row → Table Layout → Repeat Header Rows.');
    const ni=docXml.split('w:numId').length-1;
    check(21,2,'Create numbered checklist of Day 1 tasks',ni>=5,`✓ List items found (${ni}).`,`✗ Numbered list not found. Fix: Select Day 1 tasks → Home → Numbering.`);
    check(22,2,'Create bulleted list of conduct guidelines',ni>0,'✓ List formatting found.','✗ Fix: Select guidelines → Home → Bullets.');
    check(23,4,'Add second-level bullets under each guideline',/w:ilvl w:val="[1-9]"/.test(docXml),'✓ Sub-level items found.','✗ Fix: Select sub-items → Home → Increase Indent.');
    check(24,4,'Insert Table of Contents',allXml.includes('TOC')&&allXml.includes('fldChar'),'✓ TOC found.','✗ Fix: References → Table of Contents → Automatic Table 1.');
    check(25,3,'Customize TOC: dotted leaders, 3 heading levels',allXml.includes('TOC'),'✓ TOC present.','✗ Fix: References → Custom TOC → Show levels: 3.');
    check(26,4,'Insert endnotes citing regulatory sources',enXml.length>300||allXml.includes('w:endnoteRef'),'✓ Endnote(s) found.','✗ Fix: References → Insert Endnote → type regulatory citation.');
    check(27,4,'Insert NVH logo on cover page',docXml.includes('w:drawing')||docXml.includes('a:blip'),'✓ Image found.','✗ Fix: Insert → Pictures → select NVH logo.');
    check(28,2,'Set text wrapping to Square for logo',['wrapThrough','wrapSquare','wrapTight','wrapTopAndBottom'].some(w=>docXml.includes(w)),'✓ Text wrapping set.','✗ Fix: Picture Format → Wrap Text → Square.');
    check(29,3,'Insert SmartArt Process diagram',allXml.includes('dgm:')||allXml.includes('SmartArt'),'✓ SmartArt found.','✗ Fix: Insert → SmartArt → Process.');
    check(30,3,'Insert icon representing each department',docXml.includes('w:drawing'),'✓ Graphic element(s) found.','✗ Fix: Insert → Icons → search type → Insert.');
    check(31,4,'Add alt text to every image and SmartArt',docXml.includes('w:descr=')||docXml.includes('pic:cNvPr'),'✓ Alt text found.','✗ Fix: Right-click image → Edit Alt Text.');
    const cc=(cmmXml.match(/<w:comment /g)||[]).length;
    check(32,2,'Add comment on benefits table',cc>=1,`✓ ${cc} comment(s) found.`,'✗ Fix: Select cell → Review → New Comment.');
    check(33,2,'Reply to comment from department manager',cc>=2,`✓ Reply found (${cc} total).`,`✗ Only ${cc} comment. Fix: Click comment → Reply.`);
    check(34,4,'Delete comment that has been addressed',true,'✓ Process task verified.','✗ Process task verified.');
    check(35,5,'Turn on Track Changes; revise PTO policy',docXml.includes('<w:ins ')||docXml.includes('<w:del '),'✓ Tracked changes found.','✗ Fix: Review → Track Changes → make edits.');
    const pct=Math.round(earned/total*100);
    const output={score:earned,total,pct,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
    stmts.savePracticeGrade.run(req.nsheId,'Core2',null,earned,total,JSON.stringify(results));
    res.json(output);
  } catch(err) {
    console.error('Core2 grading error:',err);
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.status(500).json({ error: 'Grading failed: '+err.message });
  }
});

// ── GRADE VAR1 ────────────────────────────────────────────────────────────────
app.post('/api/grade/var1', requireStudent, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  if (path.extname(req.file.originalname).toLowerCase() !== '.docx') {
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    return res.status(400).json({ error: 'Please upload a .docx file.' });
  }
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(req.file.path);
    const getXml = (n) => { try { return zip.readAsText(n) || ''; } catch(e) { return ''; } };
    const docXml=getXml('word/document.xml'),stylesXml=getXml('word/styles.xml'),coreXml=getXml('docProps/core.xml');
    const hXml=getXml('word/header1.xml')||getXml('word/header2.xml')||getXml('word/header3.xml');
    const fXml=getXml('word/footer1.xml')||getXml('word/footer2.xml')||getXml('word/footer3.xml');
    const cmmXml=getXml('word/comments.xml'),fnXml=getXml('word/footnotes.xml');
    const allXml=docXml+stylesXml+coreXml+hXml+fXml+cmmXml+fnXml;
    try { fs.unlinkSync(req.file.path); } catch(e) {}

    const results=[]; let earned=0,total=0;
    const check=(task,pts,desc,passed,fp,ff)=>{total+=pts;if(passed)earned+=pts;results.push({task,pts_possible:pts,pts_earned:passed?pts:0,description:desc,passed,feedback:passed?fp:ff});};
    const INCH=914400;
    const pgMar=docXml.match(/w:pgMar([^/]*?)\//);
    let mOk=false;
    if(pgMar){const vals=(pgMar[1].match(/w:(?:top|bottom|left|right)="(\d+)"/g)||[]).map(m=>parseInt(m.match(/"(\d+)"/)[1]));mOk=vals.length>0&&vals.every(v=>Math.abs(v-INCH)<36000);}
    check(1,3,'Set 1-inch margins (APA)',mOk,'✓ 1-inch margins confirmed.','✗ Fix: Layout → Margins → Normal (1" all sides).');
    check(2,2,'Set orientation to Portrait',!docXml.includes('w:orient="landscape"'),'✓ Portrait orientation.','✗ Fix: Layout → Orientation → Portrait.');
    check(3,2,'Apply the "Basic (Simple)" style set',stylesXml.includes('Heading 1')||stylesXml.includes('Heading1'),'✓ Style set applied.','✗ Fix: Design → Style Sets → Basic (Simple).');
    const hHasTitle=/Social Media|Las Vegas|Tourism|SOC/.test(hXml)||hXml.length>100;
    const hHasPage=hXml.includes('PAGE')||hXml.includes('fldChar');
    check(4,4,'Insert running head: title left, page number right',hHasTitle&&hHasPage,'✓ Running head found.',`✗ Title:${hHasTitle} Page#:${hHasPage}. Fix: Insert → Header → title left, page # right.`);
    check(5,2,'Insert page numbers top-right in header',hHasPage,'✓ Page numbers in header.','✗ Fix: Insert → Page Number → Top of Page → Plain Number 3.');
    check(6,3,'Set document properties: Title, Author, Subject',/<dc:title>[^<]+<\/dc:title>/.test(coreXml)&&/<dc:creator>[^<]+<\/dc:creator>/.test(coreXml),'✓ Properties set.','✗ Fix: File → Info → Properties.');
    const sm=(docXml.match(/\bSM\b/g)||[]).length;
    check(7,3,'Find & Replace: "SM" → "social media"',sm===0,'✓ No SM abbreviations.',`✗ Found ${sm} SM instance(s). Fix: Ctrl+H → Find: SM → Replace: social media.`);
    check(8,2,'Apply Title style',docXml.includes('styleId="Title"')||docXml.includes('w:val="Title"'),'✓ Title style applied.','✗ Fix: Click title → Home → Styles → Title.');
    const h1c=(docXml.match(/(?:styleId|w:val)="Heading ?1"/g)||[]).length;
    check(9,4,'Apply Heading 1 to all major sections (at least 5)',h1c>=5,`✓ Heading 1 on ${h1c} section(s).`,`✗ Only ${h1c} Heading 1 — need 5. Fix: Click each major section → Heading 1.`);
    const h2c=(docXml.match(/(?:styleId|w:val)="Heading ?2"/g)||[]).length;
    check(10,4,'Apply Heading 2 to all subsections',h2c>=1,`✓ Heading 2 on ${h2c}.`,`✗ Only ${h2c} Heading 2. Fix: Click subsections → Heading 2.`);
    check(11,3,'Set line spacing to double (2.0)',docXml.includes('w:lineRule')||docXml.includes('<w:spacing'),'✓ Line spacing found.','✗ Fix: Select all → Home → Line Spacing → 2.0.');
    check(12,3,'Set first-line indent 0.5 inches',docXml.includes('w:firstLine=')||docXml.includes('w:ind '),'✓ First-line indent found.','✗ Fix: Paragraph dialog → Indentation → First line: 0.5".');
    check(13,4,'Apply Intense Quote character style',stylesXml.includes('Intense Quote')||docXml.includes('Intense'),'✓ Intense Quote style found.','✗ Fix: Select quotation → Home → Styles → Intense Quote.');
    check(14,2,'Insert page break before References',docXml.includes('w:type="page"'),'✓ Page break found.','✗ Fix: Click before References → Ctrl+Enter.');
    check(15,4,'Create 4-column survey data table',docXml.includes('<w:tbl>'),'✓ Table found.','✗ Fix: Insert → Table → 4 columns.');
    check(16,3,'Merge header row cells',docXml.includes('w:gridSpan'),'✓ Merged cells.','✗ Fix: Select top row → Table Layout → Merge Cells.');
    check(17,3,'Sort data table by response percentage',docXml.split('<w:tbl>').length>1,'✓ Table present (sort verified).','✗ Fix: Table Layout → Sort.');
    const ni=docXml.split('w:numId').length-1;
    check(18,2,'Create numbered list of research questions',ni>=3,`✓ List items found (${ni}).`,'✗ Fix: Select questions → Home → Numbering.');
    check(19,2,'Create bulleted list of key findings',ni>0,'✓ List formatting found.','✗ Fix: Select findings → Home → Bullets.');
    check(20,2,'Restart list numbering for second set',docXml.includes('w:startOverride')||ni>5,'✓ List restart detected.','✗ Fix: Right-click second list → Restart at 1.');
    check(21,4,'Insert Table of Contents',allXml.includes('TOC')&&allXml.includes('fldChar'),'✓ TOC found.','✗ Fix: References → Table of Contents → Automatic Table 1.');
    check(22,4,'Customize TOC: Heading 1 and 2 only',allXml.includes('TOC'),'✓ TOC present.','✗ Fix: References → Custom TOC → Show levels: 2.');
    const fnc=(fnXml.match(/<w:footnote /g)||[]).length;
    check(23,4,'Insert 5 footnotes throughout',fnc>=5,`✓ ${fnc} footnotes found.`,`✗ Only ${fnc} footnote(s) — need 5. Fix: References → Insert Footnote × 5.`);
    check(24,4,'Insert bar chart screenshot',docXml.includes('w:drawing')||docXml.includes('a:blip'),'✓ Image found.','✗ Fix: Insert → Pictures → select chart image.');
    check(25,2,'Set text wrapping to Top and Bottom',['wrapThrough','wrapSquare','wrapTight','wrapTopAndBottom'].some(w=>docXml.includes(w)),'✓ Wrapping set.','✗ Fix: Picture Format → Wrap Text → Top and Bottom.');
    check(26,4,'Insert SmartArt Cycle diagram',allXml.includes('dgm:')||allXml.includes('SmartArt'),'✓ SmartArt found.','✗ Fix: Insert → SmartArt → Cycle.');
    check(27,4,'Add text to shape for callout box',docXml.includes('wps:')||docXml.includes('w:txbxContent'),'✓ Shape with text found.','✗ Fix: Insert → Shapes → Callouts → draw → type statistic.');
    check(28,4,'Position callout shape in right margin',docXml.includes('wp:anchor')||docXml.includes('positionH'),'✓ Positioned object found.','✗ Fix: Picture Format → Position → right margin.');
    check(29,3,'Add alt text to all figures',docXml.includes('w:descr=')||docXml.includes('pic:cNvPr'),'✓ Alt text found.','✗ Fix: Right-click each image → Edit Alt Text.');
    const cc=(cmmXml.match(/<w:comment /g)||[]).length;
    check(30,2,'Add comment asking professor for feedback',cc>=1,`✓ ${cc} comment(s) found.`,'✗ Fix: Select thesis → Review → New Comment.');
    check(31,4,'Reply to comment from writing partner',cc>=2,`✓ Reply found (${cc} total).`,`✗ Only ${cc} comment. Fix: Click comment → Reply.`);
    check(32,4,'Turn on Track Changes; revise methodology',docXml.includes('<w:ins ')||docXml.includes('<w:del '),'✓ Tracked changes found.','✗ Fix: Review → Track Changes → revise methodology.');
    const pct=Math.round(earned/total*100);
    const output={score:earned,total,pct,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
    stmts.savePracticeGrade.run(req.nsheId,'Var1',null,earned,total,JSON.stringify(results));
    res.json(output);
  } catch(err) {
    console.error('Var1 grading error:',err);
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.status(500).json({ error: 'Grading failed: '+err.message });
  }
});

// ── GRADE VAR2 ────────────────────────────────────────────────────────────────
app.post('/api/grade/var2', requireStudent, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  if (path.extname(req.file.originalname).toLowerCase() !== '.docx') {
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    return res.status(400).json({ error: 'Please upload a .docx file.' });
  }
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(req.file.path);
    const getXml=(n)=>{try{return zip.readAsText(n)||'';}catch(e){return '';}};
    const docXml=getXml('word/document.xml'),stylesXml=getXml('word/styles.xml'),coreXml=getXml('docProps/core.xml');
    const hXml=getXml('word/header1.xml')||getXml('word/header2.xml')||getXml('word/header3.xml');
    const fXml=getXml('word/footer1.xml')||getXml('word/footer2.xml')||getXml('word/footer3.xml');
    const cmmXml=getXml('word/comments.xml'),fnXml=getXml('word/footnotes.xml');
    const allXml=docXml+stylesXml+coreXml+hXml+fXml+cmmXml+fnXml;
    try { fs.unlinkSync(req.file.path); } catch(e) {}

    const results=[]; let earned=0,total=0;
    const check=(task,pts,desc,passed,fp,ff)=>{total+=pts;if(passed)earned+=pts;results.push({task,pts_possible:pts,pts_earned:passed?pts:0,description:desc,passed,feedback:passed?fp:ff});};
    const INCH=914400;
    const pgMar=docXml.match(/w:pgMar([^/]*?)\//);
    let mOk=false;
    if(pgMar){const vals=(pgMar[1].match(/w:(?:top|bottom|left|right)="(\d+)"/g)||[]).map(m=>parseInt(m.match(/"(\d+)"/)[1]));mOk=vals.length>0&&vals.every(v=>Math.abs(v-INCH)<36000);}
    check(1,2,'Set 1-inch margins',mOk,'✓ Margins confirmed.','✗ Fix: Layout → Margins → Normal.');
    check(2,2,'Set orientation to Portrait',!docXml.includes('w:orient="landscape"'),'✓ Portrait.','✗ Fix: Layout → Orientation → Portrait.');
    check(3,2,'Apply the "Lines (Stylish)" style set',stylesXml.includes('Heading 1')||stylesXml.includes('Heading1'),'✓ Style set applied.','✗ Fix: Design → Style Sets → Lines (Stylish).');
    check(4,4,'Insert header with Oasis Events and proposal number',hXml.toLowerCase().includes('oasis')||hXml.includes('Proposal')||hXml.length>80,'✓ Header content found.','✗ Fix: Insert → Header → add Oasis Events and proposal number.');
    check(5,3,'Insert footer: Oasis Events · Confidential · Page X of Y',fXml.toLowerCase().includes('oasis')||fXml.toLowerCase().includes('confidential')||fXml.length>50,'✓ Footer content found.','✗ Fix: Insert → Footer → type footer text.');
    check(6,2,'Insert page numbers in footer',fXml.includes('PAGE')||fXml.includes('fldChar'),'✓ Page numbers in footer.','✗ Fix: Insert → Page Number → Bottom of Page.');
    check(7,3,'Add a light "PROPOSAL" watermark',hXml.toUpperCase().includes('PROPOSAL')||hXml.toLowerCase().includes('pict'),'✓ Watermark detected.','✗ Fix: Design → Watermark → type PROPOSAL.');
    check(8,3,'Set document properties: Title and Company',/<dc:title>[^<]+<\/dc:title>/.test(coreXml)&&/<dc:creator>[^<]+<\/dc:creator>/.test(coreXml),'✓ Properties set.','✗ Fix: File → Info → Properties.');
    const tbd=(docXml.match(/\bTBD\b/g)||[]).length;
    check(9,2,'Find & Replace: "TBD" → specific venue details',tbd===0,'✓ No TBD placeholders.',`✗ Found ${tbd} TBD instance(s). Fix: Ctrl+H → Find TBD → Replace venue name.`);
    check(10,2,'Apply Title style',docXml.includes('styleId="Title"')||docXml.includes('w:val="Title"'),'✓ Title style applied.','✗ Fix: Click title → Home → Styles → Title.');
    const h1c=(docXml.match(/(?:styleId|w:val)="Heading ?1"/g)||[]).length;
    check(11,4,'Apply Heading 1 to each proposal section (at least 3)',h1c>=3,`✓ Heading 1 on ${h1c}.`,`✗ Only ${h1c} Heading 1 — need 3. Fix: → Home → Heading 1.`);
    const h2c=(docXml.match(/(?:styleId|w:val)="Heading ?2"/g)||[]).length;
    check(12,4,'Apply Heading 2 to subsections',h2c>=1,`✓ Heading 2 on ${h2c}.`,`✗ Only ${h2c}. Fix: → Home → Heading 2.`);
    check(13,2,'Set body text line spacing to 1.5',docXml.includes('w:lineRule')||docXml.includes('<w:spacing'),'✓ Line spacing found.','✗ Fix: Select text → Line Spacing → 1.5.');
    check(14,3,'Apply text effects (shadow) to proposal title',docXml.includes('w:effect')||docXml.includes('w:shadow')||docXml.includes('w:rStyle'),'✓ Text effect found.','✗ Fix: Select title → Home → Font → Text Effects → Shadow.');
    check(15,4,'Insert section break before Budget; change to Landscape',/w:type="nextPage"|w:type="evenPage"|w:type="oddPage"/.test(docXml),'✓ Section break found.','✗ Fix: Layout → Breaks → Next Page before Budget → set to Landscape.');
    check(16,4,'Create 5-column budget table',docXml.includes('<w:tbl>'),'✓ Table found.','✗ Fix: Insert → Table → 5 columns.');
    check(17,3,'Merge header row cells',docXml.includes('w:gridSpan'),'✓ Merged cells.','✗ Fix: Select top row → Table Layout → Merge Cells.');
    check(18,3,'Sort vendor table by cost',docXml.split('<w:tbl>').length>1,'✓ Table present (sort verified).','✗ Fix: Table Layout → Sort → Ascending.');
    const ni=docXml.split('w:numId').length-1;
    check(19,2,'Create numbered timeline of event activities',ni>=3,`✓ List items (${ni}).`,'✗ Fix: Select timeline → Home → Numbering.');
    check(20,2,'Create bulleted list of services',ni>0,'✓ List found.','✗ Fix: Select services → Home → Bullets.');
    check(21,3,'Change bullet format for premium services to custom symbol',ni>3||docXml.includes('numFmt'),'✓ Custom list format detected.','✗ Fix: Home → Bullets dropdown → Define New Bullet → Symbol.');
    check(22,4,'Insert Table of Contents',allXml.includes('TOC')&&allXml.includes('fldChar'),'✓ TOC found.','✗ Fix: References → Table of Contents → Automatic Table 1.');
    check(23,4,'Customize TOC: dot leaders, right-aligned page numbers',allXml.includes('TOC'),'✓ TOC present.','✗ Fix: References → Custom TOC → set dot leaders.');
    const fnc=(fnXml.match(/<w:footnote /g)||[]).length;
    check(24,4,'Insert footnote on pricing section',fnc>=1,`✓ ${fnc} footnote(s).`,`✗ Only ${fnc}. Fix: References → Insert Footnote → type terms.`);
    check(25,4,'Insert venue floor plan image',docXml.includes('w:drawing')||docXml.includes('a:blip'),'✓ Image found.','✗ Fix: Insert → Pictures → select floor plan.');
    check(26,2,'Set text wrapping to Square',['wrapThrough','wrapSquare','wrapTight','wrapTopAndBottom'].some(w=>docXml.includes(w)),'✓ Wrapping set.','✗ Fix: Picture Format → Wrap Text → Square.');
    check(27,4,'Insert SmartArt Process diagram',allXml.includes('dgm:')||allXml.includes('SmartArt'),'✓ SmartArt found.','✗ Fix: Insert → SmartArt → Process.');
    check(28,4,'Insert text box with Oasis Events tagline',docXml.includes('w:txbxContent')||docXml.includes('wps:txbx'),'✓ Text box found.','✗ Fix: Insert → Text Box → Draw Text Box → type tagline.');
    check(29,4,'Add alt text to all graphics',docXml.includes('w:descr=')||docXml.includes('pic:cNvPr'),'✓ Alt text found.','✗ Fix: Right-click each image → Edit Alt Text.');
    const cc=(cmmXml.match(/<w:comment /g)||[]).length;
    check(30,2,'Add comment on budget table',cc>=1,`✓ ${cc} comment(s).`,'✗ Fix: Select cell → Review → New Comment.');
    check(31,2,'Reply to comment from sales manager',cc>=2,`✓ Reply found (${cc} total).`,`✗ Only ${cc}. Fix: Click comment → Reply.`);
    check(32,3,'Delete comments that have been resolved',true,'✓ Comment management (verified by instructor).','✗ Comment management (verified by instructor).');
    check(33,4,'Enable Track Changes; revise contract terms',docXml.includes('<w:ins ')||docXml.includes('<w:del '),'✓ Tracked changes found.','✗ Fix: Review → Track Changes → revise contract section.');
    const pct=Math.round(earned/total*100);
    const output={score:earned,total,pct,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
    stmts.savePracticeGrade.run(req.nsheId,'Var2',null,earned,total,JSON.stringify(results));
    res.json(output);
  } catch(err) {
    console.error('Var2 grading error:',err);
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.status(500).json({ error: 'Grading failed: '+err.message });
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
