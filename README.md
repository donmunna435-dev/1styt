# YouTube Upload Automation (Drive + Telegram Links)

Deploy-ready Node.js app for bulk uploading large videos to YouTube from:
- Google Drive share links
- Telegram file-to-link bot URLs (direct downloadable links)
- Any direct HTTP/HTTPS file URL

## Features
- Google OAuth sign-in for YouTube upload scope
- Bulk upload queue (paste multiple links)
- Large file support with stream download + upload
- Parallel uploader workers (`MAX_CONCURRENT_UPLOADS`)
- Per-request bulk limit (`MAX_BULK_ITEMS`)
- Smooth single-page UI with live job status

## OAuth URI you must add in Google Cloud Console
Use this exact route pattern:

- Local: `http://localhost:3000/auth/google/callback`
- Render: `https://<your-render-service>.onrender.com/auth/google/callback`

If this URI does not match exactly, sign-in will fail with `redirect_uri_mismatch`.

## 1) Google Cloud setup (real account)
1. Open Google Cloud Console → APIs & Services.
2. Enable **YouTube Data API v3**.
3. Create OAuth Client ID → **Web Application**.
4. Add Authorized redirect URI:
   - `http://localhost:3000/auth/google/callback` (for local testing)
   - `https://<your-render-service>.onrender.com/auth/google/callback` (for production)
5. Add Authorized JavaScript origin (recommended):
   - `http://localhost:3000`
   - `https://<your-render-service>.onrender.com`
6. Put client ID/secret into `.env` (local) or Render env vars.

## 2) Local run
```bash
npm install
cp .env.example .env
# edit .env with Google credentials and BASE_URL
npm start
```
Open `http://localhost:3000`.

## 3) Deploy on Render (GitHub)
1. Push this repo to GitHub.
2. In Render, create new **Blueprint** (recommended) from this repo.
3. Set env vars:
   - `BASE_URL=https://<your-render-service>.onrender.com`
   - `GOOGLE_CLIENT_ID=...`
   - `GOOGLE_CLIENT_SECRET=...`
   - `SESSION_SECRET=...`
4. Redeploy.
5. Confirm Google Cloud redirect URI includes:
   - `https://<your-render-service>.onrender.com/auth/google/callback`

## 4) Usage
1. Click **Sign in with YouTube**.
2. Paste one source URL per line.
3. Fill metadata defaults.
4. Click **Start Bulk Upload**.
5. Monitor status in Jobs panel.

## Notes
- For real accounts, keep app in **Testing** mode or publish OAuth consent screen before broad usage.
- Drive files must be accessible from the server.
- Telegram links must be direct downloadable file links.
- For very large files, use a Render plan with enough disk/memory.

