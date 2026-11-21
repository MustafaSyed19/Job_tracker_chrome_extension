// content.js — runs on LinkedIn. Extracts the job you're viewing and tracks
// your applications automatically.
//
// Strategy: LinkedIn's class names are scrambled and change often, so this never
// uses them. It anchors on things that stay put: the URL, the tab title,
// the "About the job" heading, links to the job/company, and visible text.
//
// Test it: open a LinkedIn job, press F12, paste this whole file into the
// Console, then run:  await extractJob()

const WORKPLACE = /^(On-site|Hybrid|Remote)$/i;
const EMPLOYMENT = /^(Full-time|Part-time|Contract|Temporary|Internship|Volunteer|Other)$/i;
const SALARY_CHIP = /(\$|CA\$|US\$|CAD|USD)\s?\d|\d[\d,.]*\s?K?\s?(CAD|USD)?\s?\/\s?(yr|year|hr|hour)/i;
const SALARY_RANGE = /(?:CA|US)?\$\s?\d[\d,]*(?:\.\d+)?\s?K?\s?(?:-|–|to)\s?(?:CA|US)?\$?\s?\d[\d,]*(?:\.\d+)?\s?K?/i;

function clean(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// Job ID: /jobs/view/123/ pages, or ?currentJobId=123 on search results.
function getJobId(url = location.href) {
  const u = new URL(url);
  return u.searchParams.get('currentJobId') ||
         (u.pathname.match(/\/jobs\/view\/(\d+)/) || [])[1] || null;
}

// "About the job" is the most stable landmark on a job page.
function findAboutHeading() {
  return [...document.querySelectorAll('main *')]
    .find(e => e.children.length === 0 && clean(e.textContent) === 'About the job') || null;
}

// LinkedIn loads job details a moment after the page, so wait for the landmark.
async function waitForJob(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (findAboutHeading()) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

// The job details panel. On search results, the page also has a list of other
// jobs, so walk up from the heading to the smallest container that also holds a
// link to THIS job. If none is found, fall back to <main>.
function findDetailsRoot(heading, jobId) {
  const main = document.querySelector('main') || document.body;
  let el = heading;
  while (el && el !== main) {
    if (jobId && el.querySelector(`a[href*="/jobs/view/${jobId}"]`)) return el;
    el = el.parentElement;
  }
  return main;
}

// Job pages are titled "Job title | Company | LinkedIn" (sometimes with "(3) " in front).
function fromTabTitle() {
  const parts = document.title.replace(/^\(\d+\)\s*/, '').split(' | ').map(clean);
  return parts.length === 3 && parts[2] === 'LinkedIn'
    ? { title: parts[0], company: parts[1] }
    : {};
}

function titleFromLinks(root, jobId) {
  if (!jobId) return null;
  const texts = [...root.querySelectorAll(`a[href*="/jobs/view/${jobId}"]`)]
    .map(a => clean(a.innerText))
    .filter(t => t && t.length < 150);
  return texts[0] || null;
}

function companyFromLinks(root) {
  const link = [...root.querySelectorAll('a[href*="/company/"]')].find(a => clean(a.innerText));
  return link ? clean(link.innerText) : null;
}

// Lines of visible text above "About the job" (the job's header card).
function headerLines(root) {
  const text = root.innerText || '';
  const cut = text.indexOf('About the job');
  return (cut > 0 ? text.slice(0, cut) : text.slice(0, 2000))
    .split('\n').map(clean).filter(Boolean);
}

// Each small label in the header card ("Hybrid", "Full-time", "90K CAD/yr - 110K CAD/yr"),
// read one element at a time so side-by-side labels don't run together.
function headerLabels(root, heading) {
  return [...root.querySelectorAll('*')]
    .filter(e => e.children.length === 0 &&
      (!heading || (e.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)))
    .map(e => clean(e.textContent))
    .filter(Boolean);
}

// The line under the title looks like: "Toronto, ON · 1 week ago · 47 applicants"
function parseMetaLine(lines, title) {
  const start = lines.indexOf(title) + 1; // 0 if the title wasn't found
  const meta = lines.slice(start).find(l => l.includes(' · ')) || '';
  const parts = meta.split(' · ').map(clean);
  return {
    location: parts[0] || null,
    posted: parts.find(p => /\bago\b|reposted/i.test(p)) || null,
    applicants: parts.find(p => /applicant|clicked apply|people/i.test(p)) || null,
  };
}

function getApplyType(root) {
  const labels = [...root.querySelectorAll('button, a')]
    .map(e => clean(`${e.getAttribute('aria-label') || ''} ${e.innerText || ''}`));
  if (labels.some(l => /easy apply/i.test(l))) return 'easy_apply';
  if (labels.some(l => /apply on company website|^apply\b/i.test(l))) return 'external';
  return null;
}

function tidyDescription(text) {
  return text
    .replace(/^\s*About the job\s*/, '')
    .split(/\n\s*(?:…\s*more|Show more|Show less|About the company|Job search smarter with Premium)/)[0]
    .trim();
}

// Clicks the description's own "Show more" button (if any) so the full text loads.
async function expandDescription(heading, root) {
  let box = heading;
  while (box && box !== root && clean(box.innerText).length < 300) box = box.parentElement;
  if (!box) return;
  const more = [...box.querySelectorAll('button')]
    .find(b => /^(…\s*)?(show|see)?\s*more$/i.test(clean(b.innerText)));
  if (more) {
    more.click();
    await new Promise(r => setTimeout(r, 300));
  }
}

function getDescription(heading, root) {
  if (heading) {
    let box = heading;
    while (box && box !== root && clean(box.innerText).length < 300) box = box.parentElement;
    if (box && box !== root) return tidyDescription(box.innerText);
  }
  const text = root.innerText || '';
  const i = text.indexOf('About the job');
  return i >= 0 ? tidyDescription(text.slice(i)) : null;
}

// Main function: returns every field it can find (null for anything it can't).
async function extractJob(url = location.href) {
  await waitForJob();
  const jobId = getJobId(url);
  const heading = findAboutHeading();
  const root = findDetailsRoot(heading, jobId);
  await expandDescription(heading, root);

  const tab = fromTabTitle();
  const title = tab.title || titleFromLinks(root, jobId);
  const company = tab.company || companyFromLinks(root);
  const lines = headerLines(root);
  const labels = headerLabels(root, heading);
  const pick = re => labels.find(t => re.test(t) && t.length < 80) ||
                     lines.find(t => re.test(t) && t.length < 80) || null;
  const meta = parseMetaLine(lines, title);
  const description = getDescription(heading, root);
  const salaryInText = (description || '').match(SALARY_RANGE);

  return {
    jobId,
    url: jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : url,
    title,
    company,
    location: meta.location,
    workplaceType: pick(WORKPLACE),      // On-site / Hybrid / Remote
    employmentType: pick(EMPLOYMENT),    // Full-time / Contract / ...
    salary: pick(SALARY_CHIP) || (salaryInText ? clean(salaryInText[0]) : null),
    posted: meta.posted,
    applicants: meta.applicants,
    applyType: getApplyType(root),                                 // easy_apply / external
    alreadyApplied: [...labels, ...lines].some(t => /^Applied\b/i.test(t)),
    closed: /No longer accepting applications/i.test(root.innerText || ''),
    description,
    source: 'linkedin',
    extractedAt: new Date().toISOString(),
  };
}

// ======================================================================
// Talking to the rest of the extension
// ======================================================================
const hasExtensionApi = typeof chrome !== 'undefined' && !!chrome.runtime?.onMessage;

// Sends a message to background.js. Resolves null if the extension was reloaded
// (old content scripts lose their connection until the tab is refreshed).
function send(msg) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(msg, reply => resolve(chrome.runtime.lastError ? null : reply));
    } catch {
      resolve(null);
    }
  });
}

