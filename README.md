# Job Tracker

A Chrome extension that tracks your LinkedIn job applications automatically and flags requirements that might rule you out before you apply.

## Features

- **Auto-saves when you apply.** Submitting through Easy Apply saves the job as **Applied**.
- **Tracks external applications.** Clicking "Apply on company website" saves the job as **Clicked apply**. When you come back to LinkedIn, it asks whether you finished, and **Yes** marks it Applied.
- **Manual save** for jobs you want to apply to later.
- **Status tracking:** Saved → Clicked apply → Applied → Interview → Offer / Rejected.
- **Red flags** scanned from the description: US citizenship, security clearance, French required, enrollment or graduation-date requirements, no visa sponsorship, and 3+ years of experience.
- **Saves the full job description**, so you have it even after the posting closes.
- **Export to CSV**, which opens in Excel or Google Sheets.

## Install (developer mode)

1. Go to `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this folder.
3. Pin the extension, open a LinkedIn job, and click the icon.

After changing any file, click the reload icon on the extension's card, then **refresh your LinkedIn tab**.

## How it works

| File | Role |
|---|---|
| `manifest.json` | Declares the files, permissions, and that the content script runs on linkedin.com |
| `content.js` | Runs inside LinkedIn: reads the job you're viewing and detects applications |
| `background.js` | Service worker that owns storage: merges saves, applies status rules, computes red flags |
| `popup.html/css/js` | The window behind the extension icon: current job, saved list, status, export |

Job details are read from the page you're viewing, anchored on stable landmarks (the URL, the tab title, the "About the job" heading, links) rather than LinkedIn's generated class names. Nothing is fetched in the background, and no LinkedIn APIs are called.

Automatic updates only move a job forward (for example, Saved → Applied), so revisiting a page never undoes a status you set yourself.

## Debugging

- **Popup:** right-click the popup, then **Inspect**.
- **Background:** on `chrome://extensions`, click **service worker** on the extension's card.
- **Content script:** open DevTools on the LinkedIn tab. In the Console's context dropdown, choose **Job Tracker** to run `await extractJob()`.

## Known limits

- Detection depends on LinkedIn's wording ("Your application was sent", "Applied", "About the job"). If LinkedIn changes it, update the patterns at the top of each section in `content.js`.
- If a company site opens in the **same** tab, the "Did you finish?" prompt can't appear. Update the status from the popup instead.
- Storage is local to this browser (`chrome.storage.local`).
