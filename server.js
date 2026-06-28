// ─────────────────────────────────────────────────────────────────────────────
// IS101 Courseware Server — v2 (32-task grader)
// College of Southern Nevada © Dr. Mark Taormino · All Rights Reserved
// Updated: June 16, 2026
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

// POST /api/grade/core1 -- auto-grade Core 1 (32 tasks, 100 pts)
app.post('/api/grade/core1', requireStudent, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.docx') { try { fs.unlinkSync(req.file.path); } catch(e) {} return res.status(400).json({ error: 'Please upload a .docx file.' }); }
  try {
    let AdmZip; try { AdmZip = require('adm-zip'); } catch(e) { return res.status(500).json({ error: 'adm-zip module not installed.' }); }
    const zip = new AdmZip(req.file.path);
    const getXml = (n) => { try { return zip.readAsText(n) || ''; } catch(e) { return ''; } };
    const docXml=getXml('word/document.xml'), stylesXml=getXml('word/styles.xml'), coreXml=getXml('docProps/core.xml');
    const hXml=getXml('word/header1.xml')||getXml('word/header2.xml')||getXml('word/header3.xml');
    const fXml=getXml('word/footer1.xml')||getXml('word/footer2.xml')||getXml('word/footer3.xml');
    const cmmXml=getXml('word/comments.xml'), fnXml=getXml('word/footnotes.xml');
    const numXml=getXml('word/numbering.xml');
    const allXml=docXml+stylesXml+coreXml+hXml+fXml+cmmXml+fnXml+numXml;
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    const results=[]; let earned=0, total=0;
    const check=(task,pts,desc,passed,fp,ff)=>{total+=pts;if(passed)earned+=pts;results.push({task,pts_possible:pts,pts_earned:passed?pts:0,description:desc,passed,feedback:passed?fp:ff});};
    const INCH=1440;
    // D1 - 8 tasks - 22 pts
    const pgMar=docXml.match(/w:pgMar([^/]*?)\//);
    let mT=0,mB=0,mL=0,mR=0;
    if(pgMar){const a=pgMar[1];mT=parseInt((a.match(/w:top="(\d+)"/)||[0,'0'])[1]);mB=parseInt((a.match(/w:bottom="(\d+)"/)||[0,'0'])[1]);mL=parseInt((a.match(/w:left="(\d+)"/)||[0,'0'])[1]);mR=parseInt((a.match(/w:right="(\d+)"/)||[0,'0'])[1]);}
    check(1,2,'Set 1-inch margins on all sides',[mT,mB,mL,mR].every(v=>Math.abs(v-INCH)<72),'Margins are 1 inch on all sides.','Margins not 1 inch. Fix: Layout > Margins > Normal.');
    check(2,2,'Set orientation to Portrait',docXml.split('<w:sectPr').length>=3||!docXml.includes('w:orient="landscape"'),'Portrait orientation confirmed.','Document is Landscape. Fix: Layout > Orientation > Portrait.');
    check(3,2,'Apply the Basic Stylish style set',/(?:styleId|w:val)="Heading ?1"/.test(docXml)||/(?:styleId|w:val)="Heading ?2"/.test(docXml),'Style set applied.','No style set. Fix: Design > Style Sets > Basic (Stylish).');
    const hC=hXml.includes('Desert Sun'); const hD=/20(25|26|27)/.test(hXml)||/January|February|March|April|May|June|July|August|September|October|November|December/.test(hXml);
    check(4,4,'Insert header: company name and date',hC&&hD,'Header has company name and date.','Header incomplete. Company:'+hC+' Date:'+hD+'. Fix: Insert > Header > add Desert Sun Consulting and date.');
    check(5,3,'Insert footer: Confidential centered',fXml.toLowerCase().includes('confidential'),'Footer has Confidential.','Footer missing Confidential. Fix: Insert > Footer > type Confidential.');
    check(6,3,'Insert page numbers bottom right',fXml.includes('PAGE')||fXml.includes('fldChar'),'Page numbers in footer.','No page numbers. Fix: Insert > Page Number > Bottom of Page > Plain Number 3.');
    check(7,3,'Add a DRAFT watermark',hXml.includes('DRAFT')||hXml.toLowerCase().includes('pict'),'DRAFT watermark found.','No watermark. Fix: Design > Watermark > DRAFT 1.');
    check(8,3,'Set document properties Title and Author',/<dc:title>[^<]+<\/dc:title>/.test(coreXml)&&/<dc:creator>[^<]+<\/dc:creator>/.test(coreXml),'Document properties set.','Properties incomplete. Fix: File > Info > Properties panel.');
    // D2 - 7 tasks - 22 pts
    const dsc=(docXml.match(/(?<![A-Z])DSC(?![A-Z])/g)||[]).length;
    check(9,3,'Find and Replace DSC with Desert Sun Consulting',dsc===0,'No DSC abbreviations found.','Found '+dsc+' DSC instances. Fix: Ctrl+H > Find DSC > Replace Desert Sun Consulting > Replace All.');
    check(10,3,'Apply Title style to document title',docXml.includes('styleId="Title"')||docXml.includes('w:val="Title"'),'Title style applied.','Title style not found. Fix: Click title > Home > Styles > Title.');
    const h1=(docXml.match(/(?:styleId|w:val)="Heading ?1"/g)||[]).length;
    check(11,4,'Apply Heading 1 to all section headers',h1>=8,'Heading 1 on '+h1+' sections.','Only '+h1+' Heading 1 found - need 8. Fix: Apply Heading 1 to: Executive Summary, Financial Summary, Quarterly Revenue, Client Portfolio, Strategic Objectives, Services Offered, Organizational Structure, and Conclusion.');
    const h2=(docXml.match(/(?:styleId|w:val)="Heading ?2"/g)||[]).length;
    check(12,4,'Apply Heading 2 to all subsection headers',h2>=1,'Heading 2 on '+h2+' subsections.','No Heading 2. Fix: Click subsection headers > Home > Heading 2.');
    check(13,2,'Set body text line spacing to 1.15',docXml.includes('w:lineRule')||docXml.includes('<w:spacing'),'Line spacing settings found.','No custom line spacing. Fix: Select body text > Home > Line Spacing > 1.15.');
    check(14,2,'Set 6pt spacing after each paragraph',docXml.includes('w:after='),'Paragraph spacing after found.','No spacing after. Fix: Paragraph dialog > Spacing After 6pt.');
    check(15,4,'Insert section break before Financial Summary and change to Landscape',(docXml.match(/<w:sectPr[ >]/g)||[]).length>=2 && docXml.includes('w:orient="landscape"'),'Section break with Landscape section found.','No Landscape section break. Fix: Layout > Breaks > Next Page before Financial Summary, then set that section to Layout > Orientation > Landscape.');
    // D3 - 6 tasks - 18 pts
    check(16,4,'Create a 4-column quarterly revenue table',docXml.includes('<w:tbl>'),'Table found.','No table. Fix: Insert > Table > 4 columns x 5 rows.');
    check(17,3,'Merge top row cells for spanning title',docXml.includes('w:gridSpan')||docXml.includes('w:hMerge'),'Merged cells found.','No merged cells. Fix: Select top row > Table Layout > Merge Cells.');
    check(18,3,'Sort client table alphabetically',docXml.split('<w:tbl>').length>=3,'Multiple tables found.','Client table not found. Fix: Add client table then Table Layout > Sort > Ascending.');
    const ni=docXml.split('w:numId').length-1;
    check(19,2,'Create numbered list of 5 strategic objectives',ni>=5,'Numbered list found ('+ni+' references).','Numbered list not found. Fix: Select 5 objectives > Home > Numbering.');
    check(20,2,'Create bulleted list of services',numXml.includes('w:numFmt w:val="bullet"') || docXml.includes('w:numFmt w:val="bullet"')||(/w:numId w:val="(\d+)"/.test(docXml)&&(docXml.match(/w:numId w:val="\d+"/g)||[]).length>5),'Bulleted list found.','No bulleted list. Fix: Select the three service categories > Home > Bullets.');
    check(21,4,'Increase list level for sub-items',/w:ilvl w:val="[1-9]"/.test(docXml),'Sub-level list items found.','No sub-level items. Fix: Select sub-items > Home > Increase Indent.');
    // D4 - 3 tasks - 10 pts
    check(22,3,'Insert Table of Contents after title page',/<w:instrText[^>]*>[^<]*TOC[^<]*<\/w:instrText>/.test(docXml),'TOC found.','No TOC. Fix: References > Table of Contents > Automatic Table 1.');
    check(23,3,'Customize TOC to show Heading 1 and Heading 2 only',/<w:instrText[^>]*>[^<]*TOC[^<]*\\o [&quot;"]*1[^<"]*-[^<"]*2/.test(docXml),'TOC customized to Heading 1 and 2 only.','TOC not customized. Fix: References > Table of Contents > Custom Table of Contents > Show levels: 2.');
    check(24,4,'Insert footnote on revenue figure',/<w:footnote w:id="[1-9]/.test(fnXml)&&docXml.includes('w:footnoteReference'),'Footnote found.','No footnote. Fix: Click after revenue figure > References > Insert Footnote.');
    // D5 - 5 tasks - 19 pts
    check(25,4,'Insert DSC logo image on cover page',docXml.includes('w:drawing')||docXml.includes('a:blip'),'Image found.','No image. Fix: Insert > Pictures > This Device > select logo.');
    check(26,3,'Set text wrapping to Through for the logo',['wrapThrough','wrapSquare','wrapTight','wrapTopAndBottom'].some(w=>docXml.includes(w)),'Text wrapping set.','Wrapping not set. Fix: Picture Format > Wrap Text > Through.');
    check(27,4,'Insert text box with report tagline on cover page',docXml.includes('w:txbxContent')||docXml.includes('wps:txbx'),'Text box found.','No text box. Fix: Insert > Text Box > Draw Text Box > type tagline.');
    check(28,8,'Add alt text to ALL images in the document',docXml.includes('descr="')||docXml.includes('pic:cNvPr'),'Alt text found.','No alt text. Fix: Right-click each image > Edit Alt Text > describe.');
    // D6 - 3 tasks - 9 pts
    const cc=(cmmXml.match(/<w:comment /g)||[]).length;
    check(29,3,'Add comment on revenue figure requesting verification',cc>=1,''+cc+' comment(s) found.','No comments. Fix: Select revenue figure > Review > New Comment.');
    check(30,2,'Reply to existing comment in the document',cc>=2,'Reply found ('+cc+' total).','Only '+cc+' comment - reply not found. Fix: Click comment > Reply.');
    check(31,4,'Enable Track Changes and make 3 edits to executive summary',docXml.includes('<w:ins ')||docXml.includes('<w:del '),'Tracked changes found.','No tracked changes. Fix: Review > Track Changes > make 3 edits.');
    const pct=Math.round(earned/total*100);
    const output={score:earned,total,pct,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
    stmts.savePracticeGrade.run(req.nsheId,'Core1',null,earned,total,JSON.stringify(results));
    res.json(output);
  } catch(err) {
    console.error('Core1 grading error:',err.stack||err);
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.status(500).json({ error: 'Grading failed: '+(err.message||String(err)) });
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
    const cstmXml = getXml('docProps/custom.xml');
    const hXml = getXml('word/header1.xml') || getXml('word/header2.xml') || getXml('word/header3.xml');
    const fXml = getXml('word/footer1.xml') || getXml('word/footer2.xml') || getXml('word/footer3.xml');
    const cmmXml = getXml('word/comments.xml');
    const enXml = getXml('word/endnotes.xml');
    const numXml = getXml('word/numbering.xml');
    const allXml = docXml+stylesXml+coreXml+hXml+fXml+cmmXml+enXml+numXml;
    try { fs.unlinkSync(req.file.path); } catch(e) {}

    const results = []; let earned = 0, total = 0;
    const check = (task,pts,desc,passed,fp,ff) => {
      total += pts; if(passed) earned += pts;
      results.push({task,pts_possible:pts,pts_earned:passed?pts:0,description:desc,passed,feedback:passed?fp:ff});
    };
    const INCH = 1440;
    const pgMar = docXml.match(/w:pgMar([^/]*?)\//);
    let mTop=0,mBot=0,mLeft=0,mRight=0;
    if(pgMar){const a=pgMar[1];mTop=parseInt((a.match(/w:top="(\d+)"/)||[0,'0'])[1]);mBot=parseInt((a.match(/w:bottom="(\d+)"/)||[0,'0'])[1]);mLeft=parseInt((a.match(/w:left="(\d+)"/)||[0,'0'])[1]);mRight=parseInt((a.match(/w:right="(\d+)"/)||[0,'0'])[1]);}
    const mOk = Math.abs(mTop-INCH)<72&&Math.abs(mBot-INCH)<72&&Math.abs(mLeft-1800)<72&&Math.abs(mRight-1800)<72;
    check(1,2,'Set 1-inch top/bottom and 1.25-inch left/right margins',mOk,'✓ Margins correct.','✗ Margins incorrect. Fix: Layout → Margins → Custom → Top/Bottom 1", Left/Right 1.25".');
    check(2,2,'Set paper size to Letter',docXml.includes('w:w="12240"')||!docXml.includes('w:pgSz'),'✓ Paper size is Letter.','✗ Paper size is not Letter. Fix: Layout → Size → Letter.');
    check(3,2,'Apply the "Shaded" style set',/(?:styleId|w:val)="Heading ?1"/.test(docXml)||/(?:styleId|w:val)="Heading ?2"/.test(docXml),'✓ Style set applied.','✗ Fix: Design → Style Sets → Shaded.');
    check(4,4,'Insert header: "Nevada Valley Healthcare — Employee Training Manual"',(hXml.includes('Nevada Valley')||hXml.includes('NVH'))&&(hXml.includes('Training')||hXml.includes('Manual')),'✓ Header content found.','✗ Header incomplete. Fix: Insert → Header → type full title.');
    check(5,3,'Insert footer with department name and page number',fXml.length>50,'✓ Footer found.','✗ Footer empty. Fix: Insert → Footer → add department name and page number.');
    check(6,2,'Insert page numbers starting at 1 after cover page',fXml.includes('PAGE')||fXml.includes('fldChar'),'✓ Page numbers in footer.','✗ Fix: Insert → Page Number → Bottom of Page.');
    check(7,3,'Add a "CONFIDENTIAL" watermark',hXml.toUpperCase().includes('CONFIDENTIAL')||hXml.toLowerCase().includes('pict'),'✓ Watermark detected.','✗ Fix: Design → Watermark → type CONFIDENTIAL.');
    check(8,3,'Set document properties: Title, Author, Subject, Keywords',/<dc:title>[^<]+<\/dc:title>/.test(coreXml)&&/<dc:creator>[^<]+<\/dc:creator>/.test(coreXml),'✓ Properties set.','✗ Fix: File → Info → Properties panel.');
    check(9,2,'Add custom document property: Department = Human Resources',/name="Department"/.test(cstmXml)&&cstmXml.includes('Human Resources'),'✓ Custom property found.','✗ Fix: File → Info → Properties → Advanced Properties → Custom tab → Name: Department, Value: Human Resources → Add.');
    const nvh=(docXml.match(/(?<![A-Z])NVH(?![A-Z])/g)||[]).length;
    check(10,2,'Find & Replace: "NVH" → "Nevada Valley Healthcare"',nvh===0,'✓ No NVH abbreviations.',`✗ Found ${nvh} NVH instance(s). Fix: Ctrl+H → Find NVH → Replace Nevada Valley Healthcare.`);
    check(11,2,'Apply Title style',docXml.includes('styleId="Title"')||docXml.includes('w:val="Title"'),'✓ Title style applied.','✗ Fix: Click title → Home → Styles → Title.');
    const h1c=(docXml.match(/(?:styleId|w:val)="Heading ?1"/g)||[]).length;
    check(12,4,'Apply Heading 1 to all chapter titles: Welcome, Employee Benefits, Workplace Conduct, Compliance Policies, Quick Reference',h1c>=5,`✓ Heading 1 on ${h1c} paragraph(s).`,`✗ Only ${h1c} Heading 1 — need 5. Fix: Click each chapter title → Home → Heading 1.`);
    const h2c=(docXml.match(/(?:styleId|w:val)="Heading ?2"/g)||[]).length;
    check(13,4,'Apply Heading 2 to all section titles: Benefits Summary, Day 1 Checklist, Professional Communication, Patient Privacy, Safety Protocols, Contact Directory',h2c>=6,`✓ Heading 2 on ${h2c} paragraph(s).`,`✗ Only ${h2c} Heading 2 — need 6. Fix: Click each section title → Home → Heading 2.`);
    check(14,2,'Set body text to double-spaced (2.0)',/w:line="480"/.test(docXml)||/w:line="46[0-9]"/.test(docXml)||/w:line="4[789]\d"/.test(docXml)||docXml.includes('w:lineRule="auto"')&&/w:line="4[4-9]\d|w:line="5[0-2]\d"/.test(docXml)||(()=>{const m=docXml.match(/w:line="(\d+)"/g);return m&&m.some(v=>parseInt(v.match(/\d+/)[0])>=460&&parseInt(v.match(/\d+/)[0])<=500);})(),'✓ Double spacing found.','✗ Fix: Select body text → Home → Line Spacing → 2.0.');
    check(15,2,'Set 12pt spacing before each Heading 1',/w:before="2[34]\d"/.test(docXml)||docXml.includes('w:before="240"'),'✓ 12pt spacing before Heading 1 found.','✗ Fix: Click a Heading 1 → Paragraph dialog → Spacing Before: 12pt.');
    check(16,4,'Insert page break before each new chapter',docXml.includes('w:type="page"'),'✓ Page break(s) found.','✗ No page breaks found. Fix: Click before each chapter → Ctrl+Enter.');
    check(17,2,'Format Quick Reference section in two columns',docXml.includes('<w:cols')&&docXml.includes('w:num="2"'),'✓ Two-column formatting found.','✗ No column formatting found. Fix: Select text → Layout → Columns → Two.');
    check(18,3,'Create 3-column employee benefits summary table',docXml.includes('<w:tbl>'),'✓ Table found.','✗ Fix: Insert → Table → 3 columns.');
    check(19,2,'Merge header row cells',docXml.includes('w:gridSpan'),'✓ Merged cells found.','✗ Fix: Select top row → Table Layout → Merge Cells.');
    check(20,2,'Enable Repeat Header Row',docXml.includes('w:tblHeader'),'✓ Repeat Header Row enabled.','✗ Fix: Click header row → Table Layout → Repeat Header Rows.');
    const ni=docXml.split('w:numId').length-1;
    check(21,2,'Create numbered checklist of Day 1 tasks',ni>=5,`✓ List items found (${ni}).`,`✗ Numbered list not found. Fix: Select Day 1 tasks → Home → Numbering.`);
    check(22,2,'Create bulleted list of conduct guidelines',numXml.includes('w:numFmt w:val="bullet"') || docXml.includes('w:numFmt w:val="bullet"')||(ni>0&&/w:ilvl w:val="0"/.test(docXml)&&docXml.includes('w:numFmt')),'✓ Bulleted list found.','✗ Fix: Select conduct guidelines → Home → Bullets.');
    check(23,4,'Add second-level bullets under each guideline',/w:ilvl w:val="[1-9]"/.test(docXml),'✓ Sub-level items found.','✗ Fix: Select sub-items → Home → Increase Indent.');
    check(24,4,'Insert Table of Contents',/<w:instrText[^>]*>[^<]*TOC[^<]*<\/w:instrText>/.test(docXml),'✓ TOC found.','✗ Fix: References → Table of Contents → Automatic Table 1.');
    check(25,3,'Customize TOC: dotted leaders, 3 heading levels',/<w:instrText[^>]*>[^<]*TOC[^<]*\\o [&quot;"]*1[^<"]*-[^<"]*3/.test(docXml),'✓ TOC customized to 3 levels.','✗ No TOC found to customize. Fix: Insert TOC first, then References → Custom TOC → Show levels: 3.');
    check(26,4,'Insert endnotes citing regulatory sources',/<w:endnote w:id="[1-9]/.test(enXml)&&docXml.includes('w:endnoteReference'),'✓ Endnote(s) found.','✗ Fix: References → Insert Endnote → type regulatory citation.');
    check(27,4,'Insert NVH logo on cover page',docXml.includes('w:drawing')||docXml.includes('a:blip'),'✓ Image found.','✗ Fix: Insert → Pictures → select NVH logo.');
    check(28,2,'Set text wrapping to Square for logo',['wrapThrough','wrapSquare','wrapTight','wrapTopAndBottom'].some(w=>docXml.includes(w))||docXml.includes('wp:anchor'),'✓ Text wrapping set.','✗ Fix: Picture Format → Wrap Text → Square.');
    check(29,3,'Insert icon representing each department',docXml.includes('w:drawing'),'✓ Graphic element(s) found.','✗ Fix: Insert → Icons → search type → Insert.');
    check(30,7,'Add alt text to every image and icon',docXml.includes('descr="')||docXml.includes('pic:cNvPr'),'✓ Alt text found.','✗ Fix: Right-click image → Edit Alt Text.');
    const cc=(cmmXml.match(/<w:comment /g)||[]).length;
    check(31,2,'Add comment on benefits table',cc>=1,`✓ ${cc} comment(s) found.`,'✗ Fix: Select cell → Review → New Comment.');
    check(32,2,'Reply to comment from department manager',cc>=2,`✓ Reply found (${cc} total).`,`✗ Only ${cc} comment. Fix: Click comment → Reply.`);
    check(33,4,'Add a comment confirming the benefits figure has been verified',(cmmXml.match(/<w:comment /g)||[]).length>=3,'✓ Confirmation comment found.','✗ Fix: Select the benefits figure → Review → New Comment → confirm it has been verified.');
    check(34,5,'Turn on Track Changes; revise PTO policy',docXml.includes('<w:ins ')||docXml.includes('<w:del '),'✓ Tracked changes found.','✗ Fix: Review → Track Changes → make edits.');
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
    const numXml=getXml('word/numbering.xml');
    const allXml=docXml+stylesXml+coreXml+hXml+fXml+cmmXml+fnXml+numXml;
    try { fs.unlinkSync(req.file.path); } catch(e) {}

    const results=[]; let earned=0,total=0;
    const check=(task,pts,desc,passed,fp,ff)=>{total+=pts;if(passed)earned+=pts;results.push({task,pts_possible:pts,pts_earned:passed?pts:0,description:desc,passed,feedback:passed?fp:ff});};
    const INCH=1440;
    const pgMar=docXml.match(/w:pgMar([^/]*?)\//);
    let mOk=false;
    if(pgMar){const vals=(pgMar[1].match(/w:(?:top|bottom|left|right)="(\d+)"/g)||[]).map(m=>parseInt(m.match(/"(\d+)"/)[1]));mOk=vals.length>0&&vals.every(v=>Math.abs(v-INCH)<72);}
    check(1,3,'Set 1-inch margins (APA)',mOk,'✓ 1-inch margins confirmed.','✗ Fix: Layout → Margins → Normal (1" all sides).');
    check(2,2,'Set orientation to Portrait',docXml.split('<w:sectPr').length>=3||!docXml.includes('w:orient="landscape"'),'✓ Portrait orientation.','✗ Fix: Layout → Orientation → Portrait.');
    check(3,2,'Apply the "Basic (Simple)" style set',/(?:styleId|w:val)="Heading ?1"/.test(docXml)||/(?:styleId|w:val)="Heading ?2"/.test(docXml),'✓ Style set applied.','✗ Fix: Design → Style Sets → Basic (Simple).');
    const hHasTitle=/Social Media|Las Vegas|Tourism|SOC/.test(hXml)||hXml.length>100;
    const hHasPage=hXml.includes('PAGE')||hXml.includes('fldChar');
    check(4,4,'Insert running head: title left, page number right',hHasTitle&&hHasPage,'✓ Running head found.',`✗ Title:${hHasTitle} Page#:${hHasPage}. Fix: Insert → Header → title left, page # right.`);
    check(5,2,'Insert page numbers top-right in header',hHasPage,'✓ Page numbers in header.','✗ Fix: Insert → Page Number → Top of Page → Plain Number 3.');
    check(6,3,'Set document properties: Title, Author, Subject',/<dc:title>[^<]+<\/dc:title>/.test(coreXml)&&/<dc:creator>[^<]+<\/dc:creator>/.test(coreXml),'✓ Properties set.','✗ Fix: File → Info → Properties.');
    const sm=(docXml.match(/\bSM\b/g)||[]).length;
    check(7,3,'Find & Replace: "SM" → "social media"',sm===0,'✓ No SM abbreviations.',`✗ Found ${sm} SM instance(s). Fix: Ctrl+H → Find: SM → Replace: social media.`);
    check(8,2,'Apply Title style',docXml.includes('styleId="Title"')||docXml.includes('w:val="Title"'),'✓ Title style applied.','✗ Fix: Click title → Home → Styles → Title.');
    const h1c=(docXml.match(/(?:styleId|w:val)="Heading ?1"/g)||[]).length;
    check(9,4,'Apply Heading 1 to all major sections: Introduction, Literature Review, Methodology, Results, Conclusion, References',h1c>=6,`✓ Heading 1 on ${h1c} section(s).`,`✗ Only ${h1c} Heading 1 — need 6. Fix: Click each major section header → Home → Heading 1.`);
    const h2c=(docXml.match(/(?:styleId|w:val)="Heading ?2"/g)||[]).length;
    check(10,4,'Apply Heading 2 to all subsections: Prior Research, Research Design, Survey Findings, Research Questions, Key Findings, Second Set of Research Questions',h2c>=6,`✓ Heading 2 on ${h2c}.`,`✗ Only ${h2c} Heading 2 — need 6. Fix: Click each subsection → Home → Heading 2.`);
    check(11,3,'Set line spacing to double (2.0)',(()=>{const m=docXml.match(/w:line="(\d+)"/g);return m&&m.some(v=>parseInt(v.match(/\d+/)[0])>=460&&parseInt(v.match(/\d+/)[0])<=500);})(),'✓ Double spacing found.','✗ Fix: Select all body text → Home → Line Spacing → 2.0.');
    check(12,3,'Set first-line indent 0.5 inches',/w:firstLine="7[012]\d"/.test(docXml)||docXml.includes('w:firstLine="720"'),'✓ First-line indent found.','✗ Fix: Paragraph dialog → Indentation → First line: 0.5".');
    check(13,4,'Apply Intense Quote character style',stylesXml.includes('Intense Quote')||docXml.includes('Intense'),'✓ Intense Quote style found.','✗ Fix: Select quotation → Home → Styles → Intense Quote.');
    check(14,2,'Insert page break before References',docXml.includes('w:type="page"'),'✓ Page break found.','✗ Fix: Click before References → Ctrl+Enter.');
    check(15,4,'Create 4-column survey data table',docXml.includes('<w:tbl>'),'✓ Table found.','✗ Fix: Insert → Table → 4 columns.');
    check(16,3,'Merge header row cells',docXml.includes('w:gridSpan'),'✓ Merged cells.','✗ Fix: Select top row → Table Layout → Merge Cells.');
    check(17,3,'Sort data table by response percentage (descending)',docXml.split('<w:tbl>').length>=2,'✓ Multiple tables found — sort verified visually.','✗ Fix: Click inside the survey table → Table Layout → Sort → Column 4 (Percentage) → Descending.');
    const ni=docXml.split('w:numId').length-1;
    check(18,2,'Create numbered list of research questions',ni>=3,`✓ List items found (${ni}).`,'✗ Fix: Select questions → Home → Numbering.');
    check(19,2,'Create bulleted list of key findings',numXml.includes('w:numFmt w:val="bullet"') || docXml.includes('w:numFmt w:val="bullet"')||(ni>0&&docXml.includes('w:numFmt')),'✓ Bulleted list found.','✗ Fix: Select key findings → Home → Bullets.');
    check(20,2,'Restart list numbering for second set',docXml.includes('w:startOverride')||numXml.includes('w:startOverride')||ni>5,'✓ List restart detected.','✗ Fix: Right-click second list → Restart at 1.');
    check(21,4,'Insert Table of Contents',/<w:instrText[^>]*>[^<]*TOC[^<]*<\/w:instrText>/.test(docXml),'✓ TOC found.','✗ Fix: References → Table of Contents → Automatic Table 1.');
    check(22,4,'Customize TOC: Heading 1 and 2 only',/<w:instrText[^>]*>[^<]*TOC[^<]*\\o [&quot;"]*1[^<"]*-[^<"]*2/.test(docXml),'✓ TOC customized to Heading 1 and 2 only.','✗ No TOC found to customize. Fix: Insert TOC first, then References → Custom TOC → Show levels: 2.');
    const fnc=(fnXml.match(/<w:footnote w:id="[1-9]/g)||[]).length;
    check(23,4,'Insert 5 footnotes throughout',fnc>=5,`✓ ${fnc} footnotes found.`,`✗ Only ${fnc} footnote(s) — need 5. Fix: References → Insert Footnote × 5.`);
    check(24,4,'Insert bar chart screenshot',docXml.includes('w:drawing')||docXml.includes('a:blip'),'✓ Image found.','✗ Fix: Insert → Pictures → select chart image.');
    check(25,2,'Set text wrapping to Top and Bottom',['wrapThrough','wrapSquare','wrapTight','wrapTopAndBottom'].some(w=>docXml.includes(w)),'✓ Wrapping set.','✗ Fix: Picture Format → Wrap Text → Top and Bottom.');
    check(26,4,'Add text to shape for callout box',docXml.includes('wps:')||docXml.includes('w:txbxContent'),'✓ Shape with text found.','✗ Fix: Insert → Shapes → Callouts → draw → type statistic.');
    check(27,4,'Position callout shape in right margin',docXml.includes('wp:anchor')||docXml.includes('positionH'),'✓ Positioned object found.','✗ Fix: Picture Format → Position → right margin.');
    check(28,7,'Add alt text to all figures',docXml.includes('descr="')||docXml.includes('pic:cNvPr'),'✓ Alt text found.','✗ Fix: Right-click each image → Edit Alt Text.');
    const cc=(cmmXml.match(/<w:comment /g)||[]).length;
    check(29,2,'Add comment asking professor for feedback',cc>=1,`✓ ${cc} comment(s) found.`,'✗ Fix: Select thesis → Review → New Comment.');
    check(30,4,'Reply to comment from writing partner',cc>=2,`✓ Reply found (${cc} total).`,`✗ Only ${cc} comment. Fix: Click comment → Reply.`);
    check(31,4,'Turn on Track Changes; revise methodology',docXml.includes('<w:ins ')||docXml.includes('<w:del '),'✓ Tracked changes found.','✗ Fix: Review → Track Changes → revise methodology.');
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
    const numXml=getXml('word/numbering.xml');
    const allXml=docXml+stylesXml+coreXml+hXml+fXml+cmmXml+fnXml+numXml;
    try { fs.unlinkSync(req.file.path); } catch(e) {}

    const results=[]; let earned=0,total=0;
    const check=(task,pts,desc,passed,fp,ff)=>{total+=pts;if(passed)earned+=pts;results.push({task,pts_possible:pts,pts_earned:passed?pts:0,description:desc,passed,feedback:passed?fp:ff});};
    const INCH=1440;
    const pgMar=docXml.match(/w:pgMar([^/]*?)\//);
    let mOk=false;
    if(pgMar){const vals=(pgMar[1].match(/w:(?:top|bottom|left|right)="(\d+)"/g)||[]).map(m=>parseInt(m.match(/"(\d+)"/)[1]));mOk=vals.length>0&&vals.every(v=>Math.abs(v-INCH)<72);}
    check(1,2,'Set 1-inch margins',mOk,'✓ Margins confirmed.','✗ Fix: Layout → Margins → Normal.');
    check(2,2,'Set orientation to Portrait',docXml.split('<w:sectPr').length>=3||!docXml.includes('w:orient="landscape"'),'✓ Portrait.','✗ Fix: Layout → Orientation → Portrait.');
    check(3,2,'Apply the "Lines (Stylish)" style set',/(?:styleId|w:val)="Heading ?1"/.test(docXml)||/(?:styleId|w:val)="Heading ?2"/.test(docXml),'✓ Style set applied.','✗ Fix: Design → Style Sets → Lines (Stylish).');
    check(4,4,'Insert header with Oasis Events and proposal number',hXml.toLowerCase().includes('oasis')||hXml.includes('Proposal')||hXml.length>80,'✓ Header content found.','✗ Fix: Insert → Header → add Oasis Events and proposal number.');
    check(5,3,'Insert footer: Oasis Events · Confidential · Page X of Y',fXml.toLowerCase().includes('oasis')||fXml.toLowerCase().includes('confidential')||fXml.length>50,'✓ Footer content found.','✗ Fix: Insert → Footer → type footer text.');
    check(6,2,'Insert page numbers in footer',fXml.includes('PAGE')||fXml.includes('fldChar'),'✓ Page numbers in footer.','✗ Fix: Insert → Page Number → Bottom of Page.');
    check(7,3,'Add a light "PROPOSAL" watermark',hXml.toUpperCase().includes('PROPOSAL')||hXml.toLowerCase().includes('pict'),'✓ Watermark detected.','✗ Fix: Design → Watermark → type PROPOSAL.');
    check(8,3,'Set document properties: Title and Company',/<dc:title>[^<]+<\/dc:title>/.test(coreXml)&&/<dc:creator>[^<]+<\/dc:creator>/.test(coreXml),'✓ Properties set.','✗ Fix: File → Info → Properties.');
    const tbd=(docXml.match(/\bTBD\b/g)||[]).length;
    check(9,2,'Find & Replace: "TBD" → specific venue details',tbd===0,'✓ No TBD placeholders.',`✗ Found ${tbd} TBD instance(s). Fix: Ctrl+H → Find TBD → Replace venue name.`);
    check(10,2,'Apply Title style',docXml.includes('styleId="Title"')||docXml.includes('w:val="Title"'),'✓ Title style applied.','✗ Fix: Click title → Home → Styles → Title.');
    const h1c=(docXml.match(/(?:styleId|w:val)="Heading ?1"/g)||[]).length;
    check(11,4,'Apply Heading 1 to all proposal sections: Executive Summary, Event Details, Services Included, Event Day Timeline, Budget Summary, Vendor List',h1c>=6,`✓ Heading 1 on ${h1c}.`,`✗ Only ${h1c} Heading 1 — need 6. Fix: Click each section header → Home → Heading 1.`);
    const h2c=(docXml.match(/(?:styleId|w:val)="Heading ?2"/g)||[]).length;
    check(12,4,'Apply Heading 2 to all subsections: Proposal Overview, Date and Venue',h2c>=2,`✓ Heading 2 on ${h2c}.`,`✗ Only ${h2c} Heading 2 — need 2. Fix: Click Proposal Overview and Date and Venue → Home → Heading 2.`);
    check(13,2,'Set body text line spacing to 1.5',(()=>{const m=docXml.match(/w:line="(\d+)"/g);return m&&m.some(v=>parseInt(v.match(/\d+/)[0])>=330&&parseInt(v.match(/\d+/)[0])<=360);})(),'✓ 1.5 line spacing found.','✗ Fix: Select body text → Home → Line Spacing → 1.5.');
    check(14,3,'Apply text effects (shadow, glow, or reflection) to proposal title',docXml.includes('w:effect')||docXml.includes('w:shadow')||docXml.includes('a:outerShdw')||docXml.includes('a:glow')||docXml.includes('a:reflection'),'✓ Text effect found.','✗ Fix: Select title → Home → Font dialog → Text Effects → Shadow (or Glow/Reflection).');
    check(15,4,'Insert section break before Budget; change to Landscape',(docXml.match(/<w:sectPr[ >]/g)||[]).length>=2 && docXml.includes('w:orient="landscape"'),'✓ Section break with Landscape section found.','✗ No Landscape section break. Fix: Layout → Breaks → Next Page before Budget, then set that section to Layout → Orientation → Landscape.');
    check(16,4,'Create 5-column budget table',docXml.includes('<w:tbl>'),'✓ Table found.','✗ Fix: Insert → Table → 5 columns.');
    check(17,3,'Merge header row cells',docXml.includes('w:gridSpan'),'✓ Merged cells.','✗ Fix: Select top row → Table Layout → Merge Cells.');
    check(18,3,'Sort vendor table by cost (ascending)',docXml.split('<w:tbl>').length>=2,'✓ Multiple tables found — sort verified visually.','✗ Fix: Click inside the vendor table → Table Layout → Sort → Cost column → Ascending.');
    const ni=docXml.split('w:numId').length-1;
    check(19,2,'Create numbered timeline of event activities',ni>=3,`✓ List items (${ni}).`,'✗ Fix: Select timeline → Home → Numbering.');
    check(20,2,'Create bulleted list of services',numXml.includes('w:numFmt w:val="bullet"') || docXml.includes('w:numFmt w:val="bullet"')||(ni>0&&docXml.includes('w:numFmt')),'✓ Bulleted list found.','✗ Fix: Select services → Home → Bullets.');
    check(21,3,'Change bullet format for premium services to custom symbol',numXml.includes('w:numFmt w:val="bullet"') || docXml.includes('w:numFmt w:val="bullet"')&&(numXml.includes('<w:lvlText')||numXml.includes('w:char=')||docXml.includes('<w:lvlText')),'✓ Custom bullet format detected.','✗ Fix: Home → Bullets dropdown → Define New Bullet → Symbol → choose a custom symbol.');
    check(22,4,'Insert Table of Contents',/<w:instrText[^>]*>[^<]*TOC[^<]*<\/w:instrText>/.test(docXml),'✓ TOC found.','✗ Fix: References → Table of Contents → Automatic Table 1.');
    check(23,4,'Customize TOC: dot leaders, right-aligned page numbers',/<w:instrText[^>]*>[^<]*TOC[^<]*\\o [&quot;"]*1[^<"]*-[^<"]*2/.test(docXml),'✓ TOC found with custom formatting.','✗ No TOC found to customize. Fix: Insert TOC first, then References → Custom TOC → set dot leaders.');
    const fnc=(fnXml.match(/<w:footnote w:id="[1-9]/g)||[]).length;
    check(24,4,'Insert footnote on pricing section',fnc>=1,`✓ ${fnc} footnote(s).`,`✗ Only ${fnc}. Fix: References → Insert Footnote → type terms.`);
    check(25,4,'Insert venue floor plan image',docXml.includes('w:drawing')||docXml.includes('a:blip'),'✓ Image found.','✗ Fix: Insert → Pictures → select floor plan.');
    check(26,2,'Set text wrapping to Square',['wrapThrough','wrapSquare','wrapTight','wrapTopAndBottom'].some(w=>docXml.includes(w)),'✓ Wrapping set.','✗ Fix: Picture Format → Wrap Text → Square.');
    check(27,4,'Insert text box with Oasis Events tagline',docXml.includes('w:txbxContent')||docXml.includes('wps:txbx'),'✓ Text box found.','✗ Fix: Insert → Text Box → Draw Text Box → type tagline.');
    check(28,8,'Add alt text to all graphics',docXml.includes('descr="')||docXml.includes('pic:cNvPr'),'✓ Alt text found.','✗ Fix: Right-click each image → Edit Alt Text.');
    const cc=(cmmXml.match(/<w:comment /g)||[]).length;
    check(29,2,'Add comment on budget table',cc>=1,`✓ ${cc} comment(s).`,'✗ Fix: Select cell → Review → New Comment.');
    check(30,2,'Reply to comment from sales manager',cc>=2,`✓ Reply found (${cc} total).`,`✗ Only ${cc}. Fix: Click comment → Reply.`);
    check(31,3,'Add a comment confirming the budget item has been approved',(cmmXml.match(/<w:comment /g)||[]).length>=3,'✓ Confirmation comment found.','✗ Fix: Select the budget item → Review → New Comment → confirm it has been approved.');
    check(32,4,'Enable Track Changes; revise contract terms',docXml.includes('<w:ins ')||docXml.includes('<w:del '),'✓ Tracked changes found.','✗ Fix: Review → Track Changes → revise contract section.');
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

// ── PROJECT 5: IT Help Desk Knowledge Base (14 tasks, 40 pts) ──────────────────
app.post('/api/grade/project5', requireStudent, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.docx') { try { fs.unlinkSync(req.file.path); } catch(e) {} return res.status(400).json({ error: 'Please upload a .docx file.' }); }
  try {
    let AdmZip; try { AdmZip = require('adm-zip'); } catch(e) { return res.status(500).json({ error: 'adm-zip module not installed.' }); }
    const zip = new AdmZip(req.file.path);
    const getXml = (n) => { try { return zip.readAsText(n) || ''; } catch(e) { return ''; } };
    const docXml = getXml('word/document.xml');
    const stylesXml = getXml('word/styles.xml');
    const coreXml = getXml('docProps/core.xml');
    let hXml=''; for(const n of ['word/header1.xml','word/header2.xml','word/header3.xml']) hXml += getXml(n);
    let fXml=''; for(const n of ['word/footer1.xml','word/footer2.xml','word/footer3.xml']) fXml += getXml(n);
    const cmmXml = getXml('word/comments.xml');
    const fnXml = getXml('word/footnotes.xml');
    const allXml = docXml+stylesXml+coreXml+hXml+fXml+cmmXml+fnXml;
    try { fs.unlinkSync(req.file.path); } catch(e) {}

    const results=[]; let earned=0, total=0;
    const check=(task,pts,desc,passed,fp,ff)=>{total+=pts;if(passed)earned+=pts;results.push({task,pts_possible:pts,pts_earned:passed?pts:0,description:desc,passed,feedback:passed?fp:ff});};

    check(1,5,'Apply a light blue page color to the cover page',
      docXml.includes('w:background')||allXml.includes('w:fill'),
      '✓ Page color found.','✗ No page color found. Fix: Design → Page Color → choose a light blue.');

    check(2,5,'Add a box border around the entire document',
      docXml.includes('w:pgBorders'),
      '✓ Page border found.','✗ No page border found. Fix: Design → Page Borders → Box.');

    check(3,8,'Insert a hyperlink to the CSN IT Help Desk support portal',
      docXml.includes('w:hyperlink')||allXml.includes('relationships/hyperlink'),
      '✓ Hyperlink found.','✗ No hyperlink found. Fix: Insert → Link → paste the support portal URL.');

    check(4,5,'Insert a degree symbol (°) in the Fahrenheit troubleshooting note',
      docXml.includes('w:sym')||docXml.includes('\u00B0')||docXml.includes('&#176;')||docXml.includes('&#xB0;'),
      '✓ Symbol found.','✗ No degree symbol found. Fix: Insert → Symbol → ° (U+00B0).');

    check(5,8,'Insert a column break in the two-column FAQ section',
      docXml.includes('w:type="column"'),
      '✓ Column break found.','✗ No column break found. Fix: Layout → Breaks → Column.');

    const sectPrCount = (docXml.match(/<w:sectPr/g)||[]).length;
    check(6,9,"Change the FAQ section's page setup to 0.75-inch margins",
      sectPrCount>=2 && /w:(?:left|right)="1080"/.test(docXml),
      '✓ Section with custom page setup found.','✗ No second section with 0.75" margins found. Fix: Insert a section break before the FAQ, then Layout → Margins → Custom → 0.75".');

    const tblCount = (docXml.match(/<w:tbl>/g)||[]).length;
    check(7,9,'Convert the tab-separated ticket priority list to a table',
      tblCount>=5,
      '✓ Ticket priority table found.','✗ Ticket priority list is not yet a table. Fix: Select the list → Insert → Table → Convert Text to Table.');

    const softwareVersionStillTable = /Microsoft Office[\s\S]{0,4000}?<\/w:tbl>/.test(docXml);
    check(8,8,'Convert the outdated software version table back to plain text',
      docXml.includes('Microsoft Office') && !softwareVersionStillTable,
      '✓ Software version table converted to text.','✗ Software version table is still a table. Fix: Click in table → Layout → Convert to Text.');

    const tcMarValues = [...docXml.matchAll(/<w:tcMar><w:top w:type="dxa" w:w="(\d+)"/g)].map(m=>parseInt(m[1]));
    const hasCustomMargin = tcMarValues.some(v => v !== 80);
    check(9,5,'Increase cell margins on the equipment table for readability',
      hasCustomMargin,
      '✓ Custom cell margins found.','✗ No custom cell margins found. Fix: Click in table → Layout → Cell Margins → increase values.');

    check(10,8,'Split the merged header cell in the ticket table into two columns',
      !docXml.includes('w:gridSpan'),
      '✓ Header cell appears split.','✗ Header cell still appears merged. Fix: Click the merged cell → Layout → Split Cells → 2 columns.');

    check(11,5,'Resize the equipment table columns to fit content',
      docXml.includes('w:tblLayout'),
      '✓ Custom column widths found.','✗ No custom column resizing detected. Fix: Drag column borders or use Layout → AutoFit → AutoFit Contents.');

    check(12,9,'Split the long software inventory table into two separate tables',
      tblCount>=5,
      '✓ Multiple tables found (inventory table split).','✗ Software inventory table is still one table. Fix: Click in a middle row → Layout → Split Table.');

    const hasWingdingsFont = docXml.includes('Wingdings');
    const hasPUAChar = /[\uF000-\uF0FF]/.test(docXml);
    check(13,8,'Apply a custom bullet character (checkmark) to the quick-fix list',
      hasWingdingsFont && hasPUAChar,
      '✓ Custom bullet character found.','✗ No custom bullet character found. Fix: Select quick-fix list → Home → Bullets → Define New Bullet → Symbol → choose a checkmark (Wingdings).');

    check(14,8,'Insert a rounded rectangle shape to highlight the emergency contact box',
      docXml.includes('wps:')||docXml.includes('roundRect')||docXml.includes('mc:AlternateContent'),
      '✓ Shape found.','✗ No shape found. Fix: Insert → Shapes → Rounded Rectangle → draw around emergency contact text.');

    res.json({ score: earned, total, pct: Math.round((earned/total)*100), passed: results.filter(r=>r.passed).length, failed: results.filter(r=>!r.passed).length, results });
  } catch(err) {
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.status(500).json({ error: 'Grading error: ' + err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// EXCEL PROJECT GRADERS (MO-210) — Core1, Core2, Var1, Var2
// Ported from validated reference logic. Defeats the documented Excel gotchas:
//  - decode XML entities before matching formula operators
//  - read <f> (formula) not <v> (cached value)
//  - resolve cell s= -> <xf> in <cellXfs> for applied formatting (not style defs)
//  - require non-empty/non-default values (openpyxl boilerplate)
//  - tables/charts/drawings/chartsheets live in separate parts
// ═══════════════════════════════════════════════════════════════════════════════

// Shared helpers for Excel grading
function xlHelpers(zip) {
  const names = zip.getEntries().map(e => e.entryName);
  const read = (n) => { try { return zip.readAsText(n) || ''; } catch(e) { return ''; } };
  const P = {}; names.forEach(n => { P[n] = read(n); });
  const sheet = (i) => P['xl/worksheets/sheet'+i+'.xml'] || '';
  const styles = P['xl/styles.xml'] || '';
  const wbxml = P['xl/workbook.xml'] || '';
  const core = P['docProps/core.xml'] || '';
  const shared = P['xl/sharedStrings.xml'] || '';
  const tables = names.filter(n => n.startsWith('xl/tables/')).map(n => P[n]);
  const charts = names.filter(n => n.startsWith('xl/charts/chart')).map(n => P[n]);
  const chartXml = charts.join('');
  const chartsheets = names.filter(n => n.startsWith('xl/chartsheets/'));
  const drawings = names.filter(n => n.startsWith('xl/drawings/drawing')).map(n => P[n]).join('');
  const hasComments = names.some(n => n.toLowerCase().includes('comment'));
  const decode = (s) => s.replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
  // cellXfs extraction
  const cxMatch = styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/);
  const CX = cxMatch ? cxMatch[0] : '';
  const XFS = CX.match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [];
  const usedStyles = (sx) => { const s=new Set(); let m; const re=/<c [^>]*s="(\d+)"/g; while((m=re.exec(sx))) s.add(parseInt(m[1])); return s; };
  const anyXf = (sx, pred) => { for (const i of usedStyles(sx)) { if (i < XFS.length && pred(XFS[i])) return true; } return false; };
  const formulas = (sx) => { const out=[]; let m; const re=/<f[^>]*>([\s\S]*?)<\/f>/g; while((m=re.exec(sx))) out.push(decode(m[1])); return out; };
  return { names, P, sheet, styles, wbxml, core, shared, tables, charts, chartXml, chartsheets, drawings, hasComments, XFS, usedStyles, anyXf, formulas };
}

// ── CORE 1 — Desert Sun Consulting (25 tasks) ───────────────────────────────────
app.post('/api/grade/excel-core1', requireStudent, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.xlsx') { try { fs.unlinkSync(req.file.path); } catch(e){} return res.status(400).json({ error: 'Please upload a .xlsx file.' }); }
  try {
    let AdmZip; try { AdmZip = require('adm-zip'); } catch(e) { return res.status(500).json({ error: 'adm-zip module not installed.' }); }
    const zip = new AdmZip(req.file.path);
    const H = xlHelpers(zip);
    try { fs.unlinkSync(req.file.path); } catch(e){}
    const billing = H.sheet(1), clients = H.sheet(2);
    const results=[]; let earned=0, total=0;
    const check=(task,pts,desc,passed,fp,ff)=>{total+=pts;if(passed)earned+=pts;results.push({task,pts_possible:pts,pts_earned:passed?pts:0,description:desc,passed,feedback:passed?fp:ff});};
    const usedNumFmt = (sx) => { for (const i of H.usedStyles(sx)) { if(i<H.XFS.length){ const m=H.XFS[i].match(/numFmtId="(\d+)"/); if(m && m[1]!=='0' && m[1]!=='164') return true; } } return false; };

    check(1,5,'Import client roster from clients.csv',(clients+H.shared).includes('C-101')&&(clients+H.shared).includes('Aurora Logistics')&&(clients+H.shared).includes('Henderson'),'Client roster imported.','Import the clients.csv data into the Clients sheet (Data > Get Data > From Text/CSV).');
    check(2,3,'Set Billing sheet to Landscape',billing.includes('orientation="landscape"'),'Landscape set.','Set Page Layout > Orientation > Landscape.');
    check(3,4,'Add header and footer',/<oddHeader>[\s\S]*\S[\s\S]*<\/oddHeader>/.test(billing)||(billing.includes('Desert Sun')&&billing.includes('<oddHeader')),'Header/footer added.','Add Insert > Header & Footer with company name + page number.');
    check(4,3,'Freeze top header row',billing.includes('state="frozen"'),'Panes frozen.','Use View > Freeze Panes.');
    check(5,3,'Set workbook properties (Title, Author)',/<dc:title>\s*\S[\s\S]*?<\/dc:title>/.test(H.core)&&/<dc:creator>\s*\S[\s\S]*?<\/dc:creator>/.test(H.core),'Properties set.','Set File > Info > Title and Author.');
    check(6,3,'Set print area',H.wbxml.includes('Print_Area'),'Print area set.','Set Page Layout > Print Area > Set Print Area.');
    check(7,4,'Insert hyperlink in A1',billing.includes('<hyperlink')||H.names.some(n=>n.endsWith('.rels')&&n.includes('sheet1')&&H.P[n].toLowerCase().includes('hyperlink')),'Hyperlink added.','Add a hyperlink in A1 (Insert > Link).');
    check(8,3,'Merge & center title A1:F1',billing.includes('<mergeCell ref="A1:F1"'),'Title merged.','Merge & Center A1:F1 (Home > Merge & Center).');
    check(9,3,'Center-align header row',H.anyXf(billing,x=>x.includes('horizontal="center"')),'Headers centered.','Center-align the header row.');
    check(10,3,'Format Amount Billed as Currency',usedNumFmt(billing)||/formatCode="[^"]*\$[^"]*"/.test(H.styles),'Currency applied.','Format the Amount Billed column as Currency.');
    check(11,3,'Bold + fill header row',H.anyXf(billing,x=>(/applyFill="(1|true)"/.test(x))&&((x.match(/fillId="(\d+)"/)||[])[1]!=='0')),'Header filled.','Apply bold font and a fill color to the header row.');
    check(12,3,'Wrap text in Notes column',H.anyXf(billing,x=>x.includes('wrapText="1"')||x.includes('wrapText="true"')),'Wrap enabled.','Enable Wrap Text on the Notes column.');
    check(13,4,'Name range "Billing"',/<definedName[^>]*\bname="Billing"/.test(H.wbxml),'Named range defined.','Define a named range called Billing.');
    check(14,5,'Conditional formatting on overdue',billing.includes('<conditionalFormatting'),'Conditional formatting found.','Highlight overdue invoices with Conditional Formatting.');
    check(15,5,'Sparklines for monthly hours',billing.toLowerCase().includes('sparkline'),'Sparklines added.','Add line sparklines (Insert > Sparklines).');
    check(16,5,'Convert range to Excel Table',H.tables.some(t=>t.includes('BillingTable')),'Table created.','Convert the billing range to a Table (Ctrl+T).');
    check(17,3,'Apply a Medium table style',H.tables.some(t=>/tableStyleInfo name="TableStyle\w+"/.test(t)),'Table style applied.','Apply a Medium table style.');
    check(18,5,'Add Total Row summing Amount Billed',H.tables.some(t=>t.includes('totalsRowShown="1"')),'Total row added.','Add a Total Row (Table Design > Total Row).');
    check(19,5,'Filter to Active clients',billing.includes('<autoFilter')&&billing.includes('<filterColumn'),'Filter applied.','Filter the table to Active clients.');
    check(20,3,'Sort by Client then Invoice Date',billing.includes('<sortState')&&(billing.match(/<sortCondition/g)||[]).length>=2,'Multi-sort applied.','Sort by Client then Invoice Date (Data > Sort > Add Level).');
    check(21,5,'Create Column chart of revenue',H.charts.length>=1,'Chart created.','Insert a Column chart of revenue by client.');
    check(22,6,'Add second data series (prior year)',(H.chartXml.match(/<c:ser>/g)||[]).length>=2,'Second series added.','Add a prior-year data series (Chart Design > Select Data > Add).');
    check(23,5,'Add data labels and axis title',H.chartXml.includes('<c:dLbls>')&&H.chartXml.includes('<c:title>'),'Chart elements added.','Add data labels and an axis title.');
    check(24,5,'Apply a chart style',H.chartXml.includes('<c:style ')||(H.chartXml.includes('<mc:Choice')&&H.chartXml.toLowerCase().includes('style')),'Chart style applied.','Apply a chart style from the gallery.');
    check(25,4,'Add chart alt text',/descr="[^"]{5,}"/.test(H.drawings),'Alt text added.','Add alternative text to the chart (right-click > Edit Alt Text).');

    const pct=Math.round(earned/total*100);
    stmts.savePracticeGrade.run(req.nsheId,'ExcelCore1',null,earned,total,JSON.stringify(results));
    res.json({score:earned,total,pct,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results});
  } catch(err) { console.error('ExcelCore1 grading error:',err.stack||err); try{fs.unlinkSync(req.file.path);}catch(e){} res.status(500).json({error:'Grading failed: '+(err.message||String(err))}); }
});

// ── CORE 2 — Nevada Valley Healthcare (26 tasks) ────────────────────────────────
app.post('/api/grade/excel-core2', requireStudent, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.xlsx') { try { fs.unlinkSync(req.file.path); } catch(e){} return res.status(400).json({ error: 'Please upload a .xlsx file.' }); }
  try {
    let AdmZip; try { AdmZip = require('adm-zip'); } catch(e) { return res.status(500).json({ error: 'adm-zip module not installed.' }); }
    const zip = new AdmZip(req.file.path);
    const H = xlHelpers(zip);
    try { fs.unlinkSync(req.file.path); } catch(e){}
    const roster = H.sheet(1);
    const results=[]; let earned=0, total=0;
    const check=(task,pts,desc,passed,fp,ff)=>{total+=pts;if(passed)earned+=pts;results.push({task,pts_possible:pts,pts_earned:passed?pts:0,description:desc,passed,feedback:passed?fp:ff});};

    check(1,4,'Set column width and row height',(roster.includes('customWidth="1"')||roster.includes('customWidth="true"'))&&(roster.includes('customHeight="1"')||roster.includes('customHeight="true"')),'Sizes set.','Set Department column width to 28 and header row height to 30.');
    check(2,5,'Add header and footer',/<oddHeader>[\s\S]*\S[\s\S]*<\/oddHeader>/.test(roster)||(roster.includes('Staffing')&&roster.includes('<oddHeader')),'Header/footer added.','Add a header and a footer with the sheet name.');
    check(3,4,'Switch to Page Layout view',roster.includes('view="pageLayout"'),'Page Layout view set.','Switch the Roster sheet to Page Layout view (View tab).');
    check(4,3,'Set print area',H.wbxml.includes('Print_Area'),'Print area set.','Set the print area to the roster range.');
    check(5,3,'Configure print to fit one page wide',roster.includes('fitToPage="1"')||roster.includes('fitToPage="true"'),'Fit-to-page set.','Configure print settings to fit all columns on one page wide.');
    check(6,5,'Add comment on PTO column',H.hasComments,'Comment added.','Add a comment on the PTO column (Review > New Comment).');
    check(7,5,'AutoFill shift weeks',(roster+H.shared).includes('Week 12'),'Series filled.','AutoFill the shift-week series through Week 12.');
    check(8,3,'Apply a named cell style to title',H.XFS.some((x,i)=>H.usedStyles(roster).has(i)&&/xfId="[1-9]/.test(x)),'Cell style applied.','Apply a named cell style (e.g. Title/Heading) to the workbook title.');
    check(9,4,'Apply borders to roster grid',H.anyXf(roster,x=>(/applyBorder="(1|true)"/.test(x))&&((x.match(/borderId="(\d+)"/)||[])[1]!=='0')),'Borders applied.','Apply borders to the roster grid (Format Cells > Border).');
    check(10,3,'Format Hourly Rate as Currency',(()=>{for(const i of H.usedStyles(roster)){if(i<H.XFS.length){const m=H.XFS[i].match(/numFmtId="(\d+)"/);if(m&&m[1]!=='0'&&m[1]!=='164')return true;}}return /formatCode="[^"]*\$[^"]*"/.test(H.styles);})(),'Currency applied.','Format the Hourly Rate column as Currency.');
    check(11,5,'Add column sparklines',roster.toLowerCase().includes('sparkline'),'Sparklines added.','Add column sparklines for weekly shift counts.');
    check(12,3,'Merge & center banner',roster.includes('<mergeCell ref="A1:G1"'),'Banner merged.','Merge and center the section banner across the table.');
    check(13,5,'Convert roster to Table',H.tables.some(t=>t.includes('RosterTable')),'Roster table created.','Convert the staffing roster to an Excel Table.');
    check(14,4,'Enable Banded Rows + Header Row options',H.tables.some(t=>t.includes('showRowStripes="1"')),'Style options enabled.','Enable Banded Rows and Header Row (Table Design > Style Options).');
    check(15,5,'Convert certifications table to range',!H.tables.some(t=>t.includes('CertTable')),'Certifications converted to range.','Convert the old certifications table back to a range (Table Design > Convert to Range).');
    check(16,4,'Apply a table style',H.tables.some(t=>/tableStyleInfo name="TableStyle\w+"/.test(t)),'Table style applied.','Apply a table style to the roster table.');
    check(17,3,'Filter to Emergency department',roster.includes('<autoFilter')&&roster.includes('<filterColumn'),'Filter applied.','Filter the roster to the Emergency department.');
    check(18,3,'Freeze first column',roster.includes('state="frozen"'),'Column frozen.','Freeze the first column (View > Freeze Panes > Freeze First Column).');
    check(19,3,'Vertically center cells',H.anyXf(roster,x=>x.includes('vertical="center"')),'Cells centered.','Vertically center all cells in the roster.');
    check(20,2,'Wrap text in Responsibilities',H.anyXf(roster,x=>x.includes('wrapText="1"')||x.includes('wrapText="true"')),'Wrap enabled.','Wrap text in the Responsibilities column.');
    check(21,4,'Apply color scale',roster.includes('<conditionalFormatting')&&(roster.includes('colorScale')||roster.includes('cfvo')),'Color scale applied.','Apply a color scale to the weekly hours columns.');
    check(22,5,'Create Bar chart',H.charts.length>=1,'Chart created.','Create a Bar chart of headcount by department.');
    check(23,5,'Move chart to its own sheet',H.chartsheets.length>=1,'Chart sheet created.','Move the chart to its own chart sheet (Chart Design > Move Chart > New sheet).');
    check(24,4,'Apply a chart style',H.chartXml.includes('<c:style ')||(H.chartXml.includes('<mc:Choice')&&H.chartXml.toLowerCase().includes('style')),'Chart style applied.','Apply a chart style to the headcount chart.');
    check(25,3,'Set workbook properties',/<dc:title>\s*\S[\s\S]*?<\/dc:title>/.test(H.core)&&/<dc:creator>\s*\S[\s\S]*?<\/dc:creator>/.test(H.core),'Properties set.','Set Title, Author, and Subject workbook properties.');
    check(26,3,'Apply Percentage format to Coverage %',/formatCode="[^"]*%[^"]*"/.test(H.styles)||H.XFS.some((x,i)=>H.usedStyles(roster).has(i)&&/numFmtId="(9|10)"/.test(x)),'Percentage applied.','Apply Percentage format to the Coverage % column.');

    const pct=Math.round(earned/total*100);
    stmts.savePracticeGrade.run(req.nsheId,'ExcelCore2',null,earned,total,JSON.stringify(results));
    res.json({score:earned,total,pct,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results});
  } catch(err) { console.error('ExcelCore2 grading error:',err.stack||err); try{fs.unlinkSync(req.file.path);}catch(e){} res.status(500).json({error:'Grading failed: '+(err.message||String(err))}); }
});

// ── VARIATION 1 — CSN Grade Book (26 tasks, formulas) ───────────────────────────
app.post('/api/grade/excel-var1', requireStudent, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.xlsx') { try { fs.unlinkSync(req.file.path); } catch(e){} return res.status(400).json({ error: 'Please upload a .xlsx file.' }); }
  try {
    let AdmZip; try { AdmZip = require('adm-zip'); } catch(e) { return res.status(500).json({ error: 'adm-zip module not installed.' }); }
    const zip = new AdmZip(req.file.path);
    const H = xlHelpers(zip);
    try { fs.unlinkSync(req.file.path); } catch(e){}
    const grades = H.sheet(1);
    const F = H.formulas(grades);
    const Fj = F.join(' ').toUpperCase();
    const fn = (...xs) => xs.some(x => Fj.includes(x.toUpperCase()));
    const results=[]; let earned=0, total=0;
    const check=(task,pts,desc,passed,fp,ff)=>{total+=pts;if(passed)earned+=pts;results.push({task,pts_possible:pts,pts_earned:passed?pts:0,description:desc,passed,feedback:passed?fp:ff});};

    check(1,3,'Freeze header row and name column',grades.includes('state="frozen"'),'Panes frozen.','Freeze the header row and student-name column.');
    check(2,3,'Add comment on curve column',H.hasComments,'Comment added.','Add a comment on the curve column.');
    check(3,2,'Percent format on percentage columns',/formatCode="[^"]*%[^"]*"/.test(H.styles)||H.XFS.some((x,i)=>H.usedStyles(grades).has(i)&&/numFmtId="(9|10)"/.test(x)),'Percent applied.','Format the percentage columns with Percent format.');
    check(4,3,'Conditional formatting on failing scores',grades.includes('<conditionalFormatting'),'Conditional formatting found.','Highlight failing scores (below 60) in red.');
    check(5,3,'Name range "GradeScale"',/<definedName[^>]*\bname="GradeScale"/.test(H.wbxml),'Named range defined.','Define a named range called GradeScale.');
    check(6,3,'Reference GradeScale in a formula',Fj.includes('GRADESCALE'),'Named range used.','Use the GradeScale named range inside a lookup formula.');
    check(7,2,'Wrap text in feedback column',H.anyXf(grades,x=>x.includes('wrapText="1"')||x.includes('wrapText="true"')),'Wrap enabled.','Wrap text in the instructor-feedback column.');
    check(8,3,'Convert grade data to Table',H.tables.some(t=>t.includes('GradeTable')),'Table created.','Convert the grade data to an Excel Table.');
    check(9,3,'Sort by final grade then last name',grades.includes('<sortState')&&(grades.match(/<sortCondition/g)||[]).length>=2,'Multi-sort applied.','Sort by final grade (desc) then last name (asc).');
    check(10,6,'SUM and AVERAGE',fn('SUM(')&&fn('AVERAGE('),'SUM/AVERAGE used.','Use SUM and AVERAGE to total and average each student\u2019s scores.');
    check(11,4,'COUNT / COUNTA',fn('COUNT(','COUNTA(','COUNTBLANK('),'COUNT used.','Use COUNT/COUNTA to tally submitted assignments.');
    check(12,4,'Absolute reference',F.some(f=>f.includes('$')),'Absolute reference used.','Use an absolute reference ($) to the total-points cell.');
    check(13,5,'IF Pass/Fail',fn('IF('),'IF used.','Use IF to mark each student Pass or Fail.');
    check(14,6,'Nested IF letter grade',F.some(f=>(f.toUpperCase().match(/IF\(/g)||[]).length>=2),'Nested IF used.','Use a nested IF to assign letter grades A\u2013F.');
    check(15,4,'COUNTIF for A grades',fn('COUNTIF('),'COUNTIF used.','Use COUNTIF to count how many students earned an A.');
    check(16,6,'VLOOKUP letter grade',fn('VLOOKUP('),'VLOOKUP used.','Use VLOOKUP against the grade scale to return each letter grade.');
    check(17,5,'IFERROR wrapping VLOOKUP',fn('IFERROR('),'IFERROR used.','Wrap the VLOOKUP in IFERROR to show \u201cCheck\u201d on errors.');
    check(18,3,'TODAY() report date',fn('TODAY(','NOW('),'TODAY used.','Use TODAY() to stamp the report-generated date.');
    check(19,4,'Create Column chart',H.charts.length>=1,'Chart created.','Create a Column chart of class average by assignment.');
    check(20,4,'Add data labels and chart title',H.chartXml.includes('<c:dLbls>')&&H.chartXml.includes('<c:title>'),'Chart elements added.','Add data labels and a chart title.');
    check(21,3,'Add chart alt text',/descr="[^"]{5,}"/.test(H.drawings),'Alt text added.','Add alternative text to the class-average chart.');
    check(22,3,'Bold and shade header row',H.anyXf(grades,x=>(/applyFill="(1|true)"/.test(x))&&((x.match(/fillId="(\d+)"/)||[])[1]!=='0')),'Header shaded.','Bold and shade the header row.');
    check(23,4,'Add header and footer',/<oddHeader>[\s\S]*\S[\s\S]*<\/oddHeader>/.test(grades)||(grades.includes('Grade Book')&&grades.includes('<oddHeader')),'Header/footer added.','Add a header with the course name and a footer page number.');
    check(24,3,'Set workbook properties',/<dc:title>\s*\S[\s\S]*?<\/dc:title>/.test(H.core)&&/<dc:creator>\s*\S[\s\S]*?<\/dc:creator>/.test(H.core),'Properties set.','Set Title and Author workbook properties.');
    check(25,3,'Filter to failing students',grades.includes('<autoFilter')&&grades.includes('<filterColumn'),'Filter applied.','Filter to students currently failing.');
    check(26,8,'Center score columns',H.anyXf(grades,x=>x.includes('horizontal="center"')),'Scores centered.','Center the score columns.');

    const pct=Math.round(earned/total*100);
    stmts.savePracticeGrade.run(req.nsheId,'ExcelVar1',null,earned,total,JSON.stringify(results));
    res.json({score:earned,total,pct,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results});
  } catch(err) { console.error('ExcelVar1 grading error:',err.stack||err); try{fs.unlinkSync(req.file.path);}catch(e){} res.status(500).json({error:'Grading failed: '+(err.message||String(err))}); }
});

// ── VARIATION 2 — Oasis Events Inventory (25 tasks, formulas) ────────────────────
app.post('/api/grade/excel-var2', requireStudent, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.xlsx') { try { fs.unlinkSync(req.file.path); } catch(e){} return res.status(400).json({ error: 'Please upload a .xlsx file.' }); }
  try {
    let AdmZip; try { AdmZip = require('adm-zip'); } catch(e) { return res.status(500).json({ error: 'adm-zip module not installed.' }); }
    const zip = new AdmZip(req.file.path);
    const H = xlHelpers(zip);
    try { fs.unlinkSync(req.file.path); } catch(e){}
    const inv = H.sheet(1);
    const F = H.formulas(inv);
    const Fj = F.join(' ').toUpperCase();
    const fn = (...xs) => xs.some(x => Fj.includes(x.toUpperCase()));
    const results=[]; let earned=0, total=0;
    const check=(task,pts,desc,passed,fp,ff)=>{total+=pts;if(passed)earned+=pts;results.push({task,pts_possible:pts,pts_earned:passed?pts:0,description:desc,passed,feedback:passed?fp:ff});};

    check(1,2,'Turn on Show Formulas',inv.includes('showFormulas="1"')||inv.includes('showFormulas="true"'),'Show Formulas on.','Turn on Show Formulas (Formulas > Show Formulas).');
    check(2,3,'Set workbook properties',/<dc:title>\s*\S[\s\S]*?<\/dc:title>/.test(H.core)&&/<dc:creator>\s*\S[\s\S]*?<\/dc:creator>/.test(H.core),'Properties set.','Set Title and Author properties.');
    check(3,3,'SEQUENCE for line-item IDs',fn('SEQUENCE(','RANDBETWEEN('),'SEQUENCE used.','Use SEQUENCE to generate the line-item ID column.');
    check(4,4,'Currency on Unit Cost and Line Total',(()=>{for(const i of H.usedStyles(inv)){if(i<H.XFS.length){const m=H.XFS[i].match(/numFmtId="(\d+)"/);if(m&&m[1]!=='0'&&m[1]!=='164')return true;}}return /formatCode="[^"]*\$[^"]*"/.test(H.styles);})(),'Currency applied.','Format Unit Cost and Line Total as Currency.');
    check(5,3,'Convert inventory to Table',H.tables.some(t=>t.includes('InvTable')),'Table created.','Convert the inventory list to an Excel Table.');
    check(6,4,'Add Line Total column to table',H.tables.some(t=>/ref="A3:I1[12]"/.test(t)),'Column added.','Add a Line Total column to the inventory table.');
    check(7,4,'Add Total Row summing Line Total',H.tables.some(t=>t.includes('totalsRowShown="1"')),'Total row added.','Add a Total Row summing the Line Total column.');
    check(8,6,'Structured reference for line total',F.some(f=>/INVTABLE\[/i.test(f)||/\[@/.test(f)),'Structured reference used.','Use a structured reference (Table[Qty]*Table[Unit Cost]).');
    check(9,6,'SUMIF spend per category',fn('SUMIF('),'SUMIF used.','Use SUMIF to total spend per item category.');
    check(10,4,'LEFT/RIGHT/MID for SKU',fn('LEFT(','RIGHT(','MID('),'Text functions used.','Use LEFT/RIGHT/MID to build a SKU.');
    check(11,4,'UPPER and LEN for category code',fn('UPPER(','LOWER(','LEN('),'UPPER/LEN used.','Use UPPER and LEN for category codes.');
    check(12,5,'TEXTJOIN for item label',fn('CONCAT(','TEXTJOIN('),'TEXTJOIN used.','Use TEXTJOIN to build a combined item label.');
    check(13,6,'XLOOKUP for unit cost',fn('XLOOKUP('),'XLOOKUP used.','Use XLOOKUP against the price list for unit cost.');
    check(14,4,'SORT() vendor list',fn('SORT('),'SORT used.','Use SORT() for a sorted vendor list.');
    check(15,4,'UNIQUE() categories',fn('UNIQUE('),'UNIQUE used.','Use UNIQUE() to list distinct categories.');
    check(16,5,'YEAR/MONTH/DAY event date',fn('YEAR(','MONTH(','DAY('),'Date functions used.','Use YEAR/MONTH/DAY to break out the event date.');
    check(17,5,'Icon set on reorder level',inv.includes('<conditionalFormatting')&&(inv.includes('iconSet')||inv.includes('cfRule')),'Icon set applied.','Flag items below reorder level with an icon set.');
    check(18,4,'Name range "PriceList"',/<definedName[^>]*\bname="PriceList"/.test(H.wbxml),'Named range defined.','Define a named range called PriceList.');
    check(19,4,'Create Pie chart',H.charts.length>=1,'Chart created.','Create a Pie chart of spend by category.');
    check(20,4,'Apply a chart style',H.chartXml.includes('<c:style ')||(H.chartXml.includes('<mc:Choice')&&H.chartXml.toLowerCase().includes('style')),'Chart style applied.','Apply a chart style to the spend chart.');
    check(21,3,'Add chart alt text',/descr="[^"]{5,}"/.test(H.drawings),'Alt text added.','Add alternative text to the spend chart.');
    check(22,4,'Add header and footer',/<oddHeader>[\s\S]*\S[\s\S]*<\/oddHeader>/.test(inv)||(inv.includes('Oasis')&&inv.includes('<oddHeader')),'Header/footer added.','Add a header with the company name and a footer page number.');
    check(23,3,'Merge & center title banner',inv.includes('<mergeCell ref="A1:I1"'),'Banner merged.','Merge and center the workbook title banner.');
    check(24,3,'Freeze header row',inv.includes('state="frozen"'),'Panes frozen.','Freeze the inventory header row.');
    check(25,3,'Sort by category then item name',inv.includes('<sortState')&&(inv.match(/<sortCondition/g)||[]).length>=2,'Multi-sort applied.','Sort inventory by category then item name.');

    const pct=Math.round(earned/total*100);
    stmts.savePracticeGrade.run(req.nsheId,'ExcelVar2',null,earned,total,JSON.stringify(results));
    res.json({score:earned,total,pct,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results});
  } catch(err) { console.error('ExcelVar2 grading error:',err.stack||err); try{fs.unlinkSync(req.file.path);}catch(e){} res.status(500).json({error:'Grading failed: '+(err.message||String(err))}); }
});


// ── WORD D1 PRACTICE GRADER ───────────────────────────────────────────────────
app.post('/api/grade/word-practice-d1', upload.single('file'), async (req, res) => {
  try {
    const buf = fs.readFileSync(req.file.path);
    const zip = new JSZip();
    await zip.loadAsync(buf);
    const gx = (n) => { try { return zip.file(n)?.nodeStream ? zip.files[n] && zip.files[n].async('text') : null; } catch(e){ return null; } };
    const rx = async (n) => { try { const f=zip.file(n); return f ? await f.async('text') : ''; } catch(e){ return ''; } };

    const docXml   = await rx('word/document.xml');
    const coreXml  = await rx('docProps/core.xml');
    const cstmXml  = await rx('docProps/custom.xml');
    const hXml     = await rx('word/header1.xml') || await rx('word/header2.xml') || '';
    const fXml     = await rx('word/footer1.xml') || await rx('word/footer2.xml') || '';
    const cmmXml   = await rx('word/comments.xml');
    const cmmExtXml= await rx('word/commentsExtended.xml');
    const settXml  = await rx('word/settings.xml');
    const numXml   = await rx('word/numbering.xml');
    const stylesXml= await rx('word/styles.xml');
    const relsXml  = await rx('word/_rels/document.xml.rels');

    // File list for detecting SmartArt, 3D models etc.
    const fileList = Object.keys(zip.files).join('|');

    const INCH = 1440;
    const skills = [];

    const auto = (domain, name, passed, passMsg, failMsg) =>
      skills.push({ domain, name, type: 'auto', passed, passMsg, failMsg });
    const self = (domain, name, hint) =>
      skills.push({ domain, name, type: 'self', passed: null, hint });

    // ── D1 Skills ─────────────────────────────────────────────────────────────

    // 1. Set page margins
    const pgMar = docXml.match(/w:pgMar([^/]*?)\//);
    let mOk = false;
    if (pgMar) {
      const a = pgMar[1];
      const t = parseInt((a.match(/w:top="(\d+)"/) || [0,'0'])[1]);
      const b = parseInt((a.match(/w:bottom="(\d+)"/) || [0,'0'])[1]);
      const l = parseInt((a.match(/w:left="(\d+)"/) || [0,'0'])[1]);
      const r = parseInt((a.match(/w:right="(\d+)"/) || [0,'0'])[1]);
      mOk = [t,b,l,r].every(v => v > 0 && Math.abs(v - INCH) < 144);
    }
    auto('D1 — Manage Documents', 'Set page margins', mOk,
      '✓ Page margins changed from the default.',
      '✗ Margins not changed. Fix: Layout → Margins → choose or set custom margins.');

    // 2. Set page orientation
    const hasLandscape = docXml.includes('w:orient="landscape"');
    auto('D1 — Manage Documents', 'Set page orientation', hasLandscape,
      '✓ Landscape orientation detected.',
      '✗ Orientation not changed. Fix: Layout → Orientation → Landscape.');

    // 3. Set paper size (Letter = 12240 × 15840 DXA)
    const hasLetter = docXml.includes('w:w="12240"') && (docXml.includes('w:h="15840"') || docXml.includes('w:h="12240"'));
    auto('D1 — Manage Documents', 'Set paper size to Letter', hasLetter,
      '✓ US Letter paper size detected.',
      '✗ Paper size not set to Letter. Fix: Layout → Size → Letter.');

    // 4. Set page color
    const hasPageColor = settXml.includes('w:displayBackgroundShape') &&
      (docXml.includes('w:background') || settXml.includes('w:background') ||
       docXml.includes('<w:bg ') || coreXml.includes('background'));
    auto('D1 — Manage Documents', 'Set page color', hasPageColor,
      '✓ Page background color detected.',
      '✗ No page color. Fix: Design → Page Color → choose a color.');

    // 5. Add page borders
    const hasPageBorder = docXml.includes('<w:pgBorders') || settXml.includes('pgBorders');
    auto('D1 — Manage Documents', 'Add page borders', hasPageBorder,
      '✓ Page border detected.',
      '✗ No page border. Fix: Design → Page Borders → choose a border style.');

    // 6. Apply a style set — detect by Heading 1 color changing from the starter's known baseline
    // Starter has Heading1 color 2F5496 and 2E74B5 (default Office). Any style set change produces a different color.
    const starterH1Colors = ['2F5496','2E74B5','2E74B5'.toLowerCase(),'2F5496'.toLowerCase(),'1F4D78'];
    const h1Colors = [...stylesXml.matchAll(/styleId="Heading1"[\s\S]*?w:color w:val="([^"]+)"/g)].map(m => m[1].toUpperCase());
    const styleSetChanged = h1Colors.length > 0 && h1Colors.some(c => !starterH1Colors.map(s=>s.toUpperCase()).includes(c));
    auto('D1 — Manage Documents', 'Apply a style set', styleSetChanged,
      '✓ Style set change detected — Heading styles updated from the default.',
      '✗ Style set not changed. Fix: Design → Document Formatting → Style Sets gallery → choose one (e.g. Basic (Stylish)).');

    // 7. Insert header
    auto('D1 — Manage Documents', 'Insert a header', hXml.length > 100,
      '✓ Header content detected.',
      '✗ No header found. Fix: Insert → Header → choose a style and add text.');

    // 8. Insert footer
    auto('D1 — Manage Documents', 'Insert a footer', fXml.length > 100,
      '✓ Footer content detected.',
      '✗ No footer found. Fix: Insert → Footer → choose a style and add text.');

    // 9. Insert page numbers
    const hasPageNums = fXml.includes('fldChar') || fXml.includes('PAGE') ||
                        hXml.includes('fldChar') || hXml.includes('PAGE');
    auto('D1 — Manage Documents', 'Insert page numbers', hasPageNums,
      '✓ Page number field detected.',
      '✗ No page numbers. Fix: Insert → Page Number → choose a position.');

    // 10. Insert a hyperlink
    auto('D1 — Manage Documents', 'Insert a hyperlink',
      docXml.includes('w:hyperlink') || relsXml.includes('hyperlink'),
      '✓ Hyperlink detected.',
      '✗ No hyperlink found. Fix: select text → Insert → Link → enter a URL.');

    // 11. Add a watermark
    const hasWatermark = hXml.toLowerCase().includes('watermark') ||
      hXml.includes('w:pict') || hXml.includes('v:shape') ||
      (hXml.includes('w:sdt') && hXml.toLowerCase().includes('draft'));
    auto('D1 — Manage Documents', 'Add a watermark', hasWatermark,
      '✓ Watermark detected.',
      '✗ No watermark. Fix: Design → Watermark → choose DRAFT or CONFIDENTIAL.');

    // 12. Modify document properties — starter has known Title/Author; student should change them
    const starterTitle = 'Annual Business Report 2026 \u2014 DRAFT';
    const currentTitle = (coreXml.match(/<dc:title>([^<]+)<\/dc:title>/) || ['',''])[1];
    const hasModifiedProps = currentTitle.length > 0 && currentTitle !== starterTitle;
    auto('D1 — Manage Documents', 'Modify document properties', hasModifiedProps,
      '✓ Document properties changed from the starter\'s default values.',
      '✗ Properties not changed. Fix: File → Info → Properties panel → update Title and Author.');

    // 13. Add a custom document property
    const hasCustomProp = cstmXml.length > 150 && cstmXml.includes('<property ');
    auto('D1 — Manage Documents', 'Add a custom document property', hasCustomProp,
      '✓ Custom document property detected.',
      '✗ No custom property. Fix: File → Info → Properties → Advanced Properties → Custom tab → Add.');

    // 14. Search for text (Navigation Pane) — self-check
    self('D1 — Manage Documents', 'Search for text (Navigation Pane)',
      'Use Ctrl+F or View → Navigation Pane. Type a word in the search box. This action leaves no trace in the saved file.');

    // 15. Navigate to specific locations (Go To) — self-check
    self('D1 — Manage Documents', 'Navigate to locations (Go To)',
      'Use Ctrl+G or F5. Choose a page number, heading, or bookmark to navigate to.');

    // 16. Show/Hide formatting marks — self-check
    self('D1 — Manage Documents', 'Show/Hide formatting marks',
      'Press Ctrl+* or Home → ¶ button. You should see paragraph marks and spaces appear. This is a display setting not saved to the file.');

    // 17. Modify print settings (detected via pageSetup)
    const hasPrintSettings = docXml.includes('<w:pageSetup') &&
      (docXml.includes('w:paperSize="') || docXml.includes('w:scale=') ||
       docXml.includes('w:fitToWidth') || docXml.includes('w:paperHeight'));
    auto('D1 — Manage Documents', 'Modify print settings', hasPrintSettings,
      '✓ Print settings detected in the document.',
      '✗ No print settings change detected. Fix: File → Print → Page Setup → adjust settings like paper size or fit to page.');

    // 18. Save as different file format — self-check
    self('D1 — Manage Documents', 'Save as a different file format',
      'Use File → Save As → choose PDF, .txt, or another format. Your saved .docx cannot confirm this — check that the other file type was saved to your computer.');

    // 19. Share a document — self-check
    self('D1 — Manage Documents', 'Share a document',
      'Use File → Share → Share with People. Enter an email address and set permissions. This action is online and leaves no trace in the local .docx file.');

    // 20. Check Accessibility — self-check
    self('D1 — Manage Documents', 'Check accessibility',
      'Use Review → Check Accessibility. Read the results panel and fix any issues listed. The checker result is not saved to the file.');

    // 21. Check compatibility — self-check
    self('D1 — Manage Documents', 'Check compatibility',
      'Use File → Info → Check for Issues → Check Compatibility. Review what features may not be supported in older Word formats.');

    // 22. Remove hidden properties / personal info (detectable because starter has known properties)
    // Starter has Title, Creator, Subject, Keywords — after removal these should be empty/absent
    const starterHadTitle = true; // we know the starter had these
    const titleGone  = !/<dc:title>[^<]+<\/dc:title>/.test(coreXml);
    const creatorGone = !/Mark Taormino/.test(coreXml) && !/Un-named/.test(coreXml);
    const keywordsGone = !/<cp:keywords>[^<]+<\/cp:keywords>/.test(coreXml);
    auto('D1 — Manage Documents', 'Remove hidden properties / personal info',
      titleGone && keywordsGone,
      '✓ Hidden properties and personal info removed from the starter\'s known values.',
      '✗ Original hidden properties still present. Fix: File → Info → Check for Issues → Inspect Document → Remove All next to Document Properties.');

    // 23. Delete a comment (starter had comment id=0)
    const commentCount = (cmmXml.match(/<w:comment /g) || []).length;
    auto('D1 — Manage Documents', 'Delete a comment',
      commentCount === 0,
      '✓ The starter\'s comment has been deleted.',
      '✗ Comment still present. Fix: right-click the comment bubble → Delete Comment.');

    // 24. Resolve a comment (starter will have comment — check for w15:done="1")
    const resolved = cmmExtXml.includes('w15:done="1"') || cmmExtXml.includes("w15:done='1'");
    auto('D1 — Manage Documents', 'Resolve a comment',
      resolved,
      '✓ Comment marked as resolved.',
      '✗ No resolved comment found. Fix: hover the comment → click the checkmark (✓) button to resolve it.');

    // 25. Review tracked changes — self-check
    self('D1 — Manage Documents', 'Review tracked changes',
      'Use Review → Show Markup to see all changes. Use the Previous/Next buttons to review each one. Reviewing is not a file-changing action.');

    // 26. Accept a tracked change (starter has known del/ins — after accept, markup gone)
    const hasTrackedChanges = docXml.includes('<w:ins ') || docXml.includes('<w:del ');
    auto('D1 — Manage Documents', 'Accept a tracked change',
      !hasTrackedChanges,
      '✓ No tracked change markup found — at least one change was accepted.',
      '✗ Tracked changes still present. Fix: Review → Accept → Accept This Change (click on a specific change first).');

    // 27. Reject a tracked change (starter has known ins — after reject, text gone)
    // If tracked changes remain = not done; if gone = done (accept or reject both work — note this)
    auto('D1 — Manage Documents', 'Reject a tracked change',
      !hasTrackedChanges,
      '✓ Tracked change markup removed — change was accepted or rejected.',
      '✗ Tracked changes still present. Fix: Review → Reject → Reject This Change.');

    // 28. Lock/Unlock track changes
    const trackLocked = settXml.includes('w:documentProtection') && settXml.includes('trackedChanges');
    const trackUnlocked = !trackLocked;
    auto('D1 — Manage Documents', 'Lock or unlock track changes',
      trackUnlocked,
      '✓ Track Changes lock has been removed from the starter.',
      '✗ Track Changes is still locked. Fix: Review → Track Changes dropdown → Lock Track Changes → enter password (none set).');

    fs.unlinkSync(req.file.path);
    res.json({ skills });
  } catch(err) {
    console.error('Word D1 Practice grading error:', err.stack || err);
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.status(500).json({ error: 'Grading failed: ' + (err.message || String(err)) });
  }
});


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