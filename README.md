# FB Marketplace Auto-Poster

Automated Facebook Marketplace posting, auto-reply, and listing renewal for Newby Buick GMC.

## What It Does

- **Auto-Poster** — Posts queued vehicles from the dashboard to Facebook Marketplace. Runs during posting hours (7 AM – 2 PM Mountain Time), up to 27 posts per day per salesperson, with 10–15 minute gaps between posts.
- **Auto-Reply** — Replies to unread Marketplace messages with personalized templates including your name, phone number, and dealership info.
- **Listing Renewer** — Bumps existing listings back to the top of Marketplace so they stay visible.

All three support multiple salespeople. Each person gets their own Facebook session and daily limits.

---

## Setup (One-Time)

### Step 1: Run the Installer

Double-click **`install.bat`**

This will:
- Install Node.js (if not already installed)
- Install Git (if not already installed)
- Clone the project
- Install all dependencies
- Install the Playwright browser
- Create the `.env.local` config file

> If it asks you to close and reopen after installing Node.js or Git, do that and run `install.bat` again.

### Step 2: Log Into Facebook

Double-click **`fb-login.bat`**

1. Enter your User ID when prompted (you can find this on the dashboard)
2. A browser window will open to Facebook
3. Log into your Facebook account
4. Once you're logged in and can see Marketplace, close the browser window
5. Your session is now saved

> You only need to do this once. If Facebook logs you out later, just run `fb-login.bat` again.

### Step 3: Make Sure Your Profile Is Active

Ask your manager to make sure your profile in the dashboard has:
- `is_active` set to **true**
- Your **phone number** filled in
- Your **display name** filled in

---

## Daily Use

### Run Everything

Double-click **`run-all.bat`**

This opens three windows — one for each service. Leave them running during the day. Each window is color-coded:
- Green = Auto-Poster
- Blue = Auto-Reply
- Purple = Listing Renewer

Close any window to stop that service. Close all three when you're done for the day.

### Run Individual Services

If you only want to run one service:

| What | File |
|------|------|
| Auto-Poster only | `run-poster.bat` |
| Auto-Reply only | `npm run autoreply` (in terminal) |
| Listing Renewer only | `npm run renew` (in terminal) |

---

## How Posting Works

1. Queue vehicles for posting from the web dashboard
2. Run the poster (`run-poster.bat` or `run-all.bat`)
3. The poster waits for posting hours (7 AM Mountain Time)
4. It opens a browser, logs into Facebook using your saved session, and posts each vehicle one at a time
5. Between each post, it waits 10–15 minutes to look natural
6. After reaching the daily limit or running out of queued vehicles, it stops
7. Failed posts automatically retry up to 2 times
8. Listings older than 3 days get deleted and reposted to stay fresh
9. Vehicles removed from inventory get their FB listings cleaned up automatically

## How Auto-Reply Works

1. Opens your Marketplace inbox
2. Finds conversations with unread messages (blue dot)
3. Checks if you've already replied in each thread
4. Sends a personalized response with your name, phone, and dealership address
5. Rotates between 5 different reply templates so responses look natural

## How Renewal Works

1. Goes to your active listings page
2. Finds each posted vehicle
3. Clicks "Renew" to bump it back to the top of Marketplace
4. Waits 3–6 minutes between renewals

---

## Troubleshooting

**"Node.js not found"**
Run `install.bat` again. If Node.js was just installed, close all terminal windows and reopen them first.

**"No Facebook session found"**
Run `fb-login.bat` and log into Facebook again.

**"No active users found"**
Your profile's `is_active` flag isn't set to `true` in Supabase. Ask your manager to fix this.

**"ERROR: not logged into Facebook"**
Your Facebook session expired. Run `fb-login.bat` to log in again.

**Posts are failing**
Check the screenshots saved in the `scripts/` folder (named `error_[VIN].png`). These show what the browser saw when the post failed. Common causes:
- Facebook asking for a security check — log in manually and complete it, then run `fb-login.bat`
- Internet connection issue — check your connection and try again
- Facebook rate limiting — wait a few hours and try again

**"Outside posting hours"**
The poster only runs between 7 AM and 2 PM Mountain Time. This is intentional to look like normal human behavior.

---

## File Reference

| File | Purpose |
|------|---------|
| `install.bat` | One-time setup — installs everything |
| `fb-login.bat` | Log into Facebook and save your session |
| `run-all.bat` | Start all 3 services (poster + reply + renew) |
| `run-poster.bat` | Start the auto-poster only |
| `launch-fb-tool.bat` | Start the web dashboard locally |

---

## For Managers

### Adding a New Salesperson

1. Create their profile in Supabase with `is_active = true`, their phone number, and display name
2. Have them run `install.bat` on their computer
3. Have them run `fb-login.bat` and enter their User ID
4. They're ready to go — just run `run-all.bat` each morning

### Adjusting Settings

Settings are in `scripts/fb-poster.mjs` at the top of the file:
- `DEFAULT_MAX_POSTS_PER_DAY` — max posts per user per day (default: 27)
- `MIN_DELAY_MS` / `MAX_DELAY_MS` — delay between posts (default: 10–15 minutes)
- `POSTING_START_HOUR` / `POSTING_END_HOUR` — posting window (default: 7 AM – 2 PM MT)
- `STALE_DAYS` — days before a listing gets refreshed (default: 3)

### Updating the Tool

To pull the latest version on any salesperson's computer, just run `install.bat` again. It will pull the latest code and update dependencies.
