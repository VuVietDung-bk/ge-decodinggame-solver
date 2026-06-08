# Deployment Guide

This project is a simple Node.js HTTP server (`server.js`) that serves the React app, images, and JSON data. There is no build step.

## Prerequisites
- Node.js 18+ (or any LTS version)
- Port access on your host (publicly reachable)

## Option A: Render (recommended, easiest global access)
1. Push this repo to GitHub.
2. Create a **New Web Service** on Render and connect the repo.
3. **Build Command:** *(leave empty)*
4. **Start Command:** `node server.js`
5. **Environment:** Node
6. **Port:** Render injects `PORT` automatically; the server uses it.
7. Deploy and use the Render URL to access worldwide.

## Option B: Fly.io (global edge)
1. Install Fly CLI and login.
2. From repo root:
   ```bash
   fly launch --no-deploy
   ```
3. Use the following `fly.toml` settings:
   ```toml
   [build]
     builder = "heroku/buildpacks:20"

   [env]
     PORT = "8080"

   [[services]]
     internal_port = 8080
     protocol = "tcp"
     [[services.ports]]
       handlers = ["http"]
       port = 80
     [[services.ports]]
       handlers = ["tls", "http"]
       port = 443
   ```
4. Deploy:
   ```bash
   fly deploy
   ```

## Option C: Self-host (VPS)
1. Copy the repo to your server.
2. Install Node.js.
3. Run:
   ```bash
   npm install
   node server.js
   ```
4. Ensure the server port is open in firewall/security group.

### Optional: Nginx reverse proxy (HTTPS)
If you want HTTPS and a custom domain:
- Install Nginx and use it to proxy to `localhost:3000` (or the `PORT` you set).
- Use a certificate from Let’s Encrypt (Certbot).

## Environment Variables
- `PORT` (optional): defaults to `3000` if not set.

## Notes
- The server serves:
  - `/` and `/index.html` from `public/`
  - `/app.js` and `/styles.css` from `public/`
  - `/images/*` from `images/`
  - `/api/bootstrap` from `PlantProps.json` + `PlantFeatures.json`

Once deployed to a public host, the app is accessible to international users.
