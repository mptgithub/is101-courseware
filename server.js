// ─────────────────────────────────────────────────────────────────────────────
// IS101 Courseware Server — v2 (32-task grader)
// College of Southern Nevada © Dr. Mark Taormino · All Rights Reserved
// Updated: August 8, 2026 — 8:15 PM
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
    let hXml=''; for(const _h of ['word/header1.xml','word/header2.xml','word/header3.xml']) hXml+=getXml(_h);
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
    const hTexts=[...hXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m=>m[1]).join(' ').replace(/\s+/g,' '); const hC=hTexts.includes('Desert Sun'); const hD=/20(25|26|27)/.test(hXml)||/January|February|March|April|May|June|July|August|September|October|November|December/.test(hXml);
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
    const c1Tbl=(docXml.match(/<w:tbl>/g)||[]).length; check(17,3,'Merge top row cells for spanning title',c1Tbl>=1&&(docXml.includes('w:gridSpan')||docXml.includes('w:hMerge')),'Merged cells found.','No merged cells. Fix: Create table first (T16), then select top row > Table Layout > Merge Cells.');
    check(18,3,'Sort client table alphabetically',docXml.split('<w:tbl>').length>=3,'Multiple tables found.','Client table not found. Fix: Add client table then Table Layout > Sort > Ascending.');
    const ni=docXml.split('w:numId').length-1;
    check(19,2,'Create numbered list of 5 strategic objectives',ni>=5,'Numbered list found ('+ni+' references).','Numbered list not found. Fix: Select 5 objectives > Home > Numbering.');
    check(20,2,'Create bulleted list of services',ni>0&&numXml.includes('w:numFmt w:val="bullet"'),'Bulleted list found.','No bulleted list. Fix: Select the three service categories > Home > Bullets.');
    check(21,4,'Increase list level for sub-items',/w:ilvl w:val="[1-9]"/.test(docXml),'Sub-level list items found.','No sub-level items. Fix: Select sub-items > Home > Increase Indent.');
    // D4 - 3 tasks - 10 pts
    check(22,3,'Insert Table of Contents after title page',/<w:instrText[^>]*>[^<]*TOC[^<]*<\/w:instrText>/.test(docXml),'TOC found.','No TOC. Fix: References > Table of Contents > Automatic Table 1.');
    check(23,3,'Customize TOC to show Heading 1 and Heading 2 only',/<w:instrText[^>]*>[^<]*TOC[^<]*\\o [&quot;"]*1[^<"]*-[^<"]*2/.test(docXml),'TOC customized to Heading 1 and 2 only.','TOC not customized. Fix: References > Table of Contents > Custom Table of Contents > Show levels: 2.');
    check(24,4,'Insert footnote on revenue figure',/<w:footnote w:id="[1-9]/.test(fnXml)&&docXml.includes('w:footnoteReference'),'Footnote found.','No footnote. Fix: Click after revenue figure > References > Insert Footnote.');
    // D5 - 5 tasks - 19 pts
    check(25,4,'Insert DSC logo image on cover page',docXml.includes('w:drawing')||docXml.includes('a:blip'),'Image found.','No image. Fix: Insert > Pictures > This Device > select logo.');
    check(26,3,'Set text wrapping to Through for the logo',(docXml.includes('w:drawing')||docXml.includes('a:blip'))&&['wrapThrough','wrapSquare','wrapTight','wrapTopAndBottom'].some(w=>docXml.includes(w)),'Text wrapping set.','Wrapping not set. Fix: Insert logo first (T25), then Picture Format > Wrap Text > Through.');
    check(27,4,'Insert text box with report tagline on cover page',docXml.includes('w:txbxContent')||docXml.includes('wps:txbx'),'Text box found.','No text box. Fix: Insert > Text Box > Draw Text Box > type tagline.');
    const c1HasImg=docXml.includes('a:blip'); const c1HasAlt=(docXml.match(/descr="[^"]{3,}"/g)||[]).length>=1; check(28,8,'Add alt text to ALL images in the document',c1HasImg&&c1HasAlt,'Alt text found on logo image.','No alt text on the logo image. Fix: Right-click the logo > Edit Alt Text > type a description.');
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
    let hXml=''; for(const _h of ['word/header1.xml','word/header2.xml','word/header3.xml']) hXml+=getXml(_h);
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
    const _pgSzStr=(docXml.match(/w:pgSz[^<]*/)||[''])[0]; const _c2pgW=parseInt((_pgSzStr.match(/w:w="(\d+)"/)||['','0'])[1]);
    check(2,2,'Set paper size to Letter',Math.abs(_c2pgW-12240)<50,'✓ Paper size is Letter.','✗ Paper size is not Letter. Fix: Layout → Size → Letter. (Starter is A4 — you must change it.)');
    const c2DefaultH1=['2F5496','2E74B5','1F4D78','365F91','17375E','FFFFFF'];
    const c2H1M=stylesXml.match(/Heading1[\s\S]{0,800}?<w:color w:val="([^"]+)"/);
    const c2H1C=(c2H1M&&c2H1M[1]||'').toUpperCase();
    const c2StyleOk=c2H1C.length>0&&c2H1C!=='2E74B5'&&c2H1C!=='2F5496'&&c2H1C!=='1F4D78'&&c2H1C!=='365F91'&&c2H1C!=='17375E';
    check(3,2,'Apply the "Shaded" style set',c2StyleOk,'✓ Style set applied (H1 color changed from default).','✗ Style set not detected. Fix: Design → Style Sets → Shaded.');
    check(4,4,'Insert header: "Nevada Valley Healthcare — Employee Training Manual"',(()=>{const _ht=[...hXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m=>m[1]).join(' ').replace(/\s+/g,' '); return (_ht.includes('Nevada Valley')||hXml.includes('NVH'))&&(_ht.includes('Training')||_ht.includes('Manual'));})(),'✓ Header content found.','✗ Header incomplete. Fix: Insert → Header → type full title.');
    check(5,3,'Insert footer with department name',fXml.length>50,'✓ Footer content found.','✗ Footer empty. Fix: Insert → Footer → Edit Footer → type the department name.');
    check(6,2,'Insert page numbers in the footer',fXml.includes('PAGE')||fXml.includes('fldChar'),'✓ Page numbers in footer.','✗ No page numbers detected. Fix: Insert → Header & Footer → Footer → Edit Footer → Insert → Page Number → Current Position.');
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
    const c2Tbl=(docXml.match(/<w:tbl>/g)||[]).length; check(19,2,'Merge header row cells',c2Tbl>=1&&docXml.includes('w:gridSpan'),'✓ Merged cells found.','✗ No merged cells. Fix: Create table first (T18), then select top row → Table Layout → Merge Cells.');
    check(20,2,'Enable Repeat Header Row',c2Tbl>=1&&docXml.includes('w:tblHeader'),'✓ Repeat Header Row enabled.','✗ Fix: Create table first (T18), then click header row → Table Layout → Repeat Header Rows.');
    const ni=docXml.split('w:numId').length-1;
    check(21,2,'Create numbered checklist of Day 1 tasks',ni>=5,`✓ List items found (${ni}).`,`✗ Numbered list not found. Fix: Select Day 1 tasks → Home → Numbering.`);
    check(22,2,'Create bulleted list of conduct guidelines',ni>0&&numXml.includes('w:numFmt w:val="bullet"'),'✓ Bulleted list found.','✗ Fix: Select conduct guidelines → Home → Bullets.');
    check(23,4,'Add second-level bullets under each guideline',/w:ilvl w:val="[1-9]"/.test(docXml),'✓ Sub-level items found.','✗ Fix: Select sub-items → Home → Increase Indent.');
    check(24,4,'Insert Table of Contents',/<w:instrText[^>]*>[^<]*TOC[^<]*<\/w:instrText>/.test(docXml),'✓ TOC found.','✗ Fix: References → Table of Contents → Automatic Table 1.');
    check(25,3,'Customize TOC: dotted leaders, 3 heading levels',/<w:instrText[^>]*>[^<]*TOC[^<]*\\o [&quot;"]*1[^<"]*-[^<"]*3/.test(docXml),'✓ TOC customized to 3 levels.','✗ No TOC found to customize. Fix: Insert TOC first, then References → Custom TOC → Show levels: 3.');
    check(26,4,'Insert endnotes citing regulatory sources',/<w:endnote w:id="[1-9]/.test(enXml)&&docXml.includes('w:endnoteReference'),'✓ Endnote(s) found.','✗ Fix: References → Insert Endnote → type regulatory citation.');
    check(27,4,'Insert NVH logo on cover page',docXml.includes('w:drawing')||docXml.includes('a:blip'),'✓ Image found.','✗ Fix: Insert → Pictures → select NVH logo.');
    check(28,2,'Set text wrapping to Square for logo',(docXml.includes('w:drawing')||docXml.includes('a:blip'))&&(['wrapThrough','wrapSquare','wrapTight','wrapTopAndBottom'].some(w=>docXml.includes(w))||docXml.includes('wp:anchor')),'✓ Text wrapping set.','✗ Fix: Insert logo first (T27), then Picture Format → Wrap Text → Square.');
    check(29,3,'Insert icon representing each department',docXml.includes('w:drawing'),'✓ Graphic element(s) found.','✗ Fix: Insert → Icons → search type → Insert.');
    const c2Drw=(docXml.match(/<w:drawing>/g)||[]).length; const c2Dsc=(docXml.match(/descr="[^"]{3,}"/g)||[]).length; check(30,7,'Add alt text to every image and icon',c2Drw>0&&c2Dsc>=c2Drw,'✓ Alt text on all '+c2Drw+' graphic(s).','✗ Found '+c2Drw+' graphic(s) but only '+c2Dsc+' with alt text. Fix: Right-click EACH image/icon → Edit Alt Text.');
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
    let hXml=''; for(const _h of ['word/header1.xml','word/header2.xml','word/header3.xml']) hXml+=getXml(_h);
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
    const v1PgSzStr=(docXml.match(/w:pgSz[^<]*/)||[''])[0]; const v1PgW=parseInt((v1PgSzStr.match(/w:w="(\d+)"/)||['','0'])[1]);
    const v1IsPortrait=v1PgW>0&&v1PgW<=12500&&!docXml.includes('w:orient="landscape"');
    check(2,2,'Set orientation to Portrait',v1IsPortrait,'✓ Portrait orientation confirmed.','✗ Document is still Landscape. Fix: Layout → Orientation → Portrait. (Starter is Landscape — you must change it.)');
    const v1DefaultH1=['2F5496','2E74B5','1F4D78','365F91','17375E'];
    const v1H1M=stylesXml.match(/Heading1[\s\S]{0,800}?<w:color w:val="([^"]+)"/);
    const v1H1C=(v1H1M&&v1H1M[1]||'').toUpperCase();
    check(3,2,'Apply the "Basic (Simple)" style set',v1H1C.length>0&&!v1DefaultH1.includes(v1H1C),'✓ Style set applied (H1 color changed from default).','✗ Style set not detected. Fix: Design → Style Sets → Basic (Simple).');
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
    const v1Tbl=(docXml.match(/<w:tbl>/g)||[]).length; check(16,3,'Merge header row cells',v1Tbl>=1&&docXml.includes('w:gridSpan'),'✓ Merged cells found.','✗ No merged cells. Fix: Create table first (T15), then select top row → Table Layout → Merge Cells.');
    check(17,3,'Sort data table by response percentage (descending)',docXml.split('<w:tbl>').length>=2,'✓ Multiple tables found — sort verified visually.','✗ Fix: Click inside the survey table → Table Layout → Sort → Column 4 (Percentage) → Descending.');
    const ni=docXml.split('w:numId').length-1;
    check(18,2,'Create numbered list of research questions',ni>=3,`✓ List items found (${ni}).`,'✗ Fix: Select questions → Home → Numbering.');
    check(19,2,'Create bulleted list of key findings',ni>0&&numXml.includes('w:numFmt w:val="bullet"'),'✓ Bulleted list found.','✗ Fix: Select key findings → Home → Bullets.');
    check(20,2,'Restart list numbering for second set',docXml.includes('w:startOverride')||numXml.includes('w:startOverride')||ni>5,'✓ List restart detected.','✗ Fix: Right-click second list → Restart at 1.');
    check(21,4,'Insert Table of Contents',/<w:instrText[^>]*>[^<]*TOC[^<]*<\/w:instrText>/.test(docXml),'✓ TOC found.','✗ Fix: References → Table of Contents → Automatic Table 1.');
    check(22,4,'Customize TOC: Heading 1 and 2 only',/<w:instrText[^>]*>[^<]*TOC[^<]*\\o [&quot;"]*1[^<"]*-[^<"]*2/.test(docXml),'✓ TOC customized to Heading 1 and 2 only.','✗ No TOC found to customize. Fix: Insert TOC first, then References → Custom TOC → Show levels: 2.');
    const fnc=(fnXml.match(/<w:footnote w:id="[1-9]/g)||[]).length;
    check(23,4,'Insert 2 footnotes citing sources',fnc>=2,`✓ ${fnc} footnotes found.`,`✗ Only ${fnc} footnote(s) — need 2. Fix: Click after a claim or statistic → References → Insert Footnote → type the source citation.`);
    check(24,4,'Insert bar chart screenshot',docXml.includes('w:drawing')||docXml.includes('a:blip'),'✓ Image found.','✗ Fix: Insert → Pictures → select chart image.');
    check(25,2,'Set text wrapping to Top and Bottom',['wrapThrough','wrapSquare','wrapTight','wrapTopAndBottom'].some(w=>docXml.includes(w)),'✓ Wrapping set.','✗ Fix: Picture Format → Wrap Text → Top and Bottom.');
    check(26,4,'Add text to shape for callout box',docXml.includes('wps:')||docXml.includes('w:txbxContent'),'✓ Shape with text found.','✗ Fix: Insert → Shapes → Callouts → draw → type statistic.');
    check(27,4,'Position callout shape in right margin',docXml.includes('wp:anchor')||docXml.includes('positionH'),'✓ Positioned object found.','✗ Fix: Picture Format → Position → right margin.');
    const v1Drw=(docXml.match(/<w:drawing>/g)||[]).length; const v1Dsc=(docXml.match(/descr="[^"]{3,}"/g)||[]).length; check(28,7,'Add alt text to all figures',v1Drw>0&&v1Dsc>=v1Drw,'✓ Alt text on all '+v1Drw+' figure(s).','✗ Found '+v1Drw+' figure(s) but only '+v1Dsc+' with alt text. Fix: Right-click EACH image/shape → Edit Alt Text.');
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
    let hXml=''; for(const _h of ['word/header1.xml','word/header2.xml','word/header3.xml']) hXml+=getXml(_h);
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
    const v2PgSzStr=(docXml.match(/w:pgSz[^<]*/)||[''])[0]; const v2PgW=parseInt((v2PgSzStr.match(/w:w="(\d+)"/)||['','0'])[1]);
    const v2IsPortrait=v2PgW>0&&v2PgW<=12500;
    check(2,2,'Set orientation to Portrait',v2IsPortrait,'✓ Portrait orientation confirmed.','✗ Document is still Landscape. Fix: Layout → Orientation → Portrait. (Starter is Landscape — you must change it.)');
    const v2DefaultH1=['2F5496','2E74B5','1F4D78','365F91','17375E'];
    const v2H1M=stylesXml.match(/Heading1[\s\S]{0,800}?<w:color w:val="([^"]+)"/);
    const v2H1C=(v2H1M&&v2H1M[1]||'').toUpperCase();
    check(3,2,'Apply the "Lines (Stylish)" style set',v2H1C.length>0&&!v2DefaultH1.includes(v2H1C),'✓ Style set applied (H1 color changed from default).','✗ Style set not detected. Fix: Design → Style Sets → Lines (Stylish).');
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
    const vv2Tbl=(docXml.match(/<w:tbl>/g)||[]).length; check(17,3,'Apply a table style to the budget table',vv2Tbl>=1&&docXml.includes('w:tblStyle'),'✓ Table style applied.','✗ No table style found. Fix: Click in the budget table → Table Design tab → choose a style from the Table Styles gallery.');
    check(18,3,'Sort vendor table by cost (ascending)',docXml.split('<w:tbl>').length>=2,'✓ Multiple tables found — sort verified visually.','✗ Fix: Click inside the vendor table → Table Layout → Sort → Cost column → Ascending.');
    const ni=docXml.split('w:numId').length-1;
    check(19,2,'Create numbered timeline of event activities',ni>=3,`✓ List items (${ni}).`,'✗ Fix: Select timeline → Home → Numbering.');
    check(20,2,'Create bulleted list of services',ni>0&&numXml.includes('w:numFmt w:val="bullet"'),'✓ Bulleted list found.','✗ Fix: Select services → Home → Bullets.');
    check(21,3,'Change bullet format for premium services to custom symbol',ni>0&&numXml.includes('w:numFmt w:val="bullet"')&&(numXml.includes('<w:lvlText')||numXml.includes('w:char=')),'✓ Custom bullet format detected.','✗ Fix: Home → Bullets dropdown → Define New Bullet → Symbol → choose a custom symbol.');
    check(22,4,'Insert Table of Contents',/<w:instrText[^>]*>[^<]*TOC[^<]*<\/w:instrText>/.test(docXml),'✓ TOC found.','✗ Fix: References → Table of Contents → Automatic Table 1.');
    check(23,4,'Customize TOC: dot leaders, right-aligned page numbers',/<w:instrText[^>]*>[^<]*TOC[^<]*\\o [&quot;"]*1[^<"]*-[^<"]*2/.test(docXml),'✓ TOC found with custom formatting.','✗ No TOC found to customize. Fix: Insert TOC first, then References → Custom TOC → set dot leaders.');
    const fnc=(fnXml.match(/<w:footnote w:id="[1-9]/g)||[]).length;
    check(24,4,'Insert footnote on pricing section',fnc>=1,`✓ ${fnc} footnote(s).`,`✗ Only ${fnc}. Fix: References → Insert Footnote → type terms.`);
    check(25,4,'Insert venue floor plan image',docXml.includes('w:drawing')||docXml.includes('a:blip'),'✓ Image found.','✗ Fix: Insert → Pictures → select floor plan.');
    check(26,2,'Set text wrapping to Square',['wrapThrough','wrapSquare','wrapTight','wrapTopAndBottom'].some(w=>docXml.includes(w)),'✓ Wrapping set.','✗ Fix: Picture Format → Wrap Text → Square.');
    check(27,4,'Insert text box with Oasis Events tagline',docXml.includes('w:txbxContent')||docXml.includes('wps:txbx'),'✓ Text box found.','✗ Fix: Insert → Text Box → Draw Text Box → type tagline.');
    const vv2Drw=(docXml.match(/<w:drawing>/g)||[]).length; const vv2Dsc=(docXml.match(/descr="[^"]{3,}"/g)||[]).length; check(28,8,'Add alt text to all graphics',vv2Drw>0&&vv2Dsc>=vv2Drw,'✓ Alt text on all '+vv2Drw+' graphic(s).','✗ Found '+vv2Drw+' graphic(s) but only '+vv2Dsc+' with alt text. Fix: Right-click EACH image/shape → Edit Alt Text.');
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
    const numXml = getXml('word/numbering.xml');
    const allXml = docXml+stylesXml+coreXml+hXml+fXml+cmmXml+fnXml+numXml;
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
      docXml.includes('w:sym')||docXml.includes('\u00B0')||docXml.includes('\u00BA')||docXml.includes('&#176;')||docXml.includes('&#xB0;')||docXml.includes('&#186;')||docXml.includes('&#xBA;'),
      '✓ Symbol found.','✗ No degree symbol found. Fix: Insert → Symbol → ° (degree sign).');

    check(5,8,'Insert a column break in the two-column FAQ section',
      docXml.includes('w:type="column"'),
      '✓ Column break found.','✗ No column break found. Fix: Layout → Breaks → Column.');

    const sectPrCount = (docXml.match(/<w:sectPr/g)||[]).length;
    check(6,9,"Change the FAQ section's page setup to 0.75-inch margins",
      sectPrCount>=2 && /w:(?:left|right)="1080"/.test(docXml),
      '✓ Section with custom page setup found.','✗ No second section with 0.75" margins found. Fix: Insert a section break before the FAQ, then Layout → Margins → Custom → 0.75".');

    const tblCount = (docXml.match(/<w:tbl>/g)||[]).length;
    const ticketPriorityInTable = /(<w:tbl>[\s\S]*?Critical[\s\S]*?<\/w:tbl>)/.test(docXml) || /(<w:tbl>[\s\S]*?Priority[\s\S]*?Response Time[\s\S]*?<\/w:tbl>)/.test(docXml);
    check(7,9,'Convert the tab-separated ticket priority list to a table',
      ticketPriorityInTable,
      '✓ Ticket priority table found.','✗ Ticket priority list is not yet a table. Fix: Select the list → Insert → Table → Convert Text to Table.');

    const softwareVersionStillTable = /Microsoft Office[\s\S]{0,4000}?<\/w:tbl>/.test(docXml);
    check(8,8,'Convert the outdated software version table back to plain text',
      docXml.includes('Microsoft Office') && !softwareVersionStillTable,
      '✓ Software version table converted to text.','✗ Software version table is still a table. Fix: Click in table → Layout → Convert to Text.');

    const tcMarValues = [...docXml.matchAll(/<w:tcMar>[\s\S]*?<w:top[^>]*w:w="(\d+)"[^>]*\/>/g)].map(m=>parseInt(m[1]));
    const tblCellMarValues = [...docXml.matchAll(/<w:tblCellMar>[\s\S]*?<w:top[^>]*w:w="(\d+)"[^>]*\/>/g)].map(m=>parseInt(m[1]));
    const hasCustomMargin = tcMarValues.some(v => v !== 80) || tblCellMarValues.some(v => v > 80);
    check(9,5,'Increase cell margins on the equipment table for readability',
      hasCustomMargin,
      '✓ Custom cell margins found.','✗ No custom cell margins found. Fix: Click in table → Layout → Cell Margins → increase values.');

    check(10,8,'Split the merged header cell in the ticket table into two columns',
      !docXml.includes('w:gridSpan'),
      '✓ Header cell appears split.','✗ Header cell still appears merged. Fix: Click the merged cell → Layout → Split Cells → 2 columns.');

    check(11,5,'Resize the equipment table columns to fit content',
      docXml.includes('w:tblLayout'),
      '✓ Custom column widths found.','✗ No custom column resizing detected. Fix: Drag column borders or use Layout → AutoFit → AutoFit Contents.');

    // T12: Split inventory table — check that software inventory data spans 2+ tables
    // Look for multiple tables containing software-related content
    const softwareTables = [...docXml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)].filter(m => 
      m[1].includes('License') || m[1].includes('Volume') || m[1].includes('Named User') || m[1].includes('Concurrent')
    ).length;
    check(12,9,'Split the long software inventory table into two separate tables',
      softwareTables>=2,
      '✓ Software inventory table has been split.','✗ Software inventory table is still one table. Fix: Click in a middle row of the software inventory table → Layout → Split Table.');

    const hasWingdingsFont = docXml.includes('Wingdings') || numXml.includes('Wingdings');
    const hasPUAChar = /[\uF000-\uF0FF]/.test(docXml) || /[\uF000-\uF0FF]/.test(numXml);
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
  // Cell value helpers - extract numeric or string value from a specific cell
  const sharedStrings = [...shared.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(m=>m[1]);
  const cellVal = (sx, ref) => {
    const re = new RegExp('<c r="' + ref + '"[^>]*>([^]*?)</c>');
    const m = sx.match(re);
    if (!m) return null;
    const v = m[1].match(/<v>([^<]*)<\/v>/);
    return v ? parseFloat(v[1]) : null;
  };
  const cellStr = (sx, ref) => {
    const m = sx.match(new RegExp('<c r="' + ref + '"([^>]*)>([^]*?)</c>'));
    if (!m) return null;
    const isText = m[1].includes('t="s"');
    const isStr = m[1].includes('t="str"');
    const v = m[2].match(/<v>([^<]*)<\/v>/);
    if (!v) return null;
    if (isText && parseInt(v[1]) < sharedStrings.length) return sharedStrings[parseInt(v[1])];
    if (isStr) return v[1];
    return v[1];
  };
  return { names, P, sheet, styles, wbxml, core, shared, tables, charts, chartXml, chartsheets, drawings, hasComments, XFS, usedStyles, anyXf, formulas, cellVal, cellStr, sharedStrings };
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
    check(18,5,'Add Total Row summing Amount Billed',H.tables.some(t=>t.includes('totalsRowShown="1"')||t.includes('totalsRowCount="1"')),'Total row added.','Add a Total Row: click in the table → Table Design tab → check Total Row.');
    check(19,5,'Filter to Active clients',billing.includes('<filterColumn')||H.tables.some(t=>t.includes('filterColumn')),'Filter applied.','Filter the table to show only Active clients: click the Status column dropdown → uncheck Inactive → OK.');
    check(20,3,'Sort by Client then Invoice Date',(billing.includes('<sortState')||H.tables.some(t=>t.includes('<sortState')))&&(billing.match(/<sortCondition/g)||[]).length>=2||(H.tables.some(t=>(t.match(/<sortCondition/g)||[]).length>=2)),'Multi-sort applied.','Sort by Client then Invoice Date: Data → Sort → Sort by Client → Add Level → Then by Invoice Date.');
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
    check(12,3,'Merge & center banner',roster.includes('<mergeCell ref="A1:'),'Banner merged.','Merge and center the title banner starting at A1 across the data columns.');
    check(13,5,'Convert roster to Table',H.tables.length>=1||H.wbxml.includes('RosterTable'),'Roster table created.','Convert the staffing roster to an Excel Table (Ctrl+T).');
    check(14,4,'Enable Banded Rows + Header Row options',H.tables.some(t=>t.includes('showRowStripes="1"')),'Style options enabled.','Enable Banded Rows and Header Row (Table Design > Style Options).');
    check(15,5,'Convert certifications table to range',!H.tables.some(t=>t.includes('CertTable')),'Certifications converted to range.','Convert the old certifications table back to a range (Table Design > Convert to Range).');
    check(16,4,'Apply a table style',H.tables.some(t=>/tableStyleInfo name="TableStyle\w+"/.test(t)),'Table style applied.','Apply a table style to the roster table (Table Design > Table Styles).');
    check(17,3,'Filter to Emergency department',roster.includes('<filterColumn')||H.tables.some(t=>t.includes('<filterColumn')),'Filter applied.','Filter the roster to the Emergency department: click the Department dropdown → select Emergency.');
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

    // SETUP (T1-T5)
    check(1,3,'Freeze header row and name column',grades.includes('state="frozen"'),'Panes frozen.','Click cell B4, then View → Freeze Panes → Freeze Panes.');
    check(2,3,'Add comment on feedback column',H.hasComments,'Comment added.','Right-click any cell in the Feedback column (M) → Insert Comment.');
    check(3,3,'Bold and shade header row',H.anyXf(grades,x=>(/applyFill="(1|true)"/.test(x))&&((x.match(/fillId="(\d+)"/)||[])[1]!=='0')),'Header shaded.','Bold and shade the header row.');
    check(4,8,'Center score columns',H.anyXf(grades,x=>x.includes('horizontal="center"')),'Scores centered.','Center the score columns (C through G).');
    check(5,2,'Wrap text in feedback column',H.anyXf(grades,x=>x.includes('wrapText="1"')||x.includes('wrapText="true"')),'Wrap enabled.','Wrap text in the Feedback column (M).');

    // FORMULAS (T6-T16)
    check(6,6,'SUM and AVERAGE',(function(){
      var ok=true; var expect={236:47.2,207:41.4,254:50.8,157:31.4,226:45.2,246:49.2,192:38.4,137:27.4};
      var found=0; for(var r=4;r<=11;r++){var t=H.cellVal(grades,'H'+r);var a=H.cellVal(grades,'I'+r);
      if(t&&expect[t]!==undefined){found++;if(Math.abs((a||0)-expect[t])>0.2)ok=false;}}
      return ok&&found>=8;
    })(),'SUM and AVERAGE produce correct totals and averages.','Use SUM in column H to total scores (C through G). Use AVERAGE in column I. Copy down for all students.');
    check(7,4,'COUNT / COUNTA',(function(){
      var ok=true; for(var r=4;r<=11;r++){var v=H.cellVal(grades,'N'+r);if(v!==5)ok=false;} return ok;
    })(),'COUNTA correctly counts submitted assignments.','Use COUNTA in column N to count non-empty score cells (C through G) for each student.');
    check(8,4,'Absolute reference in Percent formula',F.some(f=>f.indexOf('$')>=0)&&(function(){
      var ok=true; for(var r=4;r<=11;r++){var t=H.cellVal(grades,'H'+r);var j=H.cellVal(grades,'J'+r);
      if(t&&j!==null&&Math.abs(j-t/300)>0.01)ok=false; if(t&&j===null)ok=false;} return ok;
    })(),'Absolute reference produces correct percentage.','Divide Total (H) by Total Points Possible (P2) using $ on the P2 reference. Place in column J.');
    check(9,3,'Name range GradeScale',/<definedName[^>]*\bname="GradeScale"/.test(H.wbxml),'Named range defined.','Click the GradeScale sheet tab, select A4:B8, type GradeScale in the Name Box, press Enter.');
    check(10,5,'IF Pass/Fail',(function(){
      var ok=true; for(var r=4;r<=11;r++){var t=H.cellVal(grades,'H'+r);var pf=(H.cellStr(grades,'K'+r)||'').toLowerCase();
      if(t>=180&&pf!=='pass')ok=false; if(t&&t<180&&pf!=='fail')ok=false;} return ok&&H.cellStr(grades,'K4')!==null;
    })(),'IF correctly marks Pass and Fail.','Use IF in column K: if Total (column H) >= 180, show Pass; otherwise Fail.');
    check(11,6,'Nested IF letter grade',(function(){
      var grades_ok=true; var expect={'236':'C','207':'D','254':'B','157':'F','226':'C','246':'B','192':'D','137':'F'};
      for(var r=4;r<=11;r++){var t=H.cellVal(grades,'H'+r);var g=H.cellStr(grades,'L'+r);if(t&&expect[String(t)]&&g!==expect[String(t)])grades_ok=false;}
      return grades_ok&&H.cellStr(grades,'L4')!==null;
    })(),'Nested IF assigns correct letter grades.','Use nested IF in column L checking Total (H) against 270=A, 240=B, 210=C, 180=D, below=F.');
    check(12,6,'VLOOKUP student grade',(H.cellStr(grades,'P10')||'')==='B','VLOOKUP returns correct grade for Cruz.','Type Cruz in cell P9. In P10, write a VLOOKUP that searches for the name in P9, looks through the student data (A4:L11), and returns the letter grade from column 12. Use FALSE for exact match.');
    check(13,5,'IFERROR wrapping VLOOKUP',F.some(f=>f.toUpperCase().indexOf('IFERROR(')>=0&&f.toUpperCase().indexOf('VLOOKUP(')>=0),'IFERROR wraps VLOOKUP correctly.','Wrap your VLOOKUP in P10 with IFERROR. If the name is not found, show Not Found instead of an error.');
    check(14,3,'Reference GradeScale in a formula',/<definedName[^>]*\bname="GradeScale"/.test(H.wbxml)||Fj.includes('GRADESCALE'),'GradeScale named range exists.','This is satisfied when you create the GradeScale named range in Task 9.');
    check(15,4,'COUNTIF for A grades',H.cellVal(grades,'P6')===0,'COUNTIF correctly counts A grades (should be 0).','Use COUNTIF near cell P6 to count cells in Letter column (L4:L11) containing A.');
    check(16,3,'TODAY report date',H.cellVal(grades,'R1')>40000||fn('TODAY(','NOW('),'TODAY produces a date.','Put =TODAY() in cell R1 next to the Report Generated label.');

    // FORMATTING (T17-T21)
    check(17,2,'Percent format on percentage columns',/formatCode="[^"]*%[^"]*"/.test(H.styles)||H.XFS.some((x,i)=>H.usedStyles(grades).has(i)&&/numFmtId="(9|10)"/.test(x)),'Percent applied.','Format the Percent column (J) with Percent format.');
    check(18,3,'Conditional formatting on failing totals',grades.includes('<conditionalFormatting'),'Conditional formatting found.','Highlight Total scores (column H) below 180 with a red fill.');
    check(19,3,'Convert grade data to Table',H.tables.length>=1,'Table created.','Click in the grade data → Ctrl+T, Insert → Table, or Home → Format as Table.');
    check(20,3,'Sort by Total then Last Name',(grades.includes('<sortState')||H.tables.some(t=>t.includes('<sortState')))&&((grades.match(/<sortCondition/g)||[]).length>=2||H.tables.some(t=>(t.match(/<sortCondition/g)||[]).length>=2)),'Multi-sort applied.','Data → Sort → Sort by Total (Largest to Smallest) → Add Level → Then by Last Name (A to Z).');
    check(21,3,'Filter to failing students',grades.includes('<filterColumn')||H.tables.some(t=>t.includes('<filterColumn')),'Filter applied.','Filter the Letter column (L) to show only F grades.');

    // CHARTS (T22-T24)
    check(22,4,'Create Column chart',H.charts.length>=1,'Chart created.','Create a Column chart of class average by assignment.');
    check(23,4,'Add data labels and chart title',H.chartXml.includes('<c:dLbls>')&&H.chartXml.includes('<c:title>'),'Chart elements added.','Add data labels and a chart title.');
    check(24,3,'Add chart alt text',/descr="[^"]{5,}"/.test(H.drawings),'Alt text added.','Add alt text to the chart (right-click → Edit Alt Text).');

    // FINISHING (T25-T26)
    check(25,4,'Add header and footer',/<oddHeader>[\s\S]*\S[\s\S]*<\/oddHeader>/.test(grades)||(grades.includes('Grade Book')&&grades.includes('<oddHeader')),'Header/footer added.','Page Layout → Page Setup dialog → Header/Footer tab. Do NOT use Insert → Header & Footer.');
    check(26,3,'Set workbook properties',/<dc:title>\s*\S[\s\S]*?<\/dc:title>/.test(H.core)&&/<dc:creator>\s*\S[\s\S]*?<\/dc:creator>/.test(H.core),'Properties set.','File → Info → set Title and Author.');

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
    check(3,3,'SEQUENCE for line-item IDs',(function(){
      if(!fn('SEQUENCE')) return false;
      for(var r=4;r<=11;r++){ if(H.cellVal(inv,'A'+r)!==(r-3)) return false; }
      return true;
    })(),'SEQUENCE generates IDs 1-8 in order, one formula per row.','Column A must use SEQUENCE and read exactly 1, 2, 3 ... 8 top to bottom (rows 4-11). In A4, enter one formula that returns a single value, e.g. =SEQUENCE(1,1,ROW()-3,1), then copy it down through A11. Do not enter one SEQUENCE formula in A4 that spills into A5:A11 - once the range becomes an Excel Table, a spilling formula cannot expand and will break with a #VALUE! error.');
    check(4,4,'Currency on Unit Cost and Line Total',(()=>{for(const i of H.usedStyles(inv)){if(i<H.XFS.length){const m=H.XFS[i].match(/numFmtId="(\d+)"/);if(m&&m[1]!=='0'&&m[1]!=='164')return true;}}return /formatCode="[^"]*\$[^"]*"/.test(H.styles);})(),'Currency applied.','Format Unit Cost and Line Total as Currency.');
    check(5,3,'Convert inventory to Table',H.tables.length>=1,'Table created.','Convert the inventory list to an Excel Table (Ctrl+T, Insert → Table, or Home → Format as Table).');
    check(6,4,'Add Line Total column to table',H.tables.some(t=>/ref="A3:[A-Z]+1[012]"/.test(t)),'Column added.','Add a Line Total column to the inventory table.');
    check(7,4,'Total Row summing Line Total',(function(){
      return H.tables.some(function(t){
        if(!(t.includes('totalsRowShown="1"')||t.includes('totalsRowCount="1"'))) return false;
        var cols=t.match(/<tableColumn\b[^>]*>/g)||[];
        return cols.some(function(c){ return /name="Line Total"/.test(c) && /totalsRowFunction="sum"/i.test(c); });
      });
    })(),'Total Row is summing Line Total.','The Total Row is on, but Sum isn\'t set under Line Total (F). Click the Total Row cell under Line Total → dropdown arrow → Sum.');
    check(8,6,'Calculate Line Total',(function(){
      var expect=new Set([420,180,150,100,280,360,176,84]); var found=new Set();
      for(var r=4;r<=11;r++){var v=H.cellVal(inv,'F'+r);if(v)found.add(v);}
      var ok=true; expect.forEach(function(e){if(!found.has(e))ok=false;}); return ok;
    })(),'Line Totals are correct.','In cell F4, multiply Qty (D4) by Unit Cost (E4). Copy down for all rows. Complete Task 13 first so Unit Cost has values.');
    check(9,6,'SUMIF spend per category',H.cellVal(inv,'P4')===600&&H.cellVal(inv,'P5')===150&&H.cellVal(inv,'P6')===184&&H.cellVal(inv,'P7')===280&&H.cellVal(inv,'P8')===360&&H.cellVal(inv,'P9')===176,'SUMIF totals are correct.','Use SUMIF in P4:P9. Criteria range: Category column (C4:C11). Criteria: the category name in column O. Sum range: Line Total column (F4:F11).');
    check(10,4,'LEFT/RIGHT/MID for SKU',F.some(f=>(/LEFT\(|RIGHT\(|MID\(/i.test(f)))&&(function(){
      var count=0; for(var r=4;r<=11;r++){var v=H.cellStr(inv,'G'+r);if(v&&v.length>=3)count++;} return count>=6;
    })(),'SKU codes generated with text functions.','Use LEFT, MID, or RIGHT on the Item Name (B) and/or Category (C) to build a short SKU code in column G.');
    check(11,4,'UPPER and LEN for category code',(function(){
      var found=0; for(var r=4;r<=11;r++){var v=H.cellStr(inv,'H'+r);if(v&&/[A-Z]{3,}/.test(v)&&/\d/.test(v))found++;} return found>=6;
    })(),'Category codes are correct.','Use UPPER on the Category (C) and LEN to count characters. Place the formula in column H. Example result: FURNITURE9.');
    check(12,5,'TEXTJOIN for item label',(function(){
      var count=0; for(var r=4;r<=11;r++){var v=H.cellStr(inv,'I'+r);var b=H.cellStr(inv,'B'+r);
      if(v&&b&&v.includes(b))count++;} return count>=6;
    })(),'Item labels are correct.','Use TEXTJOIN with a \"-\" delimiter in column I to combine Item Name (B), Category (C), and Qty (D).');
    check(13,6,'XLOOKUP for unit cost',(function(){
      var prices={'Folding Chair':3.5,'Round Table':12,'Linen Napkin':0.75,'Wine Glass':1.25,'Chafing Dish':28,'LED Uplight':15,'Dance Floor Panel':22,'Champagne Flute':1.4};
      var ok=true;var count=0; for(var r=4;r<=11;r++){var name=H.cellStr(inv,'B'+r);var cost=H.cellVal(inv,'E'+r);
      if(name&&prices[name]!==undefined){count++;if(cost!==prices[name])ok=false;}} return ok&&count>=6;
    })(),'XLOOKUP returns correct unit costs.','Use XLOOKUP in column E to look up each Item Name (column B) on the PriceList sheet and return the matching unit cost.');
    check(14,4,'SORT() vendor list',H.cellStr(inv,'Q4')&&['Glow Lighting','Oasis Catering','Summit Rentals'].includes(H.cellStr(inv,'Q4'))&&H.cellStr(inv,'Q4')==='Glow Lighting','Sorted vendor list is correct.','Use SORT in cell Q4 to sort the Vendor list (column M) alphabetically.');
    check(15,4,'UNIQUE() categories',H.cellStr(inv,'R4')&&['Furniture','Linens','Glassware','Catering','Lighting','Staging'].includes(H.cellStr(inv,'R4'))&&H.cellStr(inv,'R5')&&H.cellStr(inv,'R5')!==H.cellStr(inv,'R4'),'Unique categories listed correctly.','Use UNIQUE in cell R4 to list distinct categories from column C.');
    check(16,5,'YEAR/MONTH/DAY event date',(function(){
      for(var r=4;r<=11;r++){if(H.cellVal(inv,'T'+r)===2026&&H.cellVal(inv,'U'+r)===9&&H.cellVal(inv,'V'+r)===15)return true;}
      return H.cellVal(inv,'T4')===2026&&H.cellVal(inv,'U4')===9&&H.cellVal(inv,'V4')===15;
    })(),'Date breakdown is correct.','Use YEAR, MONTH, and DAY on the Event Date (column K) and place results in columns T, U, V.');
    check(17,5,'Icon set on reorder level',inv.includes('<conditionalFormatting')&&(inv.includes('iconSet')||inv.includes('cfRule')),'Icon set applied.','Flag items below reorder level with an icon set.');
    check(18,4,'Name range "PriceList"',/<definedName[^>]*\bname="PriceList"/.test(H.wbxml),'Named range defined.','Define a named range called PriceList.');
    check(19,4,'Create Pie chart',H.charts.length>=1,'Chart created.','Create a Pie chart of spend by category.');
    check(20,4,'Apply a chart style',H.chartXml.includes('<c:style ')||(H.chartXml.includes('<mc:Choice')&&H.chartXml.toLowerCase().includes('style')),'Chart style applied.','Apply a chart style to the spend chart.');
    check(21,3,'Add chart alt text',/descr="[^"]{5,}"/.test(H.drawings),'Alt text added.','Add alternative text to the spend chart.');
    check(22,4,'Add header and footer',/<oddHeader>[\s\S]*\S[\s\S]*<\/oddHeader>/.test(inv)||(inv.includes('Oasis')&&inv.includes('<oddHeader')),'Header/footer added.','Add a header with the company name and a footer page number.');
    check(23,3,'Merge & center title banner',inv.includes('<mergeCell ref="A1:'),'Banner merged.','Merge and center the title banner starting at A1 across the data columns.');
    check(24,3,'Freeze header row',inv.includes('state="frozen"'),'Panes frozen.','Freeze the inventory header row.');
    check(25,3,'Sort by category then item name',(inv.includes('<sortState')||H.tables.some(t=>t.includes('<sortState')))&&((inv.match(/<sortCondition/g)||[]).length>=2||H.tables.some(t=>(t.match(/<sortCondition/g)||[]).length>=2)),'Multi-sort applied.','Sort inventory by category then item name: Data → Sort → Add Level.');

    const pct=Math.round(earned/total*100);
    stmts.savePracticeGrade.run(req.nsheId,'ExcelVar2',null,earned,total,JSON.stringify(results));
    res.json({score:earned,total,pct,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results});
  } catch(err) { console.error('ExcelVar2 grading error:',err.stack||err); try{fs.unlinkSync(req.file.path);}catch(e){} res.status(500).json({error:'Grading failed: '+(err.message||String(err))}); }
});


// ── WORD COMBINED PRACTICE GRADER (D1–D6) ─────────────────────────────────
app.post('/api/grade/word-practice', upload.single('file'), async (req, res) => {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(req.file.path);
    const getXml = (n) => { try { return zip.readAsText(n) || ''; } catch(e) { return ''; } };

    const docXml    = getXml('word/document.xml');
    const coreXml   = getXml('docProps/core.xml');
    const cstmXml   = getXml('docProps/custom.xml');
    const hXml      = getXml('word/header1.xml') || getXml('word/header2.xml') || '';
    const fXml      = getXml('word/footer1.xml') || getXml('word/footer2.xml') || '';
    const cmmXml    = getXml('word/comments.xml');
    const cmmExtXml = getXml('word/commentsExtended.xml');
    const settXml   = getXml('word/settings.xml');
    const stylesXml = getXml('word/styles.xml');
    const numXml    = getXml('word/numbering.xml');
    const fnXml     = getXml('word/footnotes.xml');
    const enXml     = getXml('word/endnotes.xml');
    const relsXml   = getXml('word/_rels/document.xml.rels');
    const fileList  = zip.getEntries().map(e => e.entryName).join('|');

    const INCH = 1440;
    const skills = [];
    const auto = (domain, name, passed, passMsg, failMsg) =>
      skills.push({ domain, name, type:'auto', passed, passMsg, failMsg });
    const self = (domain, name, hint) =>
      skills.push({ domain, name, type:'self', passed:null, hint });

    // ── D1 — Manage Documents ───────────────────────────────────────────────
    const pgMar = docXml.match(/w:pgMar([^/]*?)\//);
    let mOk = false;
    if (pgMar) {
      const a = pgMar[1];
      const vals = ['top','bottom','left','right'].map(s => parseInt((a.match(new RegExp(`w:${s}="(\\d+)"`)) || [0,'0'])[1]));
      mOk = vals.every(v => v > 0 && Math.abs(v - INCH) < 144);
    }
    auto('D1 — Manage Documents','Set page margins', mOk,
      '✓ Margins changed from the default.',
      '✗ Margins not changed. Fix: Layout → Margins → Normal (or custom).');

    auto('D1 — Manage Documents','Set page orientation', docXml.includes('w:orient="landscape"'),
      '✓ Landscape orientation detected.',
      '✗ Orientation not changed. Fix: Layout → Orientation → Landscape.');

    auto('D1 — Manage Documents','Set paper size to Letter',
      docXml.includes('w:w="12240"') && docXml.includes('w:h="15840"'),
      '✓ US Letter size detected.',
      '✗ Paper size not Letter. Fix: Layout → Size → Letter.');

    auto('D1 — Manage Documents','Set page color',
      docXml.includes('<w:bg ') || settXml.includes('w:background'),
      '✓ Page background color detected.',
      '✗ No page color. Fix: Design → Page Color → choose a color.');

    auto('D1 — Manage Documents','Add page borders',
      docXml.includes('<w:pgBorders'),
      '✓ Page border detected.',
      '✗ No page border. Fix: Design → Page Borders → choose a border style.');

    const starterH1Colors = new Set(['2F5496','2E74B5','1F4D78']);
    const h1Colors = [...stylesXml.matchAll(/styleId="Heading1"[\s\S]*?w:color w:val="([^"]+)"/g)].map(m => m[1].toUpperCase());
    auto('D1 — Manage Documents','Apply a style set',
      h1Colors.length > 0 && h1Colors.some(c => !starterH1Colors.has(c)),
      '✓ Style set change detected — Heading styles updated.',
      '✗ Style set not changed. Fix: Design → Document Formatting → Style Sets → choose one.');

    auto('D1 — Manage Documents','Insert a header', hXml.length > 100,
      '✓ Header content detected.',
      '✗ No header. Fix: Insert → Header → choose a style and add text.');

    auto('D1 — Manage Documents','Insert a footer', fXml.length > 100,
      '✓ Footer content detected.',
      '✗ No footer. Fix: Insert → Footer → choose a style and add text.');

    auto('D1 — Manage Documents','Insert page numbers',
      fXml.includes('fldChar') || fXml.includes('PAGE') || hXml.includes('fldChar') || hXml.includes('PAGE'),
      '✓ Page number field detected.',
      '✗ No page numbers. Fix: Insert → Page Number → choose a position.');

    auto('D1 — Manage Documents','Insert a hyperlink',
      docXml.includes('w:hyperlink') || relsXml.includes('hyperlink'),
      '✓ Hyperlink detected.',
      '✗ No hyperlink. Fix: Select text → Insert → Link → enter a URL.');

    auto('D1 — Manage Documents','Add a watermark',
      hXml.toLowerCase().includes('watermark') || hXml.includes('w:pict') || hXml.includes('v:shape'),
      '✓ Watermark detected.',
      '✗ No watermark. Fix: Design → Watermark → DRAFT or CONFIDENTIAL.');

    const starterTitle = 'Annual Business Report 2026 \u2014 DRAFT';
    const currentTitle = (coreXml.match(/<dc:title>([^<]+)<\/dc:title>/) || ['',''])[1];
    auto('D1 — Manage Documents','Modify document properties',
      currentTitle.length > 0 && currentTitle !== starterTitle,
      '✓ Document properties changed from starter defaults.',
      '✗ Properties not changed. Fix: File → Info → Properties → update Title and Author.');

    auto('D1 — Manage Documents','Add a custom document property',
      cstmXml.length > 150 && cstmXml.includes('<property '),
      '✓ Custom property detected.',
      '✗ No custom property. Fix: File → Info → Properties → Advanced Properties → Custom → Add.');

    self('D1 — Manage Documents','Search for text (Navigation Pane)',
      'Use Ctrl+F or View → Navigation Pane. Type a search term. Navigation leaves no trace in the saved file.');
    self('D1 — Manage Documents','Navigate to specific locations (Go To)',
      'Use Ctrl+G or F5. Navigate to a page number or heading.');
    self('D1 — Manage Documents','Show/Hide formatting marks',
      'Press Ctrl+* or Home → ¶. This is a display setting — it is not saved to the file.');

    auto('D1 — Manage Documents','Modify print settings',
      docXml.includes('<w:pageSetup') && (docXml.includes('w:paperSize="') || docXml.includes('w:scale=') || docXml.includes('w:fitToWidth')),
      '✓ Print settings change detected.',
      '✗ No print settings change. Fix: File → Print → Page Setup → adjust settings.');

    self('D1 — Manage Documents','Save as a different file format',
      'File → Save As → choose PDF or another format. The .docx cannot confirm this — verify the saved file on your computer.');
    self('D1 — Manage Documents','Share a document',
      'File → Share → Share with People. This is an online action with no trace in the local .docx file.');
    self('D1 — Manage Documents','Check Accessibility',
      'Review → Check Accessibility. Read and address any issues listed in the results panel.');
    self('D1 — Manage Documents','Check Compatibility',
      'File → Info → Check for Issues → Check Compatibility. Review any features not supported in older formats.');

    const titleGone = !/<dc:title>[^<]+<\/dc:title>/.test(coreXml);
    const keywordsGone = !/<cp:keywords>[^<]+<\/cp:keywords>/.test(coreXml);
    auto('D1 — Manage Documents','Remove hidden properties / personal info',
      titleGone && keywordsGone,
      '✓ Starter\'s known properties (Title, Keywords) removed.',
      '✗ Original properties still present. Fix: File → Info → Check for Issues → Inspect Document → Remove All.');

    // Starter has 2 comments (id=0 Manager, id=1 Finance Manager)
    // Delete comment: student removes one; resolve: student marks one resolved
    const commentCount = (cmmXml.match(/<w:comment /g) || []).length;
    auto('D1 — Manage Documents','Delete a comment',
      commentCount < 2,
      `✓ A comment was deleted (${commentCount} remaining).`,
      '✗ Both starter comments still present. Fix: right-click a comment bubble → Delete Comment.');

    auto('D1 — Manage Documents','Resolve a comment',
      cmmExtXml.includes('w15:done="1"') || cmmExtXml.includes("w15:done='1'"),
      '✓ Comment marked as resolved.',
      '✗ No resolved comment. Fix: hover a comment → click the ✓ checkmark button.');

    self('D1 — Manage Documents','Review tracked changes',
      'Review → Show Markup to view changes. Use Previous/Next to step through them. Reviewing leaves no file trace.');

    // Starter has del id=10/11 in D1 and del id=20 in D6
    // Accept: all tracked change markup gone
    // Reject: markup also gone (either action removes it)
    const hasAnyTC = docXml.includes('<w:ins ') || docXml.includes('<w:del ');
    auto('D1 — Manage Documents','Accept a tracked change',
      !hasAnyTC,
      '✓ Tracked change markup removed — change accepted.',
      '✗ Tracked changes still present. Fix: Review → Accept → Accept This Change.');

    auto('D1 — Manage Documents','Reject a tracked change',
      !hasAnyTC,
      '✓ Tracked change markup removed — change accepted or rejected.',
      '✗ Tracked changes still present. Fix: Review → Reject → Reject This Change.');

    const trackLocked = settXml.includes('w:documentProtection') && settXml.includes('trackedChanges');
    auto('D1 — Manage Documents','Lock or unlock track changes',
      !trackLocked,
      '✓ Track Changes lock removed from the starter.',
      '✗ Still locked. Fix: Review → Track Changes dropdown → Lock Track Changes → click OK (no password).');

    // ── D2 — Format Text and Paragraphs ────────────────────────────────────
    // Find+Replace DSC: starter has 11 DSC instances; after replace, zero
    const dscCount = (docXml.match(/\bDSC\b/g) || []).length;
    auto('D2 — Format Text & Paragraphs','Find and Replace (DSC → Desert Sun Consulting)',
      dscCount === 0,
      '✓ No "DSC" abbreviations found — all replaced.',
      `✗ ${dscCount} instance(s) of "DSC" still present. Fix: Ctrl+H → Find "DSC" → Replace with "Desert Sun Consulting" → Replace All.`);

    // Apply symbol: check for w:sym element
    auto('D2 — Format Text & Paragraphs','Insert a symbol or special character',
      docXml.includes('<w:sym '),
      '✓ Special character/symbol detected.',
      '✗ No symbol found. Fix: Insert → Symbol → More Symbols → choose © or another symbol.');

    // Apply text effects: shadow/glow/reflection on title
    auto('D2 — Format Text & Paragraphs','Apply text effects',
      docXml.includes('w:shadow') || docXml.includes('a:outerShdw') || docXml.includes('a:glow') || docXml.includes('a:reflection'),
      '✓ Text effect detected.',
      '✗ No text effect. Fix: Select title → Home → Font → Text Effects → Shadow or Glow.');

    // Line spacing: check for non-default w:line value
    const lineSpacingSet = (()=>{ const m=docXml.match(/w:line="(\d+)"/g); return m && m.some(v=>{ const n=parseInt(v.match(/\d+/)[0]); return n!==240&&n>200&&n<600; }); })();
    auto('D2 — Format Text & Paragraphs','Set line spacing',
      lineSpacingSet,
      '✓ Custom line spacing detected.',
      '✗ Line spacing not changed. Fix: Select text → Home → Line Spacing → choose 1.5 or 2.0.');

    // Paragraph spacing: starter body paragraphs only have w:after (never w:before on body text)
    // Headings have w:before but they use pStyle. Student-set spacing adds w:before to body paragraphs.
    // Detect: w:before on a pPr that has no Heading pStyle and no center alignment
    const bodySpacingSet = (()=>{
      return [...docXml.matchAll(/<w:pPr>([\s\S]*?)<\/w:pPr>/g)].some(m => {
        const b = m[1];
        return !b.includes('pStyle w:val="Heading') &&
               !b.includes('jc w:val="center"') &&
               /w:before="(12|18|24|36|48|60|72|96|120|180|240)"/.test(b) &&
               !/w:before="(480|720|1440|2880)"/.test(b); // exclude large values
      });
    })();
    auto('D2 — Format Text & Paragraphs','Set paragraph spacing',
      bodySpacingSet,
      '✓ Paragraph spacing (before) detected on body text.',
      '✗ No spacing before body paragraphs detected. Fix: Select body text → Home → Paragraph dialog → Spacing Before → set 6pt or 12pt.');

    // Indentation
    auto('D2 — Format Text & Paragraphs','Set indentation',
      docXml.includes('w:firstLine=') || /<w:ind[^>]*w:left="[1-9]\d+"/.test(docXml),
      '✓ Indentation detected.',
      '✗ No indentation. Fix: Layout → Indent or Paragraph dialog → Indentation.');

    // Character style
    auto('D2 — Format Text & Paragraphs','Apply a built-in character style',
      /w:rStyle w:val="(?!CommentReference|FootnoteReference|EndnoteReference)[^"]{3,}"/.test(docXml),
      '✓ Character style applied.',
      '✗ No character style. Fix: Select text → Home → Styles → choose Intense Quote or Strong.');

    // Paragraph style
    auto('D2 — Format Text & Paragraphs','Apply a built-in paragraph style',
      /w:pStyle w:val="(?!Normal|Heading|footnote|endnote|Comment)[^"]{3,}"/.test(docXml),
      '✓ Named paragraph style applied.',
      '✗ No paragraph style applied. Fix: Home → Styles → choose a style like Title or Quote.');

    // Two columns
    auto('D2 — Format Text & Paragraphs','Format text in multiple columns',
      docXml.includes('<w:cols') && /w:num="[2-9]"/.test(docXml),
      '✓ Multi-column layout detected.',
      '✗ No column layout. Fix: Select text → Layout → Columns → Two.');

    // Column break
    auto('D2 — Format Text & Paragraphs','Insert a column break',
      docXml.includes('w:type="column"'),
      '✓ Column break detected.',
      '✗ No column break. Fix: Place cursor in column → Layout → Breaks → Column.');

    // Page break: starter has 5 page breaks (section dividers); student should add more
    const pbCount = (docXml.match(/w:type="page"/g) || []).length;
    auto('D2 — Format Text & Paragraphs','Insert a page break',
      pbCount > 5,
      `✓ ${pbCount} page breaks detected — student added page break(s).`,
      '✗ No new page break. Fix: Click before a heading → Ctrl+Enter (or Layout → Breaks → Page).');

    // Section break
    auto('D2 — Format Text & Paragraphs','Insert a section break',
      (docXml.match(/<w:sectPr[ >]/g) || []).length >= 2,
      '✓ Section break detected.',
      '✗ No section break. Fix: Layout → Breaks → Next Page or Continuous.');

    // Change page setup for section (landscape section)
    auto('D2 — Format Text & Paragraphs','Change page setup for a section',
      (docXml.match(/<w:sectPr[ >]/g) || []).length >= 2 && docXml.includes('w:orient="landscape"'),
      '✓ Section with different page setup detected.',
      '✗ No section page setup change. Fix: Insert section break first, then Layout → Orientation → Landscape in that section.');

    // Format Painter: TARGET TEXT paragraph should have FF0000 red color AFTER the student applies it
    // Source paragraph (FF0000) comes BEFORE Target paragraph in the document
    // So correct detection: FF0000 appears within 300 chars AFTER "TARGET TEXT"
    const targetIdx = docXml.indexOf('TARGET TEXT');
    const targetHasRed = targetIdx >= 0 && /FF0000/.test(docXml.slice(targetIdx, targetIdx + 300));
    auto('D2 — Format Text & Paragraphs','Use Format Painter',
      targetHasRed,
      '✓ Target text now has matching red formatting — Format Painter used.',
      '✗ Target text formatting not changed. Fix: Click source text → Home → Format Painter brush → click target text.');

    // Clear formatting: "CLEAR THIS" paragraph should now have no bold/italic/color
    const clearStillFormatted = /<w:b\/>/.test(docXml.slice(docXml.indexOf('CLEAR THIS'), docXml.indexOf('CLEAR THIS') + 400)) ||
      /<w:i\/>/.test(docXml.slice(docXml.indexOf('CLEAR THIS'), docXml.indexOf('CLEAR THIS') + 400)) ||
      /0563C1/.test(docXml.slice(docXml.indexOf('CLEAR THIS'), docXml.indexOf('CLEAR THIS') + 400));
    auto('D2 — Format Text & Paragraphs','Clear formatting',
      !clearStillFormatted,
      '✓ Formatting cleared from the "CLEAR THIS" paragraph.',
      '✗ "CLEAR THIS" paragraph still has Bold/Italic/Blue. Fix: Select it → Home → Clear All Formatting.');

    // Modify footnote properties: starter has decimal numbering (default)
    // After modification, numFmt should be something other than decimal
    const fnNumFmt = (fnXml.match(/<w:numFmt w:val="([^"]+)"/) || [])[1] || 'decimal';
    auto('D2 — Format Text & Paragraphs','Modify footnote/endnote properties',
      fnNumFmt !== 'decimal' && fnNumFmt !== '',
      `✓ Footnote numbering changed to ${fnNumFmt}.`,
      '✗ Footnote still uses default decimal numbering. Fix: References → Footnotes dialog launcher → Number format → change to Roman numerals.');

    // ── D3 — Tables and Lists ───────────────────────────────────────────────
    auto('D3 — Tables & Lists','Create a table',
      docXml.includes('<w:tbl>'),
      '✓ Table detected.',
      '✗ No table found. Fix: Insert → Table or convert tab-separated text.');

    auto('D3 — Tables & Lists','Convert text to a table',
      docXml.includes('<w:tbl>'),
      '✓ Table detected (convert text to table).',
      '✗ No table found. Fix: Select tab-separated data → Insert → Table → Convert Text to Table.');

    auto('D3 — Tables & Lists','Convert a table to text',
      docXml.includes('<w:tbl>') && docXml.includes('convertedFromTable'),
      '✓ Table-to-text conversion detected.',
      '✗ Not detected. Fix: Click in table → Table Layout → Convert to Text.');

    auto('D3 — Tables & Lists','Sort table data',
      docXml.split('<w:tbl>').length >= 2,
      '✓ Multiple tables found — sort verified visually.',
      '✗ Less than 2 tables detected. Fix: Click in table → Table Layout → Sort.');

    auto('D3 — Tables & Lists','Merge cells',
      docXml.includes('w:gridSpan'),
      '✓ Merged cells detected.',
      '✗ No merged cells. Fix: Select cells → Table Layout → Merge Cells.');

    auto('D3 — Tables & Lists','Split cells',
      docXml.includes('<w:splitPgBreak') || docXml.includes('w:vMerge') || docXml.count > 0,
      '✓ Split/modified cell structure detected.',
      '✗ Not detected. Fix: Click in cell → Table Layout → Split Cells.');

    auto('D3 — Tables & Lists','Split a table',
      docXml.split('<w:tbl>').length >= 3,
      '✓ Multiple tables detected — table was split.',
      '✗ Less than 3 tables. Fix: Click in the row where you want to split → Table Layout → Split Table.');

    // Resize table
    auto('D3 — Tables & Lists','Resize a table / rows / columns',
      docXml.includes('w:w=') && docXml.includes('<w:tbl>'),
      '✓ Table with column widths detected.',
      '✗ No table found. Fix: Drag column borders or use Table Layout → Width.');

    // Cell margins
    auto('D3 — Tables & Lists','Configure cell margins and spacing',
      docXml.includes('w:tcMar') || docXml.includes('w:tblCellSpacing'),
      '✓ Custom cell margins detected.',
      '✗ No custom cell margins. Fix: Table Layout → Cell Margins.');

    // Repeat header row
    auto('D3 — Tables & Lists','Configure a repeating row header',
      docXml.includes('w:tblHeader'),
      '✓ Repeating header row detected.',
      '✗ No repeat header. Fix: Click header row → Table Layout → Repeat Header Rows.');

    // Numbered list — starter has 0 numId in docXml; student adds lists
    const numIdCount = (docXml.match(/w:numId w:val="[1-9]/g) || []).length;
    auto('D3 — Tables & Lists','Format paragraphs as a numbered list',
      numIdCount >= 1,
      '✓ Numbered list detected.',
      '✗ No numbered list. Fix: Select items → Home → Numbering.');

    // Bulleted list — check docXml for numId references (baseline=0) plus bullet in numXml
    // Since numXml already has bullet formats from D1 starter, check docXml has numId refs
    // and the corresponding abstractNum uses bullet format
    auto('D3 — Tables & Lists','Format paragraphs as a bulleted list',
      numIdCount >= 2 && numXml.includes('w:numFmt w:val="bullet"'),
      '✓ Bulleted list detected.',
      '✗ No bulleted list. Fix: Select items → Home → Bullets.');

    // Change list format / custom bullet — check for bullet char NOT in the default set
    const defaultBullets = new Set(['●','○','■','·','–','*','•','']);
    const lvlTexts = [...numXml.matchAll(/<w:lvlText w:val="([^"]+)"/g)].map(m => m[1]);
    const hasCustomBullet = lvlTexts.some(lt => !defaultBullets.has(lt));
    auto('D3 — Tables & Lists','Change bullet characters and number formats',
      hasCustomBullet,
      '✓ Custom bullet character detected.',
      '✗ No custom bullet. Fix: Home → Bullets dropdown → Define New Bullet → Symbol → choose e.g. ✓.');

    auto('D3 — Tables & Lists','Define custom bullet characters',
      hasCustomBullet,
      '✓ Custom bullet character defined.',
      '✗ No custom bullet defined. Fix: Home → Bullets → Define New Bullet → Symbol → choose a checkmark or star.');

    // List levels
    auto('D3 — Tables & Lists','Increase/decrease list levels',
      /w:ilvl w:val="[1-9]"/.test(docXml),
      '✓ Indented list level detected.',
      '✗ No sub-levels. Fix: Select sub-items → Home → Increase Indent.');

    // Restart numbering: check docXml (student-created lists) not numXml baseline
    auto('D3 — Tables & Lists','Start, restart, or continue list numbering',
      docXml.includes('w:startOverride'),
      '✓ List numbering restart detected.',
      '✗ Not detected. Fix: Right-click first item of second list → Restart at 1.');

    // ── D4 — References ─────────────────────────────────────────────────────
    auto('D4 — References','Insert a footnote',
      fnXml.split('<w:footnote w:id=').length > 3 && docXml.includes('w:footnoteReference'),
      '✓ New footnote detected.',
      '✗ No new footnote. Fix: References → Insert Footnote → type citation text.');

    auto('D4 — References','Insert an endnote',
      /<w:endnote w:id="[1-9]/.test(enXml) && docXml.includes('w:endnoteReference'),
      '✓ Endnote detected.',
      '✗ No endnote. Fix: References → Insert Endnote → type citation text.');

    auto('D4 — References','Insert a Table of Contents',
      /<w:instrText[^>]*>[^<]*TOC[^<]*<\/w:instrText>/.test(docXml),
      '✓ Table of Contents detected.',
      '✗ No TOC. Fix: References → Table of Contents → Automatic Table 1.');

    auto('D4 — References','Customize a Table of Contents',
      /<w:instrText[^>]*>[^<]*TOC[^<]*\\o [&quot;"]*1[^<"]*-[^<"]*2/.test(docXml) ||
      /<w:instrText[^>]*>[^<]*TOC[^<]*\\l [&quot;"]*1[^<"]*-[^<"]*2/.test(docXml),
      '✓ TOC customized to specific levels.',
      '✗ TOC not customized. Fix: References → Table of Contents → Custom Table of Contents → Show levels: 2.');

    self('D4 — References','Modify footnote/endnote properties',
      'References → Footnotes dialog launcher → change Number format to Roman numerals (i, ii, iii). Check the D2 section — the grader detects this change there.');

    // ── D5 — Graphic Elements ───────────────────────────────────────────────
    auto('D5 — Graphic Elements','Insert a picture',
      docXml.includes('a:blip r:embed=') || (docXml.includes('w:drawing') && docXml.includes('r:embed=')),
      '✓ Embedded picture detected.',
      '✗ No picture. Fix: Insert → Pictures → This Device → select an image.');

    // Format shape: starter has PracticeShape with noFill + blue outline
    // After formatting, student adds a solidFill to the shape body (not the line)
    // Detect: solidFill appears BEFORE <a:ln> in the PracticeShape spPr
    const shapeIdx = docXml.indexOf('PracticeShape');
    const shapeBlock = shapeIdx >= 0 ? docXml.slice(shapeIdx, shapeIdx + 800) : '';
    const spPrMatch = shapeBlock.match(/<wps:spPr>([\s\S]*?)<\/wps:spPr>/);
    let shapeHasFill = false;
    if (spPrMatch) {
      const spPr = spPrMatch[1];
      const lnIdx = spPr.indexOf('<a:ln>');
      const fillIdx = spPr.indexOf('<a:solidFill>');
      // Fill is present AND appears before the line element (shape fill, not stroke)
      shapeHasFill = fillIdx >= 0 && (lnIdx < 0 || fillIdx < lnIdx);
    }
    // Insert a shape: seeded shapes have ids 10 and 11; student inserts a NEW shape with higher id
    const shapeIds = [...docXml.matchAll(/<wp:docPr id="(\d+)"/g)].map(m => parseInt(m[1]));
    auto('D5 — Graphic Elements','Insert a shape',
      shapeIds.some(id => id > 11),
      '✓ Student-inserted shape detected.',
      '✗ No new shape found. Fix: Insert → Shapes → choose a shape and draw it in the document.');

    auto('D5 — Graphic Elements','Format a shape',
      shapeHasFill,
      '✓ Shape fill color detected — shape was formatted.',
      '✗ PracticeShape still has no fill. Fix: Click the shape → Shape Format → Shape Fill → choose a color.');

    // Insert a text box: seeded textboxes (ids 10,11) exist but are empty
    // Detect a student-inserted textbox by id > 11 OR any txbxContent with non-empty text
    // Use proper scoping to avoid greedy cross-boundary matches
    const tbBlocks = [...docXml.matchAll(/<w:txbxContent>([\s\S]*?)<\/w:txbxContent>/g)].map(m => m[1]);
    const anyTbText = tbBlocks.some(block => /<w:t>[^<]+<\/w:t>/.test(block));
    auto('D5 — Graphic Elements','Insert a text box',
      shapeIds.some(id => id > 11) || anyTbText,
      '✓ Text box with content detected.',
      '✗ No text box inserted. Fix: Insert → Text Box → Draw Text Box → type your text.');

    // Add text to text box: starter textbox is empty; check for non-empty w:t inside PracticeTextBox
    const tbIdx = docXml.indexOf('PracticeTextBox');
    const tbBlock = tbIdx >= 0 ? docXml.slice(tbIdx, tbIdx + 1000) : '';
    const tbHasText = /<w:t>[^<]+<\/w:t>/.test(tbBlock);
    auto('D5 — Graphic Elements','Add text to a text box',
      tbHasText,
      '✓ Text detected inside the practice text box.',
      '✗ Practice text box still empty. Fix: Click inside the text box → type your tagline.');

    auto('D5 — Graphic Elements','Insert an icon',
      fileList.includes('word/media/') && (docXml.includes('a:extLst') || fileList.split('|').some(f => f.includes('media/'))),
      '✓ Media file detected — icon likely inserted.',
      '✗ No icon detected. Fix: Insert → Icons → search for a business icon → Insert.');

    // Add text to shape: seeded shapes have empty wps:txbx blocks
    // Require actual non-empty text inside a wps:txbx
    const txbxBlocks = [...docXml.matchAll(/<wps:txbx>([\s\S]*?)<\/wps:txbx>/g)].map(m => m[1]);
    const shapeHasText = txbxBlocks.some(block => /<w:t>[^<]+<\/w:t>/.test(block));
    auto('D5 — Graphic Elements','Add text to a shape',
      shapeHasText,
      '✓ Text inside a shape detected.',
      '✗ No text in shape. Fix: Double-click a shape → type text inside it.');

    auto('D5 — Graphic Elements','Position an object on the page',
      docXml.includes('wp:anchor') || docXml.includes('positionH'),
      '✓ Positioned object detected.',
      '✗ No positioned object. Fix: Click image → Picture Format → Position → choose a position.');

    auto('D5 — Graphic Elements','Wrap text around an object',
      ['wrapThrough','wrapSquare','wrapTight','wrapTopAndBottom'].some(w => docXml.includes(w)) || docXml.includes('wp:anchor'),
      '✓ Text wrapping detected.',
      '✗ No text wrap. Fix: Click image → Picture Format → Wrap Text → choose a wrap style.');

    // Alt text: check for non-empty descr attributes (starter shapes have descr="")
    const altTexts = [...docXml.matchAll(/descr="([^"]{5,})"/g)];
    auto('D5 — Graphic Elements','Add alternative text to an object',
      altTexts.length > 0,
      `✓ Alt text found on ${altTexts.length} object(s).`,
      '✗ No alt text. Fix: Right-click each image/shape → Edit Alt Text → type a description.');

    // SmartArt
    auto('D5 — Graphic Elements','Insert SmartArt',
      fileList.includes('diagrams/') || docXml.includes('dgm:') || fileList.includes('dgm'),
      '✓ SmartArt detected.',
      '✗ No SmartArt. Fix: Insert → SmartArt → choose a layout → OK.');

    // Screenshot/picture
    auto('D5 — Graphic Elements','Insert a screenshot or screen clipping',
      docXml.includes('w:drawing') && fileList.split('|').some(f => f.match(/word\/media\/image\d/)),
      '✓ Image file in document detected (screenshot or picture).',
      '✗ No screenshot. Fix: Open a window → Insert → Screenshot → choose a window or Screen Clipping.');

    // Artistic effects
    auto('D5 — Graphic Elements','Apply artistic effects to a picture',
      docXml.includes('a14:artisticFilter') || docXml.includes('artisticFilter'),
      '✓ Artistic effect detected.',
      '✗ No artistic effect. Fix: Click image → Picture Format → Artistic Effects → choose one.');

    // Picture effects
    auto('D5 — Graphic Elements','Apply picture effects and styles',
      docXml.includes('<a:effectLst>') || docXml.includes('a:outerShdw') || docXml.includes('a:glow'),
      '✓ Picture effect detected.',
      '✗ No picture effect. Fix: Click image → Picture Format → Picture Effects → Shadow or Glow.');

    // Remove background
    auto('D5 — Graphic Elements','Remove a picture background',
      docXml.includes('pic:bg') || docXml.includes('a:alphaBiLevel') || docXml.includes('backgroundRemoval'),
      '✓ Background removal detected.',
      '✗ Not detected. Fix: Click image → Picture Format → Remove Background → Mark Areas to Keep/Remove → Keep Changes.');

    // 3D model
    auto('D5 — Graphic Elements','Insert a 3D model',
      fileList.includes('.glb') || fileList.includes('word/3D') || docXml.includes('am3d:'),
      '✓ 3D model detected.',
      '✗ No 3D model. Fix: Insert → 3D Models → From Online Sources → search and insert.');

    // ── D6 — Document Collaboration ─────────────────────────────────────────
    // Starter has 2 comments (id=0, id=1); student should ADD one more
    const totalComments = (cmmXml.match(/<w:comment /g) || []).length;
    auto('D6 — Collaboration','Add a comment',
      totalComments >= 3,
      `✓ ${totalComments} comments found — new comment added.`,
      '✗ No new comment detected. Fix: Select text → Review → New Comment → type your note.');

    // Reply: commentsExtended has a parentId attribute linking reply to parent
    auto('D6 — Collaboration','Review and reply to a comment',
      cmmExtXml.includes('w15:paraIdParent=') || totalComments >= 3,
      '✓ Comment reply detected.',
      '✗ No reply detected. Fix: Click a comment → Reply button → type your response.');

    // Resolve: w15:done="1"
    auto('D6 — Collaboration','Resolve a comment',
      cmmExtXml.includes('w15:done="1"') || cmmExtXml.includes("w15:done='1'"),
      '✓ Resolved comment detected.',
      '✗ No resolved comment. Fix: Hover a comment → click the ✓ button to resolve it.');

    // Delete a comment: starter has 2; after delete fewer remain
    auto('D6 — Collaboration','Delete a comment',
      totalComments < 2,
      '✓ A comment was deleted.',
      '✗ Both starter comments still present. Fix: Right-click comment → Delete Comment.');

    // Turn on Track Changes: check for w:ins NOT authored by the seeded authors
    const seededAuthors = ['Manager', 'Finance Manager'];
    const studentInserted = [...docXml.matchAll(/<w:ins[^>]*w:author="([^"]+)"/g)]
      .some(m => !seededAuthors.includes(m[1]));
    auto('D6 — Collaboration','Turn on Track Changes',
      studentInserted,
      '✓ Student-authored tracked changes detected.',
      '✗ No student tracked changes. Fix: Review → Track Changes (Ctrl+Shift+E) → make edits in the document.');

    // Accept tracked change: D1 starter had del id=10+11, D6 has del id=20
    // After accept, those dels are gone
    const starterDelGone = !docXml.includes('<w:del w:id="10"') && !docXml.includes('<w:del w:id="20"');
    auto('D6 — Collaboration','Accept a tracked change',
      starterDelGone,
      '✓ Starter\'s tracked deletions were accepted.',
      '✗ Seeded tracked changes still present. Fix: Click a tracked change → Review → Accept.');

    // Reject tracked change: D6 has del id=20 (Finance Manager deleted compliance text)
    // After REJECT, that deleted text is RESTORED — the del id=20 marker disappears
    const d6DelGone = !docXml.includes('<w:del w:id="20"');
    auto('D6 — Collaboration','Reject a tracked change',
      d6DelGone,
      '✓ D6 tracked deletion rejected — deleted text restored.',
      '✗ The D6 Finance Manager deletion is still present. Fix: Click on that tracked change → Review → Reject.');

    self('D6 — Collaboration','Review tracked changes',
      'Review → Show Markup to see all changes. Use Previous/Next to step through them. This action leaves no file trace.');

    // Lock track changes: starter HAS the lock; student should UNLOCK
    auto('D6 — Collaboration','Lock or unlock track changes',
      !trackLocked,
      '✓ Track Changes lock removed.',
      '✗ Still locked from starter. Fix: Review → Track Changes dropdown → Lock Track Changes → OK (no password).');

    self('D6 — Collaboration','Resolve a comment (verify)',
      'After resolving, the comment shows a checkmark. The grader checks for this — verify the resolved state shows in the Comments pane.');

    fs.unlinkSync(req.file.path);
    res.json({ skills });
  } catch(err) {
    console.error('Word Practice grading error:', err.stack || err);
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.status(500).json({ error: 'Grading failed: ' + (err.message || String(err)) });
  }
});

// ── EXCEL COMBINED PRACTICE GRADER (E1–E5) ───────────────────────────────
app.post('/api/grade/excel-practice', upload.single('file'), (req, res) => {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(req.file.path);
    const getXml = (n) => { try { return zip.readAsText(n) || ''; } catch(e) { return ''; } };

    const wbXml    = getXml('xl/workbook.xml');
    const stylesXml= getXml('xl/styles.xml');
    const coreXml  = getXml('docProps/core.xml');
    const sharedXml= getXml('xl/sharedStrings.xml');
    const entries  = zip.getEntries().map(e => e.entryName);

    // Collect all sheet XMLs
    const sheetEntries = entries.filter(e => e.startsWith('xl/worksheets/sheet') && e.endsWith('.xml'));
    const allSheetXml  = sheetEntries.map(e => getXml(e)).join('\n');

    // Sheet names
    const sheetNames = [...wbXml.matchAll(/name="([^"]+)"/g)].map(m => m[1]);
    const sheetCount = sheetNames.length;

    // Tables
    const tableEntries = entries.filter(e => e.includes('tables/table') && e.endsWith('.xml'));
    const allTableXml  = tableEntries.map(e => getXml(e)).join('\n');

    // Charts
    const chartEntries = entries.filter(e => e.includes('charts/chart') && e.endsWith('.xml'));
    const chartSheetEntries = entries.filter(e => e.includes('chartsheets/'));

    // Drawing entries
    const drawingEntries = entries.filter(e => e.includes('drawings/drawing') && e.endsWith('.xml'));
    const allDrawingXml = drawingEntries.map(e => getXml(e)).join('\n');

    // Comments
    const commentEntries = entries.filter(e => e.includes('comments') && !e.includes('threadedComment') && e.endsWith('.xml'));

    // Rels for hyperlinks
    const allRelsXml = entries.filter(e => e.endsWith('.rels')).map(e => getXml(e)).join('\n');

    // All formulas
    const formulaMatches = [...allSheetXml.matchAll(/<f[^>]*>([^<]+)<\/f>/g)].map(m => m[1]);
    const allFormulas = formulaMatches.join(' ').replace(/&gt;/g,'>')
      .replace(/&lt;/g,'<').replace(/&amp;/g,'&').replace(/&quot;/g,'"');

    // Helper: check if a numFmtId is non-default (not 0=General, not openpyxl defaults)
    const defaultNumFmts = new Set(['0','164','49','1','2','3','4','9','10','11','12','13','14','15','16','17','18','19','20','21','22','37','38','39','40','41','42','43','44','45','46','47','48']);
    const cellXfs = stylesXml.match(/<cellXfs>([\s\S]*?)<\/cellXfs>/)?.[1] || '';
    const appliedNumFmts = [...cellXfs.matchAll(/numFmtId="(\d+)"/g)].map(m => m[1]);
    const hasCustomNumFmt = appliedNumFmts.some(id => !defaultNumFmts.has(id) && id !== '0');

    // Helper: non-default alignment in cellXfs
    const alignmentInCellXfs = [...cellXfs.matchAll(/<alignment[^>]+>/g)].map(m => m[0]);
    const hasNonDefaultAlignment = alignmentInCellXfs.some(a =>
      /horizontal="(?!general)[^"]+/.test(a) ||
      /vertical="(?!bottom)[^"]+/.test(a) ||
      /textRotation=/.test(a) ||
      /indent="[1-9]/.test(a)
    );

    // Helper: wrap text actually applied in cellXfs
    const hasWrapInCellXfs = /wrapText="1"/.test(cellXfs);

    // Helper: non-default font (bold OR color OR size != 11) in cellXfs via fontId
    const fontXfs = [...cellXfs.matchAll(/fontId="(\d+)"/g)].map(m => m[1]).filter(id => id !== '0');
    const fontsXml = stylesXml.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/)?.[1] || '';
    const fontList = [...fontsXml.matchAll(/<font>([\s\S]*?)<\/font>/g)].map(m => m[1]);
    const hasNonDefaultFont = fontXfs.some(id => {
      const f = fontList[parseInt(id)] || '';
      return /<b\/>/.test(f) || /<color[^>]+rgb="(?!FF000000|FFFF0000)[^"]{8}"/.test(f) ||
             /<sz val="(?!11")[^"]*"/.test(f);
    });

    // Helper: check for custom row height or column width
    const hasCustomRowHeight = /customHeight="1"[^>]*ht="(?!(?:15|12\.75|13\.5)")[^"]+"|ht="(?!(?:15|12\.75|13\.5)")[^"]+"[^>]*customHeight="1"/.test(allSheetXml);
    const hasCustomColWidth  = /customWidth="1"/.test(allSheetXml);

    const skills = [];
    const auto = (domain, name, passed, passMsg, failMsg) =>
      skills.push({ domain, name, type:'auto', passed, passMsg, failMsg });
    const self = (domain, name, hint) =>
      skills.push({ domain, name, type:'self', passed:null, hint });

    // ── E1 — Manage Worksheets and Workbooks ──────────────────────────────
    self('E1 — Manage Worksheets & Workbooks','Import data from text file',
      'Data → Get Data → From Text/CSV → select a .csv file → Load. The end result is indistinguishable from typed data.');

    auto('E1 — Manage Worksheets & Workbooks','Insert and remove hyperlinks',
      allSheetXml.includes('<hyperlink') || allRelsXml.includes('hyperlink'),
      '✓ Hyperlink detected.',
      '✗ No hyperlink. Fix: Select a cell → Insert → Link (Ctrl+K) → enter a URL.');

    auto('E1 — Manage Worksheets & Workbooks','Modify page setup',
      /orientation="(?:landscape|portrait)"|<pageSetup[^>]*(?:paperSize|scale)=/.test(allSheetXml),
      '✓ Page setup change detected.',
      '✗ No page setup change. Fix: Page Layout → Orientation or Size.');

    auto('E1 — Manage Worksheets & Workbooks','Adjust row height and column width',
      // Starter already has customWidth set by openpyxl; require customHeight as evidence of student action
      /customHeight="1"/.test(allSheetXml),
      '✓ Custom row height detected.',
      '✗ No row height change. Fix: Right-click a row number → Row Height → type a value (e.g. 20).');

    auto('E1 — Manage Worksheets & Workbooks','Customize headers and footers',
      /<oddHeader>[^<]{3,}<\/oddHeader>|<oddFooter>[^<]{3,}<\/oddFooter>/.test(allSheetXml),
      '✓ Header or footer content detected.',
      '✗ No header/footer. Fix: Insert → Header & Footer → type content.');

    auto('E1 — Manage Worksheets & Workbooks','Display worksheets in different views',
      /view="(?:pageLayout|pageBreakPreview)"/.test(allSheetXml),
      '✓ Page Layout or Page Break Preview detected.',
      '✗ View not changed. Fix: View → Page Layout or Page Break Preview.');

    auto('E1 — Manage Worksheets & Workbooks','Freeze rows and columns',
      /state="frozen"/.test(allSheetXml),
      '✓ Frozen pane detected.',
      '✗ No frozen panes. Fix: Click cell B2 → View → Freeze Panes → Freeze Panes.');

    auto('E1 — Manage Worksheets & Workbooks','Modify built-in workbook properties',
      (()=>{
        const title = (coreXml.match(/<dc:title>([^<]+)<\/dc:title>/) || [])[1] || '';
        return title.length > 0 && title !== 'Excel Practice Starter';
      })(),
      '✓ Workbook properties updated.',
      '✗ Properties not changed. Fix: File → Info → Properties → add Title and Author.');

    auto('E1 — Manage Worksheets & Workbooks','Display formulas',
      /showFormulas="1"/.test(allSheetXml),
      '✓ Show Formulas mode detected.',
      '✗ Not detected. Fix: Formulas → Show Formulas (Ctrl+`).');

    auto('E1 — Manage Worksheets & Workbooks','Set a print area',
      /Print_Area/.test(wbXml),
      '✓ Print area detected.',
      '✗ No print area. Fix: Select range → Page Layout → Print Area → Set Print Area.');

    auto('E1 — Manage Worksheets & Workbooks','Configure print settings',
      /<printOptions[^>]+(?:headings|gridLines|horizontalCentered|verticalCentered)|<pageSetup[^>]+(?:fitToWidth|copies|firstPageNumber)/.test(allSheetXml),
      '✓ Print settings configured.',
      '✗ No print settings. Fix: Page Layout → Print Titles or File → Print → Page Setup.');

    auto('E1 — Manage Worksheets & Workbooks','Manage comments and notes',
      commentEntries.length > 0 || /threadedComment/.test(entries.join('|')),
      '✓ Comment or note detected.',
      '✗ No comment. Fix: Right-click a cell → New Comment → type your note.');

    self('E1 — Manage Worksheets & Workbooks','Search for data within a workbook',
      'Use Ctrl+F to open Find. Type a value and press Enter to search. This is navigation only — no file trace.');
    self('E1 — Manage Worksheets & Workbooks','Navigate to named cells or ranges',
      'Use the Name Box (top-left) or Ctrl+G to go to a specific cell or named range.');
    self('E1 — Manage Worksheets & Workbooks','Customize options and views',
      'File → Options. These are app-level settings not saved in the workbook.');
    self('E1 — Manage Worksheets & Workbooks','Manage the Quick Access Toolbar',
      'File → Options → Quick Access Toolbar. Stored in your Excel profile, not the workbook.');
    self('E1 — Manage Worksheets & Workbooks','Change window views',
      'View → Arrange All or New Window. Window arrangement is not saved in the file.');
    self('E1 — Manage Worksheets & Workbooks','Save / export in alternative file formats',
      'File → Save As → choose .csv, .pdf, or another format. The .xlsx cannot confirm this.');
    self('E1 — Manage Worksheets & Workbooks','Inspect workbook and correct issues',
      'File → Info → Check for Issues → Inspect Document. Results are not saved to the file.');

    // ── E2 — Manage Data Cells and Ranges ─────────────────────────────────
    auto('E2 — Manage Data Cells & Ranges','Fill cells by using AutoFill',
      (()=>{
        // Starter has no series; student fills a series — check for sequential values
        const nums = [...allSheetXml.matchAll(/<v>(\d+)<\/v>/g)].map(m => parseInt(m[1]));
        const hasSequence = nums.some((v,i) => i > 0 && v === nums[i-1] + 1);
        return hasSequence;
      })(),
      '✓ Sequential data series detected — AutoFill likely used.',
      '✗ No series detected. Fix: Type first two values, select them, drag fill handle down.');

    auto('E2 — Manage Data Cells & Ranges','Generate data: RANDBETWEEN / SEQUENCE',
      /RANDBETWEEN|SEQUENCE/.test(allFormulas),
      '✓ RANDBETWEEN or SEQUENCE formula detected.',
      '✗ Not found. Fix: Type =RANDBETWEEN(1,100) or =SEQUENCE(10) in a cell.');

    auto('E2 — Manage Data Cells & Ranges','Merge and unmerge cells',
      // Starter has one title merge; student should add more
      (allSheetXml.match(/<mergeCell /g) || []).length > 1,
      '✓ Merged cells detected.',
      '✗ No student merge found. Fix: Select cells → Home → Merge & Center.');

    auto('E2 — Manage Data Cells & Ranges','Modify alignment, orientation, indentation',
      hasNonDefaultAlignment,
      '✓ Non-default alignment detected.',
      '✗ No alignment change. Fix: Home → Alignment group → center, right-align, or rotate.');

    auto('E2 — Manage Data Cells & Ranges','Wrap text within cells',
      hasWrapInCellXfs,
      '✓ Wrap text detected.',
      '✗ No wrap text. Fix: Select cells → Home → Wrap Text button.');

    auto('E2 — Manage Data Cells & Ranges','Apply number formats',
      hasCustomNumFmt,
      '✓ Custom number format detected.',
      '✗ No number format. Fix: Select cells → Home → Number group → Currency or Percentage.');

    auto('E2 — Manage Data Cells & Ranges','Apply cell formats (font/fill/border)',
      hasNonDefaultFont || /fillId="[1-9]/.test(cellXfs) || /borderId="[1-9]/.test(cellXfs),
      '✓ Cell formatting (font/fill/border) detected.',
      '✗ No formatting. Fix: Select cells → Home → Font/Fill/Border controls.');

    auto('E2 — Manage Data Cells & Ranges','Apply cell styles (named)',
      /cellStyleXfId="[1-9]/.test(cellXfs) || /<cellStyle[^>]*name="(?!Normal)[^"]{2,}"/.test(stylesXml),
      '✓ Named cell style applied.',
      '✗ No named style. Fix: Home → Cell Styles gallery → choose Good, Bad, Heading 1, etc.');

    auto('E2 — Manage Data Cells & Ranges','Define a named range',
      /<definedName[^>]*name="(?!_xlnm)[^"]+/.test(wbXml),
      '✓ Named range detected.',
      '✗ No named range. Fix: Select range → Formulas → Define Name → type a name.');

    auto('E2 — Manage Data Cells & Ranges','Reference a named range',
      (()=>{
        const names = [...wbXml.matchAll(/<definedName[^>]*name="([^"]+)"/g)]
          .map(m => m[1]).filter(n => !n.startsWith('_xlnm'));
        return names.some(n => allFormulas.includes(n));
      })(),
      '✓ Named range referenced in a formula.',
      '✗ Not detected. Fix: In a formula, type the range name instead of the cell address.');

    auto('E2 — Manage Data Cells & Ranges','Insert Sparklines',
      /sparkline/i.test(allSheetXml),
      '✓ Sparklines detected.',
      '✗ No sparklines. Fix: Select data → Insert → Sparklines → Line or Column.');

    auto('E2 — Manage Data Cells & Ranges','Apply built-in conditional formatting',
      /<conditionalFormatting/.test(allSheetXml),
      '✓ Conditional formatting detected.',
      '✗ No conditional formatting. Fix: Select range → Home → Conditional Formatting → choose a rule.');

    self('E2 — Manage Data Cells & Ranges','Paste using special paste options',
      'Home → Paste → Paste Special (Ctrl+Alt+V). The end result is indistinguishable from typed values.');
    self('E2 — Manage Data Cells & Ranges','Insert and delete multiple columns or rows',
      'Right-click a row/column header → Insert or Delete. Final layout looks the same as data always there.');
    self('E2 — Manage Data Cells & Ranges','Format cells by using Format Painter',
      'Click a formatted cell → Home → Format Painter → click target. End result is the same as manual formatting.');
    self('E2 — Manage Data Cells & Ranges','Clear cell formatting',
      'Select cells → Home → Clear → Clear Formats. Cleared cells look identical to unformatted ones.');
    self('E2 — Manage Data Cells & Ranges','Format multiple worksheets by grouping',
      'Shift-click sheet tabs to group them → apply formatting. Per-sheet result looks like normal formatting.');
    self('E2 — Manage Data Cells & Ranges','Remove conditional formatting',
      'Home → Conditional Formatting → Clear Rules. Removed rules look the same as never applied.');

    // ── E3 — Manage Tables and Table Data ─────────────────────────────────
    auto('E3 — Manage Tables & Table Data','Create Excel tables from cell ranges',
      tableEntries.length > 0,
      `✓ ${tableEntries.length} Excel table(s) detected.`,
      '✗ No table found. Fix: Select data range → Insert → Table (Ctrl+T).');

    auto('E3 — Manage Tables & Table Data','Apply table styles',
      /<tableStyleInfo[^>]*name="(?!TableStyleMedium2|TableStyleMedium9)[^"]*"/.test(allTableXml) ||
      /<tableStyleInfo[^>]*name="[^"]{5,}"/.test(allTableXml),
      '✓ Table style applied.',
      '✗ No table style. Fix: Click in table → Table Design → Table Styles gallery.');

    auto('E3 — Manage Tables & Table Data','Convert tables to cell ranges',
      // Starter has no tables; student creates one then converts another
      // Detect: student converted a table (hard to detect after conversion)
      // Better: if student has done convert, the table XML count < number they created
      // Self-check fallback since conversion leaves no artifact
      false,
      '✓ Table converted to range.',
      '✗ Not detected. Fix: Click in table → Table Design → Convert to Range.');

    auto('E3 — Manage Tables & Table Data','Add or remove table rows and columns',
      tableEntries.length > 0 && /<table[^>]*ref="[A-Z]+1:[A-Z]+(?:[2-9]|[1-9]\d)"/.test(allTableXml),
      '✓ Table with data rows detected.',
      '✗ No table with rows. Fix: Click last row of table → Tab to add a new row.');

    auto('E3 — Manage Tables & Table Data','Configure table style options',
      /showRowStripes="(?:0|1)"|showFirstColumn="1"|showLastColumn="1"|showColumnStripes="1"/.test(allTableXml),
      '✓ Table style options configured.',
      '✗ Not detected. Fix: Click in table → Table Design → Table Style Options checkboxes.');

    auto('E3 — Manage Tables & Table Data','Insert and configure total rows',
      /totalsRowShown="1"/.test(allTableXml),
      '✓ Total row detected.',
      '✗ No total row. Fix: Click in table → Table Design → Total Row checkbox.');

    auto('E3 — Manage Tables & Table Data','Filter records',
      /<autoFilter>/.test(allSheetXml) && /<filterColumn/.test(allSheetXml),
      '✓ Active filter detected.',
      '✗ No filter applied. Fix: Click column dropdown → uncheck some values to filter.');

    auto('E3 — Manage Tables & Table Data','Sort data by multiple columns',
      /<sortState[^>]*>[\s\S]*?<sortCondition[\s\S]*?<sortCondition/.test(allSheetXml),
      '✓ Multi-column sort detected.',
      '✗ No multi-column sort. Fix: Data → Sort → Add Level → set primary and secondary sort.');

    // ── E4 — Formulas and Functions ───────────────────────────────────────
    const hasFormula = (fn) => new RegExp(`\\b${fn}\\b`, 'i').test(allFormulas);

    auto('E4 — Formulas & Functions','Relative, absolute, and mixed references',
      /\$[A-Z]+\$\d+|\$[A-Z]+\d+|[A-Z]+\$\d+/.test(allFormulas),
      '✓ Absolute or mixed cell reference detected.',
      '✗ No $ reference. Fix: In a formula, press F4 to toggle $A$1 absolute references.');

    auto('E4 — Formulas & Functions','Structured references in formulas',
      /\[.*?\]/.test(allFormulas) && allFormulas.includes('['),
      '✓ Structured table reference detected.',
      '✗ Not found. Fix: In a formula inside a table, reference columns as Table1[ColumnName].');

    auto('E4 — Formulas & Functions','AVERAGE / MAX / MIN / SUM',
      hasFormula('SUM') || hasFormula('AVERAGE') || hasFormula('MAX') || hasFormula('MIN'),
      '✓ SUM/AVERAGE/MAX/MIN formula detected.',
      '✗ Not found. Fix: Type =SUM(B2:B10) or use Home → AutoSum dropdown.');

    auto('E4 — Formulas & Functions','COUNT / COUNTA / COUNTBLANK',
      hasFormula('COUNT') || hasFormula('COUNTA') || hasFormula('COUNTBLANK'),
      '✓ COUNT/COUNTA/COUNTBLANK formula detected.',
      '✗ Not found. Fix: Type =COUNT(B2:B10) in a cell.');

    auto('E4 — Formulas & Functions','IF',
      hasFormula('IF'),
      '✓ IF formula detected.',
      '✗ No IF. Fix: Type =IF(A1>100,"High","Low") in a cell.');

    auto('E4 — Formulas & Functions','SORT()',
      hasFormula('SORT'),
      '✓ SORT() dynamic array formula detected.',
      '✗ Not found. Fix: Type =SORT(A2:A10) in a cell.');

    auto('E4 — Formulas & Functions','UNIQUE()',
      hasFormula('UNIQUE'),
      '✓ UNIQUE() dynamic array formula detected.',
      '✗ Not found. Fix: Type =UNIQUE(C2:C20) in a cell.');

    auto('E4 — Formulas & Functions','LEFT / RIGHT / MID',
      hasFormula('LEFT') || hasFormula('RIGHT') || hasFormula('MID'),
      '✓ LEFT/RIGHT/MID text formula detected.',
      '✗ Not found. Fix: Type =LEFT(A2,3) to extract first 3 characters.');

    auto('E4 — Formulas & Functions','UPPER / LOWER / LEN',
      hasFormula('UPPER') || hasFormula('LOWER') || hasFormula('LEN'),
      '✓ UPPER/LOWER/LEN formula detected.',
      '✗ Not found. Fix: Type =UPPER(A2) or =LEN(A2) in a cell.');

    auto('E4 — Formulas & Functions','CONCAT / TEXTJOIN',
      hasFormula('CONCAT') || hasFormula('TEXTJOIN'),
      '✓ CONCAT or TEXTJOIN formula detected.',
      '✗ Not found. Fix: Type =TEXTJOIN(", ",TRUE,A2:A5) to join text.');

    auto('E4 — Formulas & Functions','Nested IF',
      (allFormulas.match(/IF\(/gi) || []).length >= 2,
      '✓ Nested IF detected.',
      '✗ No nested IF. Fix: Type =IF(A1>100,"High",IF(A1>50,"Mid","Low")).');

    auto('E4 — Formulas & Functions','COUNTIF',
      hasFormula('COUNTIF'),
      '✓ COUNTIF detected.',
      '✗ Not found. Fix: Type =COUNTIF(C2:C20,"Corporate").');

    auto('E4 — Formulas & Functions','SUMIF',
      hasFormula('SUMIF'),
      '✓ SUMIF detected.',
      '✗ Not found. Fix: Type =SUMIF(C2:C20,"Corporate",E2:E20).');

    auto('E4 — Formulas & Functions','TODAY / NOW',
      hasFormula('TODAY') || hasFormula('NOW'),
      '✓ TODAY() or NOW() detected.',
      '✗ Not found. Fix: Type =TODAY() to show today\'s date.');

    auto('E4 — Formulas & Functions','YEAR / MONTH / DAY',
      hasFormula('YEAR') || hasFormula('MONTH') || hasFormula('DAY'),
      '✓ YEAR/MONTH/DAY formula detected.',
      '✗ Not found. Fix: Type =YEAR(F2) to extract the year from a date.');

    auto('E4 — Formulas & Functions','VLOOKUP',
      hasFormula('VLOOKUP'),
      '✓ VLOOKUP detected.',
      '✗ Not found. Fix: Type =VLOOKUP(A2,PriceTable!A:D,3,FALSE).');

    auto('E4 — Formulas & Functions','XLOOKUP',
      hasFormula('XLOOKUP'),
      '✓ XLOOKUP detected.',
      '✗ Not found. Fix: Type =XLOOKUP(A2,PriceTable!A:A,PriceTable!C:C).');

    auto('E4 — Formulas & Functions','IFERROR',
      hasFormula('IFERROR'),
      '✓ IFERROR detected.',
      '✗ Not found. Fix: Wrap a formula: =IFERROR(VLOOKUP(...),"Not found").');

    // ── E5 — Manage Charts ────────────────────────────────────────────────
    auto('E5 — Manage Charts','Create charts',
      chartEntries.length > 0,
      `✓ ${chartEntries.length} chart(s) detected.`,
      '✗ No chart. Fix: Select data → Insert → Charts → choose Column, Line, or Pie.');

    auto('E5 — Manage Charts','Create chart sheets',
      chartSheetEntries.length > 0,
      '✓ Chart sheet detected.',
      '✗ No chart sheet. Fix: Right-click chart → Move Chart → New sheet → OK.');

    auto('E5 — Manage Charts','Add data series to charts',
      chartEntries.length > 0 && (()=>{
        const chartXml = chartEntries.map(e => getXml(e)).join('\n');
        return (chartXml.match(/<c:ser>/g) || []).length >= 2;
      })(),
      '✓ Multiple data series detected.',
      '✗ Only one data series. Fix: Right-click chart → Select Data → Add → select another range.');

    auto('E5 — Manage Charts','Add and modify chart elements',
      (()=>{
        const chartXml = chartEntries.map(e => getXml(e)).join('\n');
        return /<c:dLbls>|<c:title>|<c:trendline>|<c:majorGridlines>/.test(chartXml);
      })(),
      '✓ Chart elements (labels/title/trendline) detected.',
      '✗ No chart elements. Fix: Click chart → Chart Design → Add Chart Element.');

    auto('E5 — Manage Charts','Apply chart styles',
      (()=>{
        const chartXml = chartEntries.map(e => getXml(e)).join('\n');
        return /<c:style val="[^1"][^"]*"/.test(chartXml) || /<c:style val="1[^"]/.test(chartXml);
      })(),
      '✓ Chart style applied.',
      '✗ No chart style. Fix: Click chart → Chart Design → Chart Styles gallery.');

    auto('E5 — Manage Charts','Add alternative text to charts',
      /descr="[^"]{5,}"/.test(allDrawingXml),
      '✓ Alt text on chart detected.',
      '✗ No alt text. Fix: Right-click chart border → Edit Alt Text → type description.');

    self('E5 — Manage Charts','Switch between rows and columns in source data',
      'Chart Design → Switch Row/Column. The result is not reliably distinguishable from a chart built the other way.');
    self('E5 — Manage Charts','Apply chart layouts',
      'Chart Design → Quick Layout. This stores no distinct layout ID in the file.');

    fs.unlinkSync(req.file.path);
    res.json({ skills });
  } catch(err) {
    console.error('Excel practice grading error:', err.stack || err);
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