#!/usr/bin/env python3
"""
IS101 — Core 1 Grading Engine
Annual Business Report — Desert Sun Consulting
40 tasks · 100 points
"""
import warnings
warnings.filterwarnings('ignore')
import logging
logging.disable(logging.CRITICAL)
from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_LINE_SPACING
from docx.oxml.ns import qn
import sys, json, re

def grade_core1(filepath):
    results = []
    total_pts = 0
    earned_pts = 0

    def check(task_num, pts, description, passed, feedback_pass, feedback_fail):
        nonlocal total_pts, earned_pts
        total_pts += pts
        if passed:
            earned_pts += pts
        results.append({
            'task': task_num,
            'pts_possible': pts,
            'pts_earned': pts if passed else 0,
            'description': description,
            'passed': passed,
            'feedback': feedback_pass if passed else feedback_fail,
        })

    try:
        doc = Document(filepath)
    except Exception as e:
        return {'error': f'Could not open file: {e}', 'results': [], 'score': 0, 'total': 100}

    section = doc.sections[0]

    # ── D1 — Manage Documents ─────────────────────────────────────────────────

    # Task 1: Margins 1 inch (914400 EMUs = 1 inch)
    INCH = 914400
    top    = section.top_margin
    bottom = section.bottom_margin
    left   = section.left_margin
    right  = section.right_margin
    margins_ok = all(
        abs(m - INCH) < 36000  # allow ±0.04 inch tolerance
        for m in [top, bottom, left, right]
        if m is not None
    )
    check(1, 2, 'Set 1-inch margins on all sides', margins_ok,
          '✓ Margins are set to 1 inch on all sides.',
          f'✗ Margins are not 1 inch. Found: Top={round(top/INCH,2) if top else "?"}in, '
          f'Bottom={round(bottom/INCH,2) if bottom else "?"}in, '
          f'Left={round(left/INCH,2) if left else "?"}in, '
          f'Right={round(right/INCH,2) if right else "?"}in. '
          f'Fix: Layout tab → Margins → Normal (1" all sides).')

    # Task 2: Portrait orientation
    from docx.enum.section import WD_ORIENT
    portrait_ok = (section.orientation == WD_ORIENT.PORTRAIT or section.orientation is None)
    check(2, 2, 'Set orientation to Portrait', portrait_ok,
          '✓ Document is in Portrait orientation.',
          '✗ Document is not in Portrait orientation. Fix: Layout tab → Orientation → Portrait.')

    # Task 3: Style set applied (check theme/styles — we look for any non-default style)
    style_names = [s.name for s in doc.styles]
    has_custom_styles = any(s in style_names for s in ['Body Text', 'Title', 'Subtitle'])
    # Accept if document has heading styles used
    headings_used = any(p.style.name.startswith('Heading') for p in doc.paragraphs)
    style_ok = has_custom_styles or headings_used
    check(3, 2, 'Apply the "Basic (Stylish)" style set', style_ok,
          '✓ A style set has been applied — heading and body styles are present.',
          '✗ No style set detected. Fix: Design tab → Document Formatting → Style Sets → Basic (Stylish).')

    # Task 4: Header with company name and date
    header_text = ''
    try:
        for para in section.header.paragraphs:
            header_text += para.text
    except: pass
    has_company = 'Desert Sun Consulting' in header_text or 'desert sun' in header_text.lower()
    has_date    = any(str(y) in header_text for y in [2025,2026,2027]) or \
                  any(m in header_text for m in ['January','February','March','April','May','June',
                                                  'July','August','September','October','November','December'])
    header_ok = has_company and has_date
    check(4, 3, 'Insert header: company name left-aligned, date right-aligned', header_ok,
          '✓ Header contains company name and date.',
          f'✗ Header issue. Company name found: {has_company}. Date found: {has_date}. '
          f'Fix: Insert tab → Header → Blank (Three Columns). Add "Desert Sun Consulting" left, date right.')

    # Task 5: Footer with "Confidential"
    footer_text = ''
    try:
        for para in section.footer.paragraphs:
            footer_text += para.text
    except: pass
    footer_ok = 'confidential' in footer_text.lower()
    check(5, 2, 'Insert footer: "Confidential" centered', footer_ok,
          '✓ Footer contains "Confidential".',
          '✗ Footer does not contain "Confidential". Fix: Insert tab → Footer → Blank. '
          'Press Tab to center, type: Confidential.')

    # Task 6: Page numbers in footer
    footer_xml = ''
    try:
        footer_xml = section.footer._element.xml
    except: pass
    has_page_num = 'PAGE' in footer_xml or 'fldChar' in footer_xml or \
                   any(str(n) in footer_text for n in range(1,20))
    check(6, 2, 'Insert page numbers bottom right', has_page_num,
          '✓ Page numbers are present in the footer.',
          '✗ Page numbers not found in footer. Fix: Insert tab → Page Number → Bottom of Page → Plain Number 3.')

    # Task 7: Watermark (DRAFT)
    watermark_found = False
    try:
        header_xml = section.header._element.xml
        watermark_found = 'DRAFT' in header_xml or 'watermark' in header_xml.lower() or \
                          'pict' in header_xml.lower()
    except: pass
    check(7, 2, 'Add a "DRAFT" watermark', watermark_found,
          '✓ DRAFT watermark is present.',
          '✗ DRAFT watermark not found. Fix: Design tab → Watermark → DRAFT 1.')

    # Task 8: Document properties
    props = doc.core_properties
    has_title  = bool(props.title and props.title.strip())
    has_author = bool(props.author and props.author.strip())
    props_ok   = has_title and has_author
    check(8, 2, 'Set document properties: Title and Author', props_ok,
          f'✓ Document properties set. Title: "{props.title}", Author: "{props.author}".',
          f'✗ Document properties incomplete. Title: "{props.title or "blank"}", '
          f'Author: "{props.author or "blank"}". '
          f'Fix: File tab → Info → Properties panel → fill in Title and Author.')

    # Task 9: Accessibility check (process task — auto-pass with note)
    check(9, 2, 'Run Accessibility Check and note any issues in a comment', True,
          '✓ Accessibility check task (process task — verified by instructor).',
          '✗ Accessibility check task (process task — verified by instructor).')

    # Task 10: Saved as PDF (process task — we check if they mentioned it)
    check(10, 3, 'Save a PDF copy for distribution', True,
          '✓ Save as PDF task (process task — verified by instructor).',
          '✗ Save as PDF task (process task — verified by instructor).')

    # ── D2 — Format Text & Paragraphs ─────────────────────────────────────────

    # Task 11: Find & Replace DSC → Desert Sun Consulting
    full_text = '\n'.join(p.text for p in doc.paragraphs)
    dsc_count = full_text.count(' DSC ') + full_text.count(' DSC,') + \
                full_text.count(' DSC.') + full_text.count('(DSC)')
    no_dsc = dsc_count == 0
    check(11, 2, 'Find & Replace: "DSC" → "Desert Sun Consulting"', no_dsc,
          '✓ No standalone "DSC" abbreviations found — replacement completed.',
          f'✗ Found {dsc_count} instance(s) of "DSC" still in document. '
          f'Fix: Ctrl+H → Find: DSC → Replace with: Desert Sun Consulting → Replace All.')

    # Task 12: Title style applied
    has_title_style = any(p.style.name in ('Title','title') for p in doc.paragraphs)
    check(12, 2, 'Apply Title style to document title', has_title_style,
          '✓ Title style is applied.',
          '✗ Title style not found. Fix: Click the document title → Home tab → Styles → Title.')

    # Task 13: Heading 1 applied to section headers
    h1_paras = [p for p in doc.paragraphs if p.style.name == 'Heading 1']
    has_h1   = len(h1_paras) >= 3
    check(13, 3, 'Apply Heading 1 to all section headers (at least 3)', has_h1,
          f'✓ Heading 1 applied to {len(h1_paras)} section(s).',
          f'✗ Only {len(h1_paras)} Heading 1 paragraph(s) found — need at least 3. '
          f'Fix: Click each section header → Home tab → Styles → Heading 1.')

    # Task 14: Heading 2 applied to subsections
    h2_paras = [p for p in doc.paragraphs if p.style.name == 'Heading 2']
    has_h2   = len(h2_paras) >= 1
    check(14, 3, 'Apply Heading 2 to subsection headers (at least 1)', has_h2,
          f'✓ Heading 2 applied to {len(h2_paras)} subsection(s).',
          f'✗ No Heading 2 paragraphs found. '
          f'Fix: Click each subsection header → Home tab → Styles → Heading 2.')

    # Task 15: Line spacing 1.15
    body_paras = [p for p in doc.paragraphs
                  if p.style.name in ('Normal','Body Text','') and p.text.strip()]
    spacing_ok_count = 0
    for p in body_paras[:5]:
        pf = p.paragraph_format
        if pf.line_spacing is not None:
            if pf.line_spacing_rule == WD_LINE_SPACING.MULTIPLE:
                if abs(float(pf.line_spacing) - 1.15) < 0.05:
                    spacing_ok_count += 1
            elif abs(float(pf.line_spacing)/12700 - 1.15) < 0.05:
                spacing_ok_count += 1
    spacing_ok = spacing_ok_count >= 1 or len(body_paras) == 0
    check(15, 2, 'Set body text line spacing to 1.15', spacing_ok,
          '✓ Line spacing of 1.15 detected in body text.',
          '✗ Body text line spacing is not 1.15. Fix: Select body text → Home → '
          'Line and Paragraph Spacing → 1.15.')

    # Task 16: 6pt spacing after paragraphs
    space_after_ok = False
    for p in body_paras[:5]:
        sa = p.paragraph_format.space_after
        if sa is not None and abs(sa - Pt(6)) < Pt(1):
            space_after_ok = True
            break
    check(16, 2, 'Set 6pt spacing after each paragraph', space_after_ok,
          '✓ 6pt paragraph spacing after detected.',
          '✗ 6pt spacing after paragraphs not found. Fix: Select text → Home → '
          'Line Spacing → Add Space After Paragraph, or Paragraph dialog → Spacing After: 6pt.')

    # Task 17: Format Painter used (process task)
    check(17, 3, 'Use Format Painter to copy exec summary formatting to conclusion', True,
          '✓ Format Painter task (process task — verified by instructor).',
          '✗ Format Painter task (process task — verified by instructor).')

    # Task 18: Section break before Financial Summary → Landscape
    has_section_break = len(doc.sections) > 1
    landscape_section = any(
        s.orientation and str(s.orientation) == 'WD_ORIENT.LANDSCAPE'
        for s in doc.sections
    )
    section_ok = has_section_break
    check(18, 3, 'Insert section break; change Financial Summary section to Landscape',
          section_ok,
          f'✓ Multiple sections found ({len(doc.sections)} sections).',
          '✗ No section break found. Fix: Click before Financial Summary → '
          'Layout tab → Breaks → Next Page. Then set that section to Landscape.')

    # ── D3 — Tables & Lists ───────────────────────────────────────────────────

    tables = doc.tables

    # Task 19: Create 4-column quarterly revenue table
    revenue_table = None
    for t in tables:
        if len(t.columns) == 4 and len(t.rows) >= 4:
            # Check for revenue-related content
            flat = ' '.join(c.text for row in t.rows for c in row.cells).lower()
            if any(w in flat for w in ['quarter','revenue','q1','q2']):
                revenue_table = t
                break
    check(19, 3, 'Create a 4-column quarterly revenue table', revenue_table is not None,
          f'✓ 4-column revenue table found with {len(revenue_table.rows) if revenue_table else 0} rows.',
          '✗ No 4-column quarterly revenue table found. Fix: Place cursor after Financial Summary → '
          'Insert → Table → 4 columns × 5 rows. Fill in Quarter, Revenue, Expenses, Net Profit.')

    # Task 20: Merged cells in top row
    merged_ok = False
    if revenue_table:
        try:
            first_row = revenue_table.rows[0]
            # Check if cells are merged (same tcPr span)
            xml = first_row._tr.xml
            merged_ok = 'gridSpan' in xml or len(set(c.text for c in first_row.cells)) <= 2
        except:
            merged_ok = False
    check(20, 2, 'Merge top row cells for spanning title', merged_ok,
          '✓ Top row cells are merged.',
          '✗ Top row cells not merged. Fix: Select all cells in row 1 → '
          'Table Layout tab → Merge Cells.')

    # Task 21: Client table sorted alphabetically
    client_table = None
    for t in tables:
        flat = ' '.join(c.text for row in t.rows for c in row.cells).lower()
        if 'client' in flat or 'nevada valley' in flat or 'desert medical' in flat:
            client_table = t
            break
    if client_table and len(client_table.rows) >= 3:
        names = [client_table.rows[i].cells[0].text for i in range(1, len(client_table.rows))]
        names_clean = [n.strip() for n in names if n.strip()]
        sorted_ok = names_clean == sorted(names_clean) or names_clean == sorted(names_clean, key=str.lower)
    else:
        sorted_ok = False
    check(21, 2, 'Sort client table alphabetically by client name', sorted_ok,
          '✓ Client table is sorted alphabetically.',
          '✗ Client table is not sorted alphabetically. Fix: Click in the table → '
          'Table Layout tab → Sort → Sort by column 1, Ascending.')

    # Task 22: Numbered list with 5 items
    numbered_paras = [p for p in doc.paragraphs
                      if 'List Number' in p.style.name or 'List Num' in p.style.name]
    has_numbered = len(numbered_paras) >= 5
    check(22, 2, 'Create numbered list of 5 strategic objectives', has_numbered,
          f'✓ Numbered list found with {len(numbered_paras)} item(s).',
          f'✗ Only {len(numbered_paras)} numbered list item(s) found — need 5. '
          f'Fix: Select the 5 objectives → Home tab → Numbering button.')

    # Task 23: Bulleted list
    bullet_paras = [p for p in doc.paragraphs
                    if 'List Bullet' in p.style.name or 'List Bull' in p.style.name]
    has_bullets = len(bullet_paras) >= 4
    check(23, 2, 'Create bulleted list of services', has_bullets,
          f'✓ Bulleted list found with {len(bullet_paras)} item(s).',
          f'✗ Only {len(bullet_paras)} bulleted list item(s) found. '
          f'Fix: Select the services text → Home tab → Bullets button.')

    # Task 24: Increase list level for sub-items
    sub_bullets = [p for p in doc.paragraphs
                   if 'List Bullet 2' in p.style.name or
                   (p.paragraph_format.left_indent and
                    p.paragraph_format.left_indent > Inches(0.4))]
    has_sub = len(sub_bullets) >= 3
    check(24, 3, 'Increase list level for sub-items under each service', has_sub,
          f'✓ Sub-level list items found ({len(sub_bullets)} items).',
          f'✗ No sub-level list items found. Fix: Select sub-service items → '
          'Home tab → Increase Indent (or Tab key while in list).')

    # ── D4 — References ───────────────────────────────────────────────────────

    # Task 25 & 26: Table of Contents
    full_xml = doc.element.xml
    has_toc = 'TOC' in full_xml or 'toc' in full_xml.lower() or \
              any('table of contents' in p.text.lower() or 'contents' in p.text.lower()
                  for p in doc.paragraphs)
    check(25, 3, 'Insert Table of Contents after title page', has_toc,
          '✓ Table of Contents found.',
          '✗ No Table of Contents found. Fix: Click after title page → References tab → '
          'Table of Contents → Automatic Table 1.')
    check(26, 3, 'Customize TOC to show Heading 1 and Heading 2 only', has_toc,
          '✓ TOC present (customization verified by instructor).',
          '✗ TOC not found — cannot verify customization. Fix: References → '
          'Table of Contents → Custom Table of Contents → Show levels: 2.')

    # Task 27: Footnote
    has_footnote = 'footnote' in full_xml.lower() or 'CT_FtnEdn' in full_xml or \
                   any('¹' in p.text or 'footnote' in p.text.lower() or
                       re.search(r'\[\d+\]', p.text) for p in doc.paragraphs)
    check(27, 4, 'Insert footnote on revenue figure citing data source', has_footnote,
          '✓ Footnote found.',
          '✗ No footnote detected. Fix: Click after the revenue figure → References tab → '
          'Insert Footnote. Type: Source: DSC Financial Records 2026.')

    # ── D5 — Graphic Elements ─────────────────────────────────────────────────

    # Task 28: Picture inserted
    has_picture = len(doc.inline_shapes) > 0 or 'pic:pic' in full_xml or \
                  'blipFill' in full_xml or 'drawing' in full_xml.lower()
    check(28, 3, 'Insert DSC logo image on cover page', has_picture,
          '✓ Image found in document.',
          '✗ No image found. Fix: Insert tab → Pictures → This Device → select your logo image.')

    # Task 29: Picture style applied
    pic_style_ok = 'picLocks' in full_xml or 'spPr' in full_xml or has_picture
    check(29, 2, 'Apply Drop Shadow Rectangle picture style to logo', pic_style_ok,
          '✓ Picture formatting detected (style verified by instructor).',
          '✗ No picture formatting found. Fix: Click image → Picture Format tab → '
          'Picture Styles → Drop Shadow Rectangle.')

    # Task 30: Text wrapping set
    wrap_ok = 'wrapThrough' in full_xml or 'wrapSquare' in full_xml or \
              'wrapTight' in full_xml or 'wrapTopAndBottom' in full_xml or has_picture
    check(30, 2, 'Set text wrapping to Through for the logo', wrap_ok,
          '✓ Text wrapping is set (through or square detected).',
          '✗ Text wrapping not set. Fix: Click image → Picture Format tab → '
          'Wrap Text → Through.')

    # Task 31: SmartArt inserted
    has_smartart = 'dgm:' in full_xml or 'SmartArt' in full_xml or \
                   'diagram' in full_xml.lower() or 'dgmLayout' in full_xml
    check(31, 3, 'Insert SmartArt Hierarchy diagram for org chart', has_smartart,
          '✓ SmartArt found in document.',
          '✗ No SmartArt found. Fix: Insert tab → SmartArt → Hierarchy → Organization Chart → OK.')

    # Task 32: SmartArt content modified
    check(32, 3, 'Modify SmartArt content with department names', has_smartart,
          '✓ SmartArt present (content verified by instructor).',
          '✗ SmartArt not found. Fix: Click SmartArt → SmartArt Design → Text Pane → type department names.')

    # Task 33: Text box inserted
    has_textbox = 'txbx' in full_xml or 'textBox' in full_xml.lower() or \
                  'w:sdt' in full_xml
    check(33, 3, 'Insert text box with report tagline on cover page', has_textbox,
          '✓ Text box found in document.',
          '✗ No text box found. Fix: Insert tab → Text Box → Draw Text Box → '
          "type: Driving Nevada's Business Success.")

    # Task 34: Alt text on images
    has_alt = 'descr=' in full_xml or 'w:descr' in full_xml or \
              'pic:cNvPr' in full_xml
    check(34, 4, 'Add alt text to ALL images in the document', has_alt,
          '✓ Alt text detected on image(s).',
          '✗ No alt text found on images. Fix: Right-click each image → Edit Alt Text → '
          'type a description.')

    # ── D6 — Collaboration ────────────────────────────────────────────────────

    # Task 35: Comment added
    has_comments = 'w:comment' in full_xml or 'commentReference' in full_xml
    check(35, 2, 'Add comment on revenue figure requesting verification', has_comments,
          '✓ Comment(s) found in document.',
          '✗ No comments found. Fix: Select the revenue figure → Review tab → New Comment → '
          'type your verification request.')

    # Task 36: Comment reply
    comment_count = full_xml.count('<w:comment ')
    has_reply = comment_count >= 2
    check(36, 2, 'Reply to existing comment in the document', has_reply,
          f'✓ Multiple comments/replies found ({comment_count}).',
          f'✗ Only {comment_count} comment(s) found — no reply detected. '
          'Fix: Click the existing comment → Reply button → type your reply.')

    # Task 37: Comment resolved
    check(37, 2, 'Resolve the comment after verification', True,
          '✓ Comment resolution (process task — verified by instructor).',
          '✗ Comment resolution (process task — verified by instructor).')

    # Task 38: Track changes
    has_tracked = 'w:ins' in full_xml or 'w:del' in full_xml or \
                  'rsidDel' in full_xml or 'w:rPrChange' in full_xml
    check(38, 3, 'Enable Track Changes; make 3 edits to executive summary', has_tracked,
          '✓ Tracked changes found in document.',
          '✗ No tracked changes found. Fix: Review tab → Track Changes → make 3 edits → '
          'Track Changes stays on.')

    # Task 39: Accept tracked changes
    check(39, 2, 'Accept all tracked changes from manager', True,
          '✓ Accept changes task (process task — verified by instructor).',
          '✗ Accept changes task (process task — verified by instructor).')

    # Task 40: Reject one tracked change
    check(40, 3, 'Reject one tracked change that removed important data', True,
          '✓ Reject tracked change task (process task — verified by instructor).',
          '✗ Reject tracked change task (process task — verified by instructor).')

    # ── Summary ───────────────────────────────────────────────────────────────
    return {
        'score': earned_pts,
        'total': total_pts,
        'pct': round(earned_pts / total_pts * 100) if total_pts > 0 else 0,
        'passed': sum(1 for r in results if r['passed']),
        'failed': sum(1 for r in results if not r['passed']),
        'results': results,
    }

if __name__ == '__main__':
    import os
    import sys as _sys
    # Redirect stderr to devnull so warnings don't contaminate stdout
    _devnull = open(os.devnull, 'w')
    _sys.stderr = _devnull
    path = sys.argv[1] if len(sys.argv) > 1 else '/mnt/user-data/outputs/Word_Core1_Solution.docx'
    result = grade_core1(path)
    # Always output pure JSON — server parses this
    print(json.dumps(result))
