/**
 * FINCART — WEALTH SYSTEMS AUDIT · Google Sheets receiver
 * ---------------------------------------------------------------------------
 * Deploy:
 *   1. Open the target spreadsheet → Extensions → Apps Script → paste this.
 *   2. Change SHARED_SECRET below to a long random string.
 *   3. Run selfTest() once, approve the permission prompt, verify the row,
 *      then delete that row.
 *   4. Deploy → New deployment → Web app
 *        Execute as:      Me
 *        Who has access:  Anyone
 *   5. Copy the /exec URL into CONFIG.endpoint in index.html.
 *
 * The /exec URL is what the page posts to. The docs.google.com/spreadsheets
 * link is NOT an endpoint — a browser cannot POST to it.
 *
 * Behaviour:
 *   stage="lead"     → creates the row as soon as name/email/mobile are captured.
 *   stage="complete" → finds that row by sessionId and fills in the scores.
 *                      If the lead row is missing (network drop), it inserts.
 * Writes are serialised with LockService so concurrent submissions cannot
 * claim the same row index.
 * ---------------------------------------------------------------------------
 */

/** Must match CONFIG.sharedSecret in index.html. CHANGE THIS. */
var SHARED_SECRET = 'CHANGE_ME_BEFORE_DEPLOY';

/**
 * Target spreadsheet, taken from the supplied sheet URL:
 * https://docs.google.com/spreadsheets/d/10W1cmetKAcu2o8Nq6RjLwibQT8SL8ZsY6PM4eFn6JCY/edit
 * Set to '' to use whichever spreadsheet this script is bound to instead.
 */
var SPREADSHEET_ID = '10W1cmetKAcu2o8Nq6RjLwibQT8SL8ZsY6PM4eFn6JCY';

/** Tab the rows are written to. Created automatically if absent. */
var SHEET_NAME = 'Responses';

/** Column order. Changing this reorders the sheet on the next header write. */
var HEADERS = [
  'Timestamp', 'Session ID', 'Name', 'Email', 'Mobile', 'Consent',
  'Clarity', 'Control', 'Coordination', 'Continuity', 'Legacy',
  'Total', 'Band', 'Stage', 'Completed At', 'Source'
];

var COL = {};
(function () { for (var i = 0; i < HEADERS.length; i++) COL[HEADERS[i]] = i + 1; })();

/* -------------------------------------------------------------- entrypoints */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return json({ ok: false, error: 'Empty request body.' });

    var data;
    try { data = JSON.parse(e.postData.contents); }
    catch (err) { return json({ ok: false, error: 'Body is not valid JSON.' }); }

    if (String(data.secret || '') !== SHARED_SECRET) return json({ ok: false, error: 'Unauthorised.' });

    var v = validate(data);
    if (!v.ok) return json({ ok: false, error: v.error });

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return json({ ok: false, error: 'Sheet busy. Retry.' });
    try { writeRow(v.record); } finally { lock.releaseLock(); }

    return json({ ok: true, sessionId: v.record.sessionId, stage: v.record.stage });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

function doGet() {
  return json({ ok: true, service: 'wealth-systems-audit', note: 'POST only.' });
}

/* --------------------------------------------------------------- validation */

/**
 * Rejects anything malformed before it reaches the sheet. The client validates
 * too, but the client is public JavaScript and therefore not trustworthy.
 */
