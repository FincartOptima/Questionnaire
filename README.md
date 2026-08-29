# Wealth Systems Audit

A five-question structural audit of how a client's wealth is organised. Single
static page, scores in the browser, writes every response to Google Sheets.

**Live:** https://fincartoptima.github.io/Questionnaire/ *(after step 3 below)*

```
index.html                 the entire front end — logo embedded, no build step
apps-script/Code.gs        Google Apps Script that writes to the sheet
qr/make_qr.py              regenerates the QR code for any URL
qr/audit-qr.svg            vector QR for print
qr/audit-qr.png            raster QR for slides, email, WhatsApp
qr/audit-qr-card.png       print card with logo and call to action
assets/                    source logo
.nojekyll                  tells GitHub Pages to serve files as-is
```

---

## Setup order

The three steps depend on each other. Do them in this order.

1. **Google Sheet + Apps Script** → gives you the `/exec` endpoint
2. **Paste the endpoint into `index.html`** → the page can now save
3. **Push and enable Pages** → gives you the public link

If you push first, the live page will collect nothing. It will look like it
works — the audit runs, the score appears — and every response will be
discarded. The save indicator under the result is the tell: it stays hidden
when no endpoint is configured.

---

## 1. Google Sheets — full walkthrough

### 1.1 Open the Apps Script editor

Open your sheet:
`https://docs.google.com/spreadsheets/d/10W1cmetKAcu2o8Nq6RjLwibQT8SL8ZsY6PM4eFn6JCY/edit`

**Extensions → Apps Script.** A new tab opens with a file called `Code.gs`
containing an empty `myFunction()`.

### 1.2 Paste the script

Select everything in that editor and delete it. Paste the entire contents of
`apps-script/Code.gs` from this repo. Click the save icon.

The spreadsheet ID is already hardcoded at the top, so the script writes to
your sheet regardless of where it lives.

### 1.3 Set the shared secret

Line 27:

```js
var SHARED_SECRET = 'CHANGE_ME_BEFORE_DEPLOY';
```

Replace with a long random string — 30+ characters, no spaces. Generate one
however you like; a password manager is fine. **Write it down.** You need the
identical string in `index.html` in step 2. Save again.

### 1.4 Run the self-test

In the toolbar, the function dropdown will say `doPost`. Change it to
**`selfTest`** and click **Run**.

Google will show *"Authorization required"* → **Review permissions** → pick
your account → you will then see **"Google hasn't verified this app"**. This is
expected for any private script. Click **Advanced** → **Go to (project name)
(unsafe)** → **Allow**. You are authorising your own script to write to your
own sheet.

Now go back to the spreadsheet and check:

- A tab named **Responses** exists, with a bold blue header row.
- There is **exactly one** data row, named "Self Test", with `Stage = complete`
  and `Total = 14`.

**One row, not two, is the thing to verify.** The script writes a `lead` row
and then updates it in place. Two rows means the upsert is broken — stop and
re-check that you pasted the whole file.

**Delete that test row** before going live.

### 1.5 Deploy as a web app

**Deploy → New deployment.** Click the gear next to "Select type" and choose
**Web app**. Then:

| Field | Value |
|---|---|
| Description | `audit v1` (anything) |
| Execute as | **Me** |
| Who has access | **Anyone** |

**Deploy.** Copy the **Web app URL**. It looks like:

```
https://script.google.com/macros/s/AKfycbx.................../exec
```

That `/exec` URL is the endpoint. **The `docs.google.com/spreadsheets/...` link
is not an endpoint** — a browser cannot POST to it. This is the single most
common way this setup gets broken.

"Who has access: Anyone" means anyone who *knows the URL* can POST to it. It
does not expose your sheet, and it does not let anyone read the data. It is
required — visitors are not signed into your Google account. See §6 for what
this does and does not protect.

### 1.6 Later changes

Every time you edit `Code.gs` you must **Deploy → Manage deployments → pencil
icon → Version: New version → Deploy**. Editing the code alone changes nothing
live. If you instead create a *new* deployment you get a *new URL*, and the old
one keeps quietly serving the old code.

---

## 2. Point the page at the endpoint

Open `index.html`, find `CONFIG` near the top of the `<script>` block:

