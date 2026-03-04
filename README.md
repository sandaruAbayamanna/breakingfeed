# BreakingFeed PRO — Netlify Deploy Guide

## 📁 Folder Structure
```
breakingfeed/
├── index.html                        ← Your frontend
├── netlify.toml                      ← Netlify config (routes API calls)
└── netlify/
    └── functions/
        ├── news-everything.js        ← Proxies NewsAPI /everything
        ├── news-top-headlines.js     ← Proxies NewsAPI /top-headlines
        └── fb-post.js                ← Proxies Facebook Graph API
```

## 🚀 Deploy to Netlify (3 steps)

### Step 1 — Zip the folder
Select ALL files inside the `breakingfeed` folder and compress to a ZIP.
Make sure `netlify.toml` is at the ROOT of the zip (not inside a subfolder).

### Step 2 — Deploy on Netlify
1. Go to https://app.netlify.com
2. Sign up / log in (free)
3. Click **"Add new site"** → **"Deploy manually"**
4. Drag and drop your ZIP file onto the upload area
5. Wait ~30 seconds — you'll get a live URL like `https://amazing-name-123.netlify.app`

### Step 3 — Open and use
Open your Netlify URL, enter your:
- **NewsAPI.org key** (free at https://newsapi.org/register)
- **Facebook Page Access Token** (from https://developers.facebook.com)
- **Facebook Page ID**

Click **FETCH NEWS NOW** — done! 🎉

## ✅ What the functions do
The 3 files in `netlify/functions/` are serverless proxies.
They forward your API requests server-side, bypassing the NewsAPI CORS restriction.
No server to maintain — Netlify runs them automatically on demand.
