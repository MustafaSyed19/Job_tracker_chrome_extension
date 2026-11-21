// background.js — the extension's coordinator. It owns all writes to storage,
// so the popup and the content script never overwrite each other's changes.
//
// Messages it handles (send with chrome.runtime.sendMessage):
//   { type: 'SAVE_JOB', job, status }        save or update a job
//   { type: 'UPDATE_STATUS', jobId, status } change a job's status (from the popup)
//   { type: 'MARK_APPLIED_IF_SAVED', jobId } upgrade a saved job when LinkedIn shows "Applied"
//   { type: 'DELETE_JOB', jobId }            remove a job

const STATUSES = ['Saved', 'Clicked apply', 'Applied', 'Interview', 'Offer', 'Rejected'];
const rank = status => STATUSES.indexOf(status);

// ---------- Red flags ----------
// Phrases in a description that often rule a candidate out. Tweak these freely.
const FLAG_RULES = [
  ['US citizens only', /\b(U\.?S\.?|United States) citizen(ship)?\b|green card holder/i],
  ['Security clearance', /security clearance|\bTS\/SCI\b|top secret|polygraph/i],
  ['French required', /\b(bilingual|french)\b[^.\n]{0,40}\b(required|essential|mandatory|must)\b|\b(required|must)\b[^.\n]{0,40}\b(bilingual|french)\b/i],
  ['Must be enrolled in school', /currently enrolled|returning to (school|university|your studies)/i],
  ['Graduation date requirement', /graduat(ing|ion)[^.\n]{0,60}\b20\d\d\b/i],
  ['No visa sponsorship', /(unable|not able|cannot|can't|will not|won't|do not|does not)\s+(to\s+)?(offer|provide)?\s*(visa\s+)?sponsor/i],
];

// Highest "N years of experience" the posting asks for (ignores company-history numbers).
function yearsRequired(text) {
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*years?['’]?\s*(?:of\s+)?(?:[\w/+#.-]+\s+){0,4}experience/gi;
  let max = 0;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]);
    if (n <= 15) max = Math.max(max, n);
  }
  return max;
}

function redFlags(description) {
  const text = description || '';
  const flags = FLAG_RULES.filter(([, re]) => re.test(text)).map(([label]) => label);
  const years = yearsRequired(text);
  if (years >= 3) flags.push(`Asks for ${years}+ years`);
  return flags;
}

// ---------- Storage ----------
async function getJobs() {
  const { jobs = {} } = await chrome.storage.local.get('jobs');
  return jobs;
}

async function putJobs(jobs) {
  await chrome.storage.local.set({ jobs });
}

// Runs storage updates one at a time, so two quick saves can't overwrite each other.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// Automatic saves only move a job FORWARD (Saved → Clicked apply → Applied...),
// so a later page visit never undoes a status you set yourself.
async function saveJob(job, status = 'Saved') {
  if (!job?.jobId) throw new Error('Job has no ID');
  const jobs = await getJobs();
  const prev = jobs[job.jobId];
  const now = new Date().toISOString();

  const fresh = Object.fromEntries(Object.entries(job).filter(([, v]) => v !== null && v !== ''));
  const merged = { ...prev, ...fresh };
  merged.savedAt = prev?.savedAt || now;
  merged.status = !prev || rank(status) > rank(prev.status) ? status : prev.status;
  if (merged.status === 'Applied' && !merged.appliedAt) merged.appliedAt = now;
  merged.flags = redFlags(merged.description);
  merged.updatedAt = now;

  jobs[job.jobId] = merged;
  await putJobs(jobs);
  return { job: merged };
}

async function updateStatus(jobId, status) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown status: ${status}`);
  const jobs = await getJobs();
  const job = jobs[jobId];
  if (!job) throw new Error('Job not found');
  job.status = status;
  if (status === 'Applied' && !job.appliedAt) job.appliedAt = new Date().toISOString();
  job.updatedAt = new Date().toISOString();
  await putJobs(jobs);
  return { job };
}

async function markAppliedIfSaved(jobId) {
  const jobs = await getJobs();
  const job = jobs[jobId];
  if (!job || rank(job.status) >= rank('Applied')) return { changed: false };
  return { changed: true, ...(await updateStatus(jobId, 'Applied')) };
}

async function deleteJob(jobId) {
  const jobs = await getJobs();
  delete jobs[jobId];
  await putJobs(jobs);
  return {};
}

// ---------- Messages ----------
const handlers = {
  SAVE_JOB: msg => saveJob(msg.job, msg.status),
  UPDATE_STATUS: msg => updateStatus(msg.jobId, msg.status),
  MARK_APPLIED_IF_SAVED: msg => markAppliedIfSaved(msg.jobId),
  DELETE_JOB: msg => deleteJob(msg.jobId),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false; // not for us (e.g. GET_JOB goes to the content script)
  serial(() => handler(msg))
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(err => sendResponse({ ok: false, error: String(err.message || err) }));
  return true; // reply comes later
});