function validate(d) {
  var stage = String(d.stage || '');
  if (stage !== 'lead' && stage !== 'complete') return { ok: false, error: 'Unknown stage: ' + stage };

  var sessionId = String(d.sessionId || '').trim();
  if (!/^[A-Za-z0-9\-]{8,64}$/.test(sessionId)) return { ok: false, error: 'Bad sessionId.' };

  var name = String(d.name || '').trim().replace(/\s{2,}/g, ' ');
  if (name.length < 2 || name.length > 60) return { ok: false, error: 'Bad name length.' };
  if (/\d/.test(name)) return { ok: false, error: 'Name contains digits.' };

  var email = String(d.email || '').trim().toLowerCase();
  if (email.length > 0) {
    if (email.length > 254) return { ok: false, error: 'Email too long.' };
    if (!/^[a-z0-9!#$%&'*+\/=?^_`{|}~.-]{1,64}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(email)) {
      return { ok: false, error: 'Bad email address.' };
    }
    if (email.indexOf('..') !== -1) return { ok: false, error: 'Bad email address.' };
  }

  var mobile = String(d.mobile || '').replace(/\D/g, '');
  if (mobile.length === 12 && mobile.indexOf('91') === 0) mobile = mobile.slice(2);
  if (!/^[6-9]\d{9}$/.test(mobile)) return { ok: false, error: 'Bad mobile number.' };

  var rec = {
    stage: stage,
    sessionId: sessionId,
    name: name,
    // Leading apostrophes keep Sheets from reformatting these and stop a
    // leading = + - @ being evaluated as a formula (CSV-injection guard).
    email: email ? "'" + email : '',
    mobile: "'" + mobile,
    consent: d.consent === true ? 'Yes' : 'No',
    source: String(d.source || '').replace(/^[=+\-@]+/, '').slice(0, 120),
    dims: { Clarity: '', Control: '', Coordination: '', Continuity: '', Legacy: '' },
    total: '',
    band: '',
    completedAt: ''
  };

  if (stage === 'complete') {
    var total = Number(d.total);
    if (!isFinite(total) || total < 5 || total > 20) return { ok: false, error: 'Total out of range: ' + d.total };

    var answers = d.answers;
    if (!answers || answers.length !== 5) {
      return { ok: false, error: 'Expected 5 answers, got ' + (answers ? answers.length : 0) + '.' };
    }

    var sum = 0;
    for (var i = 0; i < answers.length; i++) {
      var a = answers[i];
      var dim = String(a.dimension || '');
      var score = Number(a.score);
      var key = String(a.key || '');
      if (!rec.dims.hasOwnProperty(dim)) return { ok: false, error: 'Unknown dimension: ' + dim };
      if (rec.dims[dim] !== '') return { ok: false, error: 'Duplicate dimension: ' + dim };
      if (!(score >= 1 && score <= 4)) return { ok: false, error: 'Score out of range for ' + dim + '.' };
      if (!/^[A-D]$/.test(key)) return { ok: false, error: 'Bad option key for ' + dim + '.' };
      rec.dims[dim] = key + ' (' + score + ')';
      sum += score;
    }
    if (sum !== total) {
      return { ok: false, error: 'Total ' + total + ' does not match the sum of answers (' + sum + ').' };
    }

    rec.total = total;
    rec.band = String(d.band || '').replace(/^[=+\-@]+/, '').slice(0, 60);
    rec.completedAt = new Date();
  }

  return { ok: true, record: rec };
}

/* ------------------------------------------------------------------ storage */

function getSheet() {
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Spreadsheet not found. Check SPREADSHEET_ID.');

  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#ECF1FF').setFontColor('#0F3CBF');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).createFilter();
    sh.setColumnWidth(COL['Timestamp'], 150);
    sh.setColumnWidth(COL['Session ID'], 240);
    sh.setColumnWidth(COL['Name'], 170);
    sh.setColumnWidth(COL['Email'], 220);
    sh.setColumnWidth(COL['Mobile'], 120);
  }
  return sh;
}

/** Linear scan of the Session ID column. Fine to ~50k rows; see README. */
function findRowBySession(sh, sessionId) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, COL['Session ID'], last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {      // newest first
    if (String(ids[i][0]) === sessionId) return i + 2;
  }
  return 0;
}

function writeRow(r) {
  var sh = getSheet();
  var row = findRowBySession(sh, r.sessionId);

  var values = [
    new Date(), r.sessionId, r.name, r.email, r.mobile, r.consent,
    r.dims.Clarity, r.dims.Control, r.dims.Coordination, r.dims.Continuity, r.dims.Legacy,
    r.total, r.band, r.stage, r.completedAt, r.source
  ];

  if (row === 0) { sh.appendRow(values); return; }

  // Never let a late 'lead' ping overwrite a completed row.
  if (r.stage === 'lead') return;

  // Update in place, preserving the original Timestamp.
  sh.getRange(row, COL['Name'], 1, HEADERS.length - COL['Name'] + 1)
    .setValues([values.slice(COL['Name'] - 1)]);
}

/* ------------------------------------------------------------------ utility */

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run once from the editor to confirm the spreadsheet, headers, upsert and
 * lock all work before pointing the live page at this deployment.
 */
function selfTest() {
  var id = 'selftest-' + Date.now();

  var lead = validate({
    stage: 'lead', sessionId: id, name: 'Self Test',
    email: 'selftest@example.com', mobile: '9876543210', consent: true, source: 'selftest'
  });
  if (!lead.ok) throw new Error('Lead validation failed: ' + lead.error);
  writeRow(lead.record);

  var done = validate({
    stage: 'complete', sessionId: id, name: 'Self Test',
    email: 'selftest@example.com', mobile: '9876543210', consent: true,
    total: 14, band: 'Partially Structured', source: 'selftest',
    answers: [
      { dimension: 'Clarity',      key: 'B', score: 3 },
      { dimension: 'Control',      key: 'C', score: 2 },
      { dimension: 'Coordination', key: 'A', score: 4 },
      { dimension: 'Continuity',   key: 'C', score: 2 },
      { dimension: 'Legacy',       key: 'B', score: 3 }
    ]
  });
  if (!done.ok) throw new Error('Complete validation failed: ' + done.error);
  writeRow(done.record);

  Logger.log('Self test wrote ONE upserted row (session ' + id + '). Delete it before going live.');
}