// The popup asks: chrome.tabs.sendMessage(tabId, { type: 'GET_JOB' })
if (hasExtensionApi) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'GET_JOB') return false;
    if (!getJobId()) {
      sendResponse({ jobId: null }); // not a job page: answer right away
      return false;
    }
    extractJob().then(sendResponse).catch(err => sendResponse({ error: String(err) }));
    return true; // keeps the message channel open for the async reply
  });
}

// ======================================================================
// 1. Easy Apply: save as "Applied" when LinkedIn confirms the application
// ======================================================================
const APPLIED_CONFIRMATION = /your application was sent|application sent/i;
let lastAutoAppliedId = null;
let checkQueued = false;

function checkForApplicationSent() {
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
  if (!dialogs.some(d => APPLIED_CONFIRMATION.test(d.innerText || ''))) return;
  const jobId = getJobId();
  if (!jobId || jobId === lastAutoAppliedId) return;
  lastAutoAppliedId = jobId;
  extractJob().then(job => send({ type: 'SAVE_JOB', job, status: 'Applied' }));
}

if (hasExtensionApi) {
  // LinkedIn changes the page constantly, so check at most twice a second.
  new MutationObserver(() => {
    if (checkQueued) return;
    checkQueued = true;
    setTimeout(() => { checkQueued = false; checkForApplicationSent(); }, 500);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

// ======================================================================
// 2. "Apply on company website": save as "Clicked apply", then ask on return
// ======================================================================
let pendingExternal = null;

function isExternalApply(el) {
  const label = clean(`${el.getAttribute('aria-label') || ''} ${el.innerText || ''}`);
  if (/easy apply/i.test(label)) return false;
  if (/apply on company website/i.test(label)) return true;
  // A plain "Apply" link that leaves LinkedIn (LinkedIn routes these through /safety/go/)
  return el.tagName === 'A' && /^apply$/i.test(clean(el.innerText)) &&
         (/\/safety\/go/.test(el.href) || !/linkedin\.com/.test(el.href));
}

if (hasExtensionApi) {
  document.addEventListener('click', async event => {
    const el = event.target.closest?.('a, button');
    if (!el || !isExternalApply(el)) return;
    const job = await extractJob();
    if (!job.jobId) return;
    pendingExternal = job;
    send({ type: 'SAVE_JOB', job, status: 'Clicked apply' });
  }, true);

  // The company site usually opens in a new tab; when you come back, ask.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pendingExternal) {
      const job = pendingExternal;
      pendingExternal = null;
      showAppliedPrompt(job);
    }
  });
}

