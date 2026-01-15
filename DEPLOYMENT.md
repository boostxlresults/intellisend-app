# IntelliSend Deployment Guide

This guide walks through deploying IntelliSend to production with:
- **Frontend**: Vercel (intellisend.net)
- **Backend**: Railway (api.intellisend.net)
- **Database**: Neon PostgreSQL

## Prerequisites

- GitHub account with repository access
- Neon account (https://neon.tech)
- Vercel account (https://vercel.com)
- Railway account (https://railway.app)
- Domain: intellisend.net configured for DNS

---

## Step 1: Push Code to GitHub

1. Create a new repository on GitHub (e.g., `intellisend`)
2. Push this codebase:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/intellisend.git
   git branch -M main
   git push -u origin main
   ```

---

## Step 2: Set Up Neon Database

1. Go to https://console.neon.tech
2. Create a new project named "IntelliSend"
3. Copy the connection string (looks like: `postgresql://user:pass@host/db?sslmode=require`)
4. Save this as your `DATABASE_URL`

### Run Database Migrations

From the server directory with the Neon DATABASE_URL:
```bash
cd server
DATABASE_URL="your-neon-connection-string" npx prisma migrate deploy
```

---

## Step 3: Deploy Backend to Railway

1. Go to https://railway.app and create a new project
2. Click "Deploy from GitHub repo"
3. Select your repository
4. Configure the service:
   - **Root Directory**: `server`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm run start`

### Add Environment Variables in Railway

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Your Neon connection string |
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | Generate a secure random string (32+ chars) |
| `FRONTEND_URL` | `https://intellisend.net` |
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Your Twilio Auth Token |
| `TWILIO_MESSAGING_SERVICE_SID` | Your Twilio Messaging Service SID |
| `OPENAI_API_KEY` | Your OpenAI API key (optional, for AI features) |

**Note**: Do NOT set `PORT` manually - Railway automatically assigns a port that the app must use.

### Configure Custom Domain

1. In Railway project settings, go to "Domains"
2. Add custom domain: `api.intellisend.net`
3. Configure DNS: Add CNAME record pointing to Railway's domain

---

## Step 4: Deploy Frontend to Vercel

1. Go to https://vercel.com and import your repository
2. Configure the project:
   - **Framework Preset**: Vite
   - **Root Directory**: `client`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

### Add Environment Variables in Vercel

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://api.intellisend.net/api` |

### Configure Custom Domain

1. In Vercel project settings, go to "Domains"
2. Add custom domain: `intellisend.net`
3. Configure DNS: Add A/CNAME records as shown by Vercel

---

## Step 5: Configure Twilio Webhooks

In your Twilio Console:

1. Go to Messaging > Services > Your Messaging Service
2. Under "Integration", set:
   - **Incoming Messages**: `https://api.intellisend.net/webhooks/twilio/inbound`
   - **Status Callbacks**: `https://api.intellisend.net/webhooks/twilio/status`

---

## Step 6: DNS Configuration for intellisend.net

Configure these DNS records:

| Type | Name | Value |
|------|------|-------|
| A/CNAME | @ | (Vercel provided value) |
| CNAME | api | (Railway provided value) |
| CNAME | www | intellisend.net |

---

## Step 7: First User Setup

1. Visit https://intellisend.net
2. Click "Create your first admin account"
3. Enter your email, name, and a strong password
4. You're now logged in as the admin

**Note**: After the first user is created, registration is disabled for security. Additional users must be added via database or future admin panel.

---

## Environment Variables Summary

### Backend (Railway)
```
DATABASE_URL=postgresql://...
NODE_ENV=production
SESSION_SECRET=your-secure-random-string
FRONTEND_URL=https://intellisend.net
TWILIO_ACCOUNT_SID=ACxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_MESSAGING_SERVICE_SID=MGxxxx
OPENAI_API_KEY=sk-xxxx
```
Note: PORT is automatically assigned by Railway - do not set it manually.

### Frontend (Vercel)
```
VITE_API_URL=https://api.intellisend.net/api
```

---

## Troubleshooting

### CORS Errors
- Ensure `FRONTEND_URL` in Railway matches exactly (including https://)
- Check that cookies are being sent with `credentials: 'include'`

### Session Not Persisting
- Verify `SESSION_SECRET` is set in Railway
- Check that `NODE_ENV=production` is set
- Ensure the cookie domain allows cross-domain access

### Database Connection Issues
- Verify Neon connection string includes `?sslmode=require`
- Check Railway logs for connection errors

### Twilio Webhooks Not Working
- Verify webhook URLs point to api.intellisend.net
- Check Railway logs for incoming webhook requests
- Ensure Twilio signature validation is passing

---

## Automatic Deployments

Both Vercel and Railway support automatic deployments:
- Push to `main` branch triggers rebuild on both platforms
- Railway: Configure branch in project settings
- Vercel: Automatic for all branches by default

---

## Security Checklist

- [ ] SESSION_SECRET is a secure random string (not the default)
- [ ] All API keys stored as environment variables
- [ ] HTTPS enabled on all domains
- [ ] First admin account created with strong password
- [ ] Twilio webhook signature validation enabled