```js
const CONFIG = Object.freeze({
  endpoint: "",                            // ← the /exec URL from step 1.5
  sharedSecret: "CHANGE_ME_BEFORE_DEPLOY", // ← the exact string from step 1.3
  brandName: "Fincart",
  privacyUrl: "",                          // ← your privacy page (see §7)
  emailRequired: true,                     // ← false makes email optional
  requestTimeoutMs: 12000,
  maxRetries: 3,
  minGateSeconds: 2
});
```

The two secrets must match **character for character**. A trailing space is the
usual culprit; the symptom is every submission failing with "Unauthorised."

---

## 3. Push to GitHub

### Option A — web upload (no git needed)

1. Go to https://github.com/FincartOptima/Questionnaire
2. **Add file → Upload files**
3. Drag in `index.html`, `.nojekyll`, `README.md`, and the `apps-script`,
   `qr` and `assets` folders
4. Commit to `main`

`.nojekyll` is a zero-byte file. If it won't drag, create it with **Add file →
Create new file**, name it `.nojekyll`, leave it empty, commit.

### Option B — git

```bash
cd path/to/the/unzipped/folder
git init
git branch -M main
git remote add origin https://github.com/FincartOptima/Questionnaire.git
git add .
git commit -m "Wealth Systems Audit: questionnaire, Apps Script receiver, QR"
git push -u origin main
```

If the repo already has commits, `git pull --rebase origin main` first.

### Enable Pages

**Settings → Pages → Build and deployment**
- Source: **Deploy from a branch**
- Branch: **`main`**, folder: **`/ (root)`**
- Save

Live in about a minute at:

```
https://fincartoptima.github.io/Questionnaire/
```

`index.html` must sit at the **repo root**, not in a subfolder, or that URL
404s.

---

## 4. The QR code

`qr/audit-qr.svg` and the other two files in `qr/` already encode
`https://fincartoptima.github.io/Questionnaire/`. Every one was decoded back
with OpenCV and byte-matched before being committed.

**If you attach a custom domain** (e.g. `audit.fincart.com`), the URL changes
and these become wrong. Regenerate:

```bash
pip install segno pillow opencv-python-headless
python qr/make_qr.py https://audit.fincart.com/
```

The script refuses the two mistakes people actually make — passing the
spreadsheet link, or passing the `/exec` endpoint — and fails loudly rather
than emitting a QR that scans somewhere wrong.

Error correction is level H (~30% recoverable), so it survives creasing and
partial coverage. Print no smaller than **3 cm** square, and **scan the
physical printed piece with a real phone at real distance** before ordering a
run. A code that reads on a monitor and fails on matte card stock at 1.5 metres
is a common and expensive discovery.

---

## 5. Testing it end to end

1. Open the live URL on your phone.
2. Complete the audit with a real name, email and mobile.
3. Watch the line under the result. **"Responses saved"** means it worked.
   **"Not saved — ..."** names the failure.
4. Check the sheet: one row, `Stage = complete`, scores in all five dimension
   columns, `Total` matching what the page showed.

Then test the drop-off path: fill the gate, answer one question, close the tab.
A row should appear with `Stage = lead` and empty score columns. That is
deliberate — an abandoned audit is still a lead. `Stage` is what separates
finishers from drop-offs, and that ratio is the most useful number this page
will give you.

### If nothing arrives

| Symptom | Cause |
|---|---|
| "Not saved — Unauthorised." | The two secrets differ. Check for a trailing space. |
| "Not saved — Network unavailable." | `endpoint` is wrong, or you used the spreadsheet URL. |
| "Not saved — HTTP 401/403" | Deployment access is not set to **Anyone**. |
| **"Not saved — HTTP 404"** | **The deployment doesn't exist at that URL.** See below — this is the most common failure and it is silent to a site visitor. |
| Nothing at all under the result | `endpoint` is still `""`. |
| Old behaviour after editing `Code.gs` | You didn't deploy a **new version**. See §1.6. |

**A 404 on the `/exec` URL** means Google's own server has no deployment at
that address — the request reached Google fine and Google said "not found."
In order of likelihood:

1. **A character was dropped or changed when the URL was copied.** The ID is
   72 characters; one wrong character anywhere produces a URL that looks
   completely normal and resolves to nothing. Re-copy it directly from
   **Deploy → Manage deployments** rather than retyping it.
2. **The deployment was deleted**, or the underlying script project was
   deleted, after the URL was issued.
