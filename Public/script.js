const authStatus = document.getElementById('authStatus');
const signinBtn = document.getElementById('signinBtn');
const logoutBtn = document.getElementById('logoutBtn');
const submitBtn = document.getElementById('submitBtn');
const jobsEl = document.getElementById('jobs');
const queueInfo = document.getElementById('queueInfo');
const redirectUriEl = document.getElementById('redirectUri');
const appMessage = document.getElementById('appMessage');

signinBtn.addEventListener('click', () => {
  window.location.href = '/auth/google';
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  showMessage('Logged out.', 'ok');
  checkAuth();
  renderJobs();
});

submitBtn.addEventListener('click', startUpload);

function showMessage(message, type = 'neutral') {
  appMessage.textContent = message;
  appMessage.className = `badge msg-${type}`;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

async function loadConfig() {
  const data = await fetchJson('/api/config');
  queueInfo.textContent = `Max parallel: ${data.maxConcurrentUploads} | Max bulk per request: ${data.maxBulkItems}`;
  redirectUriEl.textContent = `OAuth Redirect URI: ${data.redirectUri}`;
}

async function checkAuth() {
  const { authenticated } = await fetchJson('/api/auth/status');
  authStatus.textContent = authenticated ? 'Signed in' : 'Not signed in';
  authStatus.className = `badge ${authenticated ? 'msg-ok' : 'msg-bad'}`;
}

async function startUpload() {
  try {
    const rawUrls = document.getElementById('urlList').value;
    const urls = rawUrls
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);

    if (!urls.length) {
      throw new Error('Add at least one URL.');
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Queueing...';

    const titlePrefix = document.getElementById('titlePrefix').value.trim() || 'Bulk Upload';
    const description = document.getElementById('description').value.trim();
    const privacyStatus = document.getElementById('privacyStatus').value;
    const tags = document
      .getElementById('tags')
      .value.split(',')
      .map((v) => v.trim())
      .filter(Boolean);

    const items = urls.map((sourceUrl, index) => ({
      sourceUrl,
      title: `${titlePrefix} ${index + 1}`,
      description,
      privacyStatus,
      tags
    }));

    const result = await fetchJson('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });

    showMessage(`Queued ${result.jobIds.length} upload(s).`, 'ok');
    renderJobs();
  } catch (error) {
    showMessage(error.message, 'bad');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Start Bulk Upload';
  }
}

function renderJobCard(job) {
  const link = job.videoUrl ? `<a href="${job.videoUrl}" target="_blank" rel="noreferrer">Open video</a>` : '';
  return `
    <article class="job">
      <div><strong>${job.title || 'Untitled'}</strong></div>
      <div class="hint">${job.sourceUrl}</div>
      <div class="status-${job.status}">Status: ${job.status}</div>
      <div>${job.message || ''}</div>
      ${link}
    </article>
  `;
}

async function renderJobs() {
  try {
    const data = await fetchJson('/api/jobs');
    jobsEl.innerHTML = data.jobs.length
      ? data.jobs.map(renderJobCard).join('')
      : '<p class="hint">No jobs yet.</p>';
  } catch {
    jobsEl.innerHTML = '<p class="hint">Sign in to see jobs.</p>';
  }
}

async function init() {
  await loadConfig();
  await checkAuth();
  await renderJobs();

  const params = new URLSearchParams(window.location.search);
  if (params.get('auth') === 'error') {
    showMessage(`Google auth failed: ${params.get('message') || 'unknown error'}`, 'bad');
  } else if (params.get('auth') === 'success') {
    showMessage('Google sign-in successful.', 'ok');
  } else {
    showMessage('Ready.', 'neutral');
  }

  setInterval(renderJobs, 4000);
}

init();

