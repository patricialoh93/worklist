# Worklist

A single-page work to-do list with follow-up actionables, ageing indicators, importance flags,
and an "owed to" field for whoever is waiting on each task.

Tasks are stored in the browser's `localStorage` — nothing is sent to or stored on the server.
That means each browser/device keeps its own list; use **Export JSON** / **Import JSON** to move
between them.

## Running locally

Just open `index.html` in a browser. No build step, no server needed.

## Deploying to Railway

The repo is ready to deploy as-is: `server.js` is a zero-dependency Node static server,
`package.json` gives Railway its `npm start`, and `railway.json` sets the health check.

**Option A — GitHub (same flow as the trading dashboard)**

1. Create an empty repo on GitHub, e.g. `worklist`.
2. Push this folder:
   ```
   git remote add origin https://github.com/<you>/worklist.git
   git push -u origin main
   ```
3. On railway.app: **New Project → Deploy from GitHub repo → worklist**.
4. Once built, open **Settings → Networking → Generate Domain** to get the public URL.

**Option B — Railway CLI**

```
npm i -g @railway/cli
railway login
railway init
railway up
railway domain
```

## Optional password protection

The deployed site is public by default. To put it behind a browser password prompt,
set both of these variables in Railway (**Variables** tab) and redeploy:

| Variable    | Value                |
|-------------|----------------------|
| `AUTH_USER` | any username you pick |
| `AUTH_PASS` | any password you pick |

Leave them unset and the site stays open. `/healthz` is always reachable so Railway's
health check keeps working either way.

Note that basic auth sends credentials on every request — fine over Railway's HTTPS for a
personal tool, but don't reuse a password you use anywhere else.
