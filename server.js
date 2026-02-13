require('dotenv').config();

const express = require('express');
const session = require('express-session');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const { pipeline } = require('stream/promises');
const axios = require('axios');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me';
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const MAX_CONCURRENT_UPLOADS = Number(process.env.MAX_CONCURRENT_UPLOADS || 2);
const MAX_BULK_ITEMS = Number(process.env.MAX_BULK_ITEMS || 25);

app.set('trust proxy', 1);

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube'
];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment variables.');
}

app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);
app.use(express.static(path.join(__dirname, 'public')));

const jobs = new Map();
let running = 0;
const queue = [];

function resolveRedirectUri(req) {
  const baseFromEnv = BASE_URL;
  const baseFromRequest = `${req.protocol}://${req.get('host')}`;
  const base = process.env.BASE_URL ? baseFromEnv : baseFromRequest;
  return `${base}/auth/google/callback`;
}

function createOAuthClient(req) {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, resolveRedirectUri(req));
}

function requireAuth(req, res, next) {
  if (!req.session.tokens) {
    return res.status(401).json({ error: 'Not authenticated. Sign in with Google first.' });
  }
  return next();
}

function convertToDirectDownload(url) {
  if (url.includes('drive.google.com')) {
    const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
    if (fileIdMatch?.[1]) {
      return `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
    }
  }
  return url;
}

function validateUploadItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return 'items must be a non-empty array.';
  }
  if (items.length > MAX_BULK_ITEMS) {
    return `You can upload up to ${MAX_BULK_ITEMS} items in one request.`;
  }

  for (const item of items) {
    if (!item.sourceUrl || typeof item.sourceUrl !== 'string') {
      return 'Each item needs a valid sourceUrl.';
    }
    if (!/^https?:\/\//i.test(item.sourceUrl.trim())) {
      return `Invalid URL: ${item.sourceUrl}`;
    }
  }

  return null;
}

async function fetchRemoteFile(sourceUrl, destinationPath) {
  const normalized = convertToDirectDownload(sourceUrl);
  const response = await axios({
    method: 'GET',
    url: normalized,
    responseType: 'stream',
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 0,
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });

  await pipeline(response.data, fs.createWriteStream(destinationPath));
  const disposition = response.headers['content-disposition'] || '';
  const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const filename = decodeURIComponent(filenameMatch?.[1] || filenameMatch?.[2] || path.basename(destinationPath));
  return { filename };
}

async function processJob(job) {
  running += 1;
  job.status = 'running';
  job.startedAt = new Date().toISOString();

  const localPath = path.join(__dirname, 'tmp', `${job.id}.bin`);

  try {
    job.message = 'Downloading source file...';
    const { filename } = await fetchRemoteFile(job.sourceUrl, localPath);

    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, job.redirectUri);
    oauth2Client.setCredentials(job.tokens);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    job.message = 'Uploading to YouTube...';

    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: job.title || filename || `Upload ${job.id}`,
          description: job.description || '',
          tags: job.tags || []
        },
        status: {
          privacyStatus: job.privacyStatus || 'private'
        }
      },
      media: {
        body: fs.createReadStream(localPath)
      }
    });

    job.status = 'done';
    job.message = 'Upload completed successfully.';
    job.videoId = response.data.id;
    job.videoUrl = `https://www.youtube.com/watch?v=${response.data.id}`;
    job.completedAt = new Date().toISOString();
  } catch (error) {
    job.status = 'failed';
    job.message = error?.response?.data?.error?.message || error.message;
    job.completedAt = new Date().toISOString();
  } finally {
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
    running -= 1;
    drainQueue();
  }
}

function drainQueue() {
  while (running < MAX_CONCURRENT_UPLOADS && queue.length > 0) {
    const nextJob = queue.shift();
    processJob(nextJob);
  }
}

app.get('/api/config', (req, res) => {
  res.json({
    redirectUri: resolveRedirectUri(req),
    maxConcurrentUploads: MAX_CONCURRENT_UPLOADS,
    maxBulkItems: MAX_BULK_ITEMS
  });
});

app.get('/auth/google', (req, res) => {
  const oauth2Client = createOAuthClient(req);
  const state = uuidv4();
  req.session.oauthState = state;

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: OAUTH_SCOPES,
    prompt: 'consent',
    state
  });

  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    if (req.query.state !== req.session.oauthState) {
      return res.status(400).send('Invalid OAuth state. Please retry sign-in.');
    }

    const oauth2Client = createOAuthClient(req);
    const { tokens } = await oauth2Client.getToken(req.query.code);

    if (!tokens.refresh_token && req.session.tokens?.refresh_token) {
      tokens.refresh_token = req.session.tokens.refresh_token;
    }

    req.session.tokens = tokens;
    req.session.oauthState = null;

    return res.redirect('/?auth=success');
  } catch (error) {
    return res.redirect(`/?auth=error&message=${encodeURIComponent(error.message)}`);
  }
});

app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: Boolean(req.session.tokens) });
});

app.post('/api/upload', requireAuth, (req, res) => {
  const { items } = req.body;
  const errorMessage = validateUploadItems(items);

  if (errorMessage) {
    return res.status(400).json({ error: errorMessage });
  }

  const redirectUri = resolveRedirectUri(req);

  const jobIds = items.map((item) => {
    const id = uuidv4();
    const job = {
      id,
      status: 'queued',
      message: 'Queued for processing',
      sourceUrl: item.sourceUrl,
      title: item.title,
      description: item.description,
      tags: item.tags,
      privacyStatus: item.privacyStatus,
      createdAt: new Date().toISOString(),
      tokens: req.session.tokens,
      redirectUri
    };

    jobs.set(id, job);
    queue.push(job);
    return id;
  });

  drainQueue();
  return res.json({ jobIds });
});

app.get('/api/jobs', requireAuth, (req, res) => {
  const allJobs = Array.from(jobs.values()).map((job) => ({
    id: job.id,
    status: job.status,
    message: job.message,
    sourceUrl: job.sourceUrl,
    title: job.title,
    videoId: job.videoId,
    videoUrl: job.videoUrl,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt
  }));

  res.json({ jobs: allJobs.slice(-100).reverse() });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on ${BASE_URL}`);
  console.log(`Use this redirect URI in Google Cloud Console: ${BASE_URL}/auth/google/callback`);
});

