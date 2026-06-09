# Airbnb Price History Tracker & Analyzer

A premium, production-ready web application designed to track and analyze historical pricing for selected Airbnb accommodations, helping you find the most advantageous stays based on regions, dates, comfort ratings, and active promotions.

Built to be hosted on **Vercel** with a **MongoDB Atlas** database, securing users via **Google Sign-In** (OAuth 2.0) and utilizing **GitHub Actions** for time-limit-independent background web scraping.

---

## Key Features

- **Google Sign-In Authentication:** Secure OAuth-based login. All tracked links and price histories are tied to individual Google accounts.
- **Dynamic Cost-Benefit Ranking:** Sorts and scores listings using a weighted algorithm (40% relative price, 30% comfort rating, 15% volume of reviews, and 15% active discounts) grouped by region and stay length.
- **Historical Price Charts:** Dynamic, interactive line charts powered by Chart.js showing price trends over time.
- **Unavailable Dates Detection:** Instantly flags listings that become unavailable for your selected dates.
- **Automated Daily Scraping:** Bypasses Vercel's 10-second serverless timeout execution limits by running daily cron scrapes at 3:00 AM on GitHub Actions (where execution limits are 6 hours and Chrome is pre-installed).
- **Manual Scraping Dispatches:** Integrates with the GitHub Repository Dispatch API. When a user adds a link or clicks "Atualizar Preço", Vercel triggers a GitHub Action to scrape that listing in the background, updating the UI smoothly via polling.
- **Expiration Filtering:** Automatically ignores and stops scraping listings once their check-out date has passed.

---

## Directory Structure

```text
├── .github/
│   └── workflows/
│       ├── deploy.yml            # Vercel deployment pipeline
│       └── scrape-cron.yml       # Daily background cron & webhook scraper
├── api/
│   └── index.js                  # Vercel serverless entry point
├── public/
│   ├── index.html                # App dashboard UI
│   ├── login.html                # Google login portal
│   ├── app.js                    # Client-side routing, JWT & polling
│   └── style.css                 # Dark mode CSS styling system
├── src/
│   ├── models/                   # Mongoose Database models
│   │   ├── User.js
│   │   ├── Link.js
│   │   ├── PriceRecord.js
│   │   └── UserLink.js
│   ├── app.js                    # Express application routes & logic
│   ├── db.js                     # MongoDB connection pool & DNS fallback
│   ├── scraper.js                # Puppeteer scraper engine
│   ├── cron-scraper.js           # Standalone cron scraping utility
│   └── server.js                 # Local server runner
├── package.json
└── vercel.json                   # Vercel path mapping and rewrites
```

---

## Environment Variables

Configure these variables in your local `.env` file, in your **Vercel Project Settings**, and in your **GitHub Repository Secrets**:

| Variable Name | Description | Required in Vercel | Required in GitHub |
| :--- | :--- | :---: | :---: |
| `MONGO_URI` | MongoDB Atlas Connection String (`mongodb+srv://...`) | Yes | Yes |
| `GOOGLE_CLIENT_ID` | Client ID from the Google Developer Console | Yes | No |
| `JWT_SECRET` | Secret key used to sign session tokens | Yes | No |
| `GITHUB_PAT` | Personal Access Token with `repo` scope | Yes | No |
| `GITHUB_REPO` | Path to your repository (e.g., `user/repo-name`) | Yes | No |

---

## Configuration & Setup

### 1. Google OAuth Client ID
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Search for **APIs & Services** > **Credentials**.
4. Click **Create Credentials** > **OAuth client ID**.
5. Set the application type to **Web application**.
6. Under **Authorized JavaScript origins**, add:
   - `http://localhost:3000` (for local development)
   - `https://your-app-domain.vercel.app` (for production)
7. Under **Authorized redirect URIs**, add:
   - `http://localhost:3000`
   - `https://your-app-domain.vercel.app`
8. Copy the **Client ID** and save it as your `GOOGLE_CLIENT_ID` environment variable.

### 2. MongoDB Atlas Database
1. Create a free shared cluster at [MongoDB Atlas](https://www.mongodb.com/).
2. Under Database Access, create a user with read/write permissions.
3. Under Network Access, whitelist `0.0.0.0/0` (required for Vercel dynamic IP ranges).
4. Copy the connection string (with the pattern `mongodb+srv://...`) and save it as your `MONGO_URI`.

### 3. GitHub Actions Integration
For the background scraper and automated deployments to work, configure these secrets in your GitHub Repository Settings (`Settings > Secrets and variables > Actions`):
- `MONGO_URI`: Your MongoDB Atlas connection string.
- `VERCEL_TOKEN`: Vercel Personal Access Token (from Vercel Account Settings > Tokens).
- `VERCEL_ORG_ID`: Your Vercel team/user ID.
- `VERCEL_PROJECT_ID`: Your Vercel Project ID.

---

## Running Locally

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/airbnb-price-history.git
   cd airbnb-price-history
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up local configurations:**
   Create a `.env` file in the root directory:
   ```env
   MONGO_URI=mongodb+srv://...
   GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
   JWT_SECRET=super-secure-secret-key
   # Optional: GITHUB_PAT and GITHUB_REPO can be omitted locally; 
   # the app will fallback to local asynchronous scraping.
   ```

4. **Start the local server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your web browser.