3. **It's a test-deployment URL**, not a real one. Apps Script's "Test
   deployments" flow (the one that runs from inside the editor while you're
   developing) issues a different kind of URL that is not meant for
   production traffic. Use **Deploy → New deployment**, not "Test deployments."

**To confirm it yourself:** paste the URL straight into a normal browser tab.
A working deployment returns a small JSON reply —
`{"ok":true,"service":"wealth-systems-audit","note":"POST only."}` — because
`doGet()` answers that way deliberately, precisely so this is checkable with
one click. A blank Google 404 page confirms the deployment problem rather than
a copy-paste issue on this end.

The retry logic was hardened alongside this: a definitive rejection (bad
secret, malformed payload, a 404) now fails after a single attempt instead of
retrying four times per save. Retrying a deterministic failure doesn't help it
succeed — it only delays the visitor's feedback and spends your Apps Script
quota for nothing. The one case still worth retrying — `"Sheet busy. Retry."`,
which is genuine lock contention — still gets its retries.

---

## 6. Security — the honest version

`sharedSecret` sits in public JavaScript. Anyone who opens View Source has it.
It stops opportunistic requests to a discovered endpoint and nothing else. The
honeypot field and the two-second timing check stop naive bots and nothing
sophisticated.

**If this page gets real traffic, you will get junk rows.** The fix is
Cloudflare Turnstile — free, invisible for most users, about 20 lines: add the
widget to the gate, post the token, verify it in `doPost` before writing. Do it
before you run paid traffic at this page, not after.

The score is computed in the browser, so a determined person can post any total
they like. `Code.gs` re-derives the total from the five answers and rejects a
mismatch, rejects duplicate dimensions, and rejects out-of-range scores — that
catches careless tampering, not deliberate forgery. Fine for a lead magnet; do
not treat the sheet as a clean analytical dataset without that caveat attached.

Values are written with a leading `'` so a submitted string starting `=`, `+`,
`-` or `@` cannot execute as a formula when the sheet is opened or exported.
That is a real attack (CSV injection), not a theoretical one.

---

## 7. Compliance

Under the **DPDP Act 2023**, consent must be specific, informed and
withdrawable, and you need a stated purpose. The consent checkbox is required
and its state is stored. Still missing on your side:

- A privacy notice at `CONFIG.privacyUrl` — the consent line currently links
  to nothing.
- A route to withdraw consent and have the row deleted.
- A retention period. Leads sitting in a sheet forever is not defensible.

Not legal advice. Have whoever handles Fincart's compliance read the consent
wording before this reaches a public audience.

---

## 8. What gets stored

One row per session in the `Responses` tab:

| Timestamp | Session ID | Name | Email | Mobile | Consent | Clarity | Control | Coordination | Continuity | Legacy | Total | Band | Stage | Completed At | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Dimension columns hold the chosen option and its score, e.g. `B (3)`.

A late `lead` ping can never overwrite a completed row. A `complete` arriving
with no matching lead row (network dropped mid-audit) is inserted rather than
lost.

---

## 9. Defects corrected from the source workbook

| # | Issue | Fix |
|---|---|---|
| 1 | Rows A41 and A42 both read "Score: 8-12" — Exposed and Uncharted mapped to the same range | Uncharted reassigned to **5–7** |
| 2 | Scores 5, 6, 7 had no band — a straight-D respondent (total 5) fell off the bottom | Now covered by Uncharted |
| 3 | "Well - Architectured" is not a word | Changed to **"Well-Architected"** |

Corrected bands tile 5–20 exactly: **5–7 / 8–12 / 13–17 / 18–20**.

`assertBandIntegrity()` runs on page load and **refuses to render** if `BANDS`
overlaps or leaves a gap, naming the offending score. Editing the numbers
wrongly produces a loud failure, not a silently wrong result.

---

## 10. Known limitations

- **No dedupe.** The same person can complete the audit repeatedly. Add a
  `COUNTIF` on Mobile, or handle it in `writeRow`.
- **Email is captured but not verified.** A typo'd address is silently useless.
- **`findRowBySession` is a linear scan** of the Session ID column — one
  `getValues()` call, not one API call per row. Fine to ~50,000 rows.
- **No browser storage.** A refresh mid-audit starts over, deliberately.
- **Apps Script quotas** bite before the code does: 20,000 URL fetches and 90
  minutes of execution per day on a free Google account.
- **Google Fonts is a third-party request.** Self-host the three families if
  your compliance posture requires it.