// A small box in the corner of LinkedIn. Built inside a shadow root so
// LinkedIn's styles can't affect it (and it can't affect LinkedIn).
function showAppliedPrompt(job) {
  document.getElementById('jt-prompt-host')?.remove();
  const host = document.createElement('div');
  host.id = 'jt-prompt-host';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .box { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; width: 300px;
             background: #fff; color: #1d2226; border-radius: 10px; padding: 14px 16px;
             box-shadow: 0 6px 24px rgba(0,0,0,.18); font: 14px/1.4 system-ui, sans-serif; }
      p { margin: 0 0 10px; }
      .row { display: flex; gap: 8px; justify-content: flex-end; }
      button { font: inherit; border-radius: 6px; padding: 6px 12px; cursor: pointer;
               border: 1px solid #0a66c2; }
      .yes { background: #0a66c2; color: #fff; }
      .no { background: #fff; color: #0a66c2; }
    </style>
    <div class="box" role="dialog" aria-label="Job Tracker">
      <p></p>
      <div class="row"><button class="no">Not yet</button><button class="yes">Yes, I applied</button></div>
    </div>`;
  const where = job.company ? ` at ${job.company}` : '';
  shadow.querySelector('p').textContent = `Did you finish applying to ${job.title || 'this job'}${where}?`;
  shadow.querySelector('.yes').addEventListener('click', () => {
    send({ type: 'UPDATE_STATUS', jobId: job.jobId, status: 'Applied' });
    host.remove();
  });
  shadow.querySelector('.no').addEventListener('click', () => host.remove());
  document.body.appendChild(host);
}

// ======================================================================
// 3. Backup: if a saved job's page shows "Applied ...", mark it Applied
//    (catches anything the two checks above missed)
// ======================================================================
function pageShowsApplied() {
  const heading = findAboutHeading();
  if (!heading) return false;
  const root = findDetailsRoot(heading, getJobId());
  return [...headerLabels(root, heading), ...headerLines(root)].some(t => /^Applied\b/i.test(t));
}

if (hasExtensionApi) {
  // LinkedIn switches jobs without reloading the page, so watch the address.
  let lastUrl = '';
  setInterval(async () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const jobId = getJobId();
    if (!jobId) return;
    await waitForJob();
    if (jobId === getJobId() && pageShowsApplied()) send({ type: 'MARK_APPLIED_IF_SAVED', jobId });
  }, 1000);
}
