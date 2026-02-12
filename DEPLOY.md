# Deployment Guide — FB Marketplace Tool

## Architecture Overview

| Component | Where | Cost |
|---|---|---|
| Web UI (inventory, queue, dashboard) | Vercel | Free |
| Photo scraping + AI descriptions | Vercel | Free |
| Facebook auto-poster | Railway OR local PC | ~$5/mo or Free |

---

## Step 1: Push to GitHub

1. Create a new GitHub repository
2. Push this project to it:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/fb-marketplace-tool.git
   git push -u origin main
   ```

---

## Step 2: Deploy Web UI to Vercel (free)

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **"Import Project"** and select your repo
3. Add these **Environment Variables** in the Vercel dashboard:
   - `SUPABASE_URL` = your Supabase URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your service role key
   - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your anon key
   - `OPENAI_API_KEY` = your OpenAI key
4. Click **Deploy**
5. Your UI is now live at `https://your-app.vercel.app`

---

## Step 3: Run Supabase Migration

1. Go to your Supabase dashboard → SQL Editor
2. Paste the contents of `supabase-migration.sql`
3. Click **Run**

---

## Step 4: Set Up the Poster

### Option A: Railway (all web, no installs) ~$5/mo

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **"New Project"** → **"Deploy from GitHub Repo"**
3. Select your repo
4. In Railway settings:
   - Set the **Dockerfile path** to `Dockerfile.poster`
   - Add the same environment variables as Vercel
   - Enable the **port 6080** (for web desktop access)
5. Once deployed, open `https://your-service.railway.app:6080/vnc.html`
6. Click **Connect** — you'll see a Linux desktop in your browser
7. Open a terminal and run:
   ```
   cd /app
   npm run fb-login
   ```
8. A Chromium browser opens — log into Facebook
9. Close the browser window
10. Now run the poster:
    ```
    npm run poster
    ```
11. The poster will process your queue automatically

### Option B: Personal Computer (free, safest for FB)

1. Install [Node.js](https://nodejs.org) on your personal computer
2. Clone/download the project
3. Run:
   ```
   npm install
   npm install playwright
   npx playwright install chromium
   ```
4. One-time login:
   ```
   npm run fb-login
   ```
5. Log into Facebook, then close the browser
6. Run the poster whenever you want:
   ```
   npm run poster
   ```
7. Queue vehicles from the Vercel-hosted UI at work, run poster at home

### Option C: USB Portable (no admin rights needed)

1. Download [Node.js portable](https://nodejs.org/en/download/) to a USB drive
2. Copy the project folder to the USB
3. Open a command prompt, navigate to the project on the USB
4. Run the same commands as Option B
5. Everything runs from the USB — nothing installed on the computer

---

## Daily Workflow

1. **At work** (browser only):
   - Open your Vercel URL
   - Upload vAuto PDF to sync inventory
   - Click "Scrape & Generate" for photos + descriptions
   - Click "Queue All" to queue vehicles for posting

2. **Poster runs** (Railway auto or home PC):
   - Posts up to 10 vehicles per day
   - 10-15 minute gaps between posts
   - Updates status in real-time on the web UI

---

## Important: Facebook Safety Rules

- **Max 10 posts per day** — built into the poster
- **10-15 min between posts** — built into the poster
- **Personal account only** — never use a business page
- **Remove sold vehicles within 24 hours** — handled by PDF re-upload
- **No duplicate content** — each description is unique via AI
- **Residential IP preferred** — Option B (home PC) is safest
