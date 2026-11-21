// popup.js — the window that opens when you click the extension icon.
// Shows the job on the current tab (with a Save button) and your saved jobs.

const STATUSES = ['Saved', 'Clicked apply', 'Applied', 'Interview', 'Offer', 'Rejected'];
const $ = selector => document.querySelector(selector);

let currentJob = null; // the job on the active tab, if any

// Small helper to build elements safely (text always goes in as text, never HTML).
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(Boolean));
  return node;
}

async function getJobs() {
  const { jobs = {} } = await chrome.storage.local.get('jobs');
  return jobs;
}

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

function shortDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

function flagTags(flags = []) {
  return flags.map(f => el('span', { className: 'flag', textContent: f }));
}

function statusSelect(job) {
  const select = el('select', { title: 'Status' });
  for (const s of STATUSES) select.append(el('option', { value: s, textContent: s, selected: s === job.status }));
  select.addEventListener('change', () => send({ type: 'UPDATE_STATUS', jobId: job.jobId, status: select.value }));
  return select;
}

// ---------- The job on the current tab ----------
async function loadCurrentJob() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    currentJob = await chrome.tabs.sendMessage(tab.id, { type: 'GET_JOB' });
  } catch {
    currentJob = null; // no content script here: not LinkedIn, or the tab needs a refresh
  }
  return tab;
}

async function renderCurrent(tab) {
  const box = $('#current');
  box.replaceChildren();

  if (!currentJob?.jobId) {
    const onLinkedIn = tab?.url?.startsWith('https://www.linkedin.com/');
    box.append(el('p', {
      className: 'muted',
      textContent: onLinkedIn
        ? 'Open a job posting to save it. Just installed or reloaded the extension? Refresh this tab.'
        : 'Open a LinkedIn job posting to save it.',
    }));
    return;
  }

  const saved = (await getJobs())[currentJob.jobId];
  const sub = [currentJob.company, currentJob.location].filter(Boolean).join(' · ');

  box.append(
    el('div', { className: 'title', textContent: currentJob.title || 'Untitled job' }),
    el('div', { className: 'sub', textContent: sub }),
  );

  const row = el('div', { className: 'row' });
  if (saved) {
    row.append(el('span', { className: 'saved-note', textContent: `✓ In your list · ${saved.status}` }));
  } else {
    const save = el('button', { textContent: 'Save job' });
    save.addEventListener('click', async () => {
      save.disabled = true;
      const res = await send({ type: 'SAVE_JOB', job: currentJob, status: 'Saved' });
      if (!res?.ok) {
        save.disabled = false;
        save.textContent = 'Try again';
      }
    });
    row.append(save);
  }
  // Flags are computed when saving; show them for the saved copy.
  row.append(...flagTags(saved?.flags));
  box.append(row);
}

// ---------- Saved jobs ----------
async function renderList() {
  const jobs = Object.values(await getJobs())
    .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));

  const counts = {};
  for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1;
  $('#summary').textContent = STATUSES.filter(s => counts[s]).map(s => `${counts[s]} ${s.toLowerCase()}`).join(' · ');
  $('#empty').hidden = jobs.length > 0;

  $('#jobs').replaceChildren(...jobs.map(job => {
    const remove = el('button', { className: 'icon', textContent: '✕', title: 'Remove' });
    remove.addEventListener('click', () => {
      if (confirm(`Remove "${job.title}" from your list?`)) send({ type: 'DELETE_JOB', jobId: job.jobId });
    });

    const sub = [job.company, job.location, `saved ${shortDate(job.savedAt)}`].filter(Boolean).join(' · ');

    return el('li', { className: 'job' },
      el('div', { className: 'top' },
        el('a', { className: 'title', href: job.url, target: '_blank', textContent: job.title || 'Untitled job' }),
        remove,
      ),
      el('div', { className: 'sub', textContent: sub }),
      el('div', { className: 'row' }, statusSelect(job), ...flagTags(job.flags)),
    );
  }));
}

// ---------- Export to CSV (opens in Excel) ----------
// Cells starting with = + - @ get a leading apostrophe so Excel can't run them as
// formulas (job text comes from web pages, so treat it as untrusted).
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

async function exportCsv() {
  const jobs = Object.values(await getJobs())
    .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  const header = ['Date saved', 'Company', 'Title', 'Location', 'Work type', 'Employment type', 'Salary',
                  'Status', 'Date applied', 'Apply type', 'Red flags', 'Link', 'Description'];
  const rows = jobs.map(j => [
    shortDate(j.savedAt), j.company, j.title, j.location, j.workplaceType, j.employmentType, j.salary,
    j.status, shortDate(j.appliedAt), j.applyType, (j.flags || []).join('; '), j.url, j.description,
  ]);
  const csv = '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n'); // BOM so Excel reads UTF-8
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: `job-tracker-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Start ----------
$('#export').addEventListener('click', exportCsv);

// Re-draw whenever storage changes (a save from the page, a status change, a delete).
let activeTab = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.jobs) {
    renderList();
    renderCurrent(activeTab);
  }
});

(async () => {
  renderList();
  activeTab = await loadCurrentJob();
  renderCurrent(activeTab);
})();
