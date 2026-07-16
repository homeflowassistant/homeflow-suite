# Deploy Express Backend to Render.com

## Prerequisites
- Render.com account (free tier available)
- GitHub repository with this code pushed
- PostgreSQL database URL (from Supabase or similar)
- GHL OAuth credentials (client ID & secret)

## Step 1: Push Code to GitHub

```bash
git add .
git commit -m "Add render.yaml and environment configuration"
git push origin main
```

## Step 2: Create Render Service

1. Go to [render.com](https://render.com) and sign in
2. Click **New +** → **Web Service**
3. Select **Build and deploy from a Git repository**
4. Connect your GitHub account and select this repository
5. Configure:
   - **Name**: `addcontact-server`
   - **Runtime**: Node
   - **Build Command**: `pnpm install && pnpm build`
   - **Start Command**: `pnpm start`
   - **Plan**: Free (suitable for testing)

## Step 3: Add Environment Variables

In the Render dashboard, go to **Environment** and add:

```
NODE_ENV = production
PORT = 3000
GHL_CLIENT_ID = <your-ghl-client-id>
GHL_CLIENT_SECRET = <your-ghl-client-secret>
DATABASE_URL = <your-postgresql-url>
JWT_SECRET = <random-secret-key>
ALLOWED_ORIGINS = https://addcontact-xi.vercel.app
```

## Step 4: Deploy

- Render automatically deploys on push to your specified branch
- Or manually trigger via **Manual Deploy** button
- Monitor deploy logs in the **Logs** tab
- Once deployed, you'll get a URL like: `https://addcontact-server.onrender.com`

## Step 5: Update Vercel Client Configuration

1. Go to [Vercel Dashboard](https://vercel.com/moawizs-projects/addcontact)
2. **Settings** → **Environment Variables**
3. Add for **Production**:
   ```
   VITE_API_URL = https://addcontact-server.onrender.com
   ```
4. **Deployments** → **Redeploy** latest commit
5. Wait for build to complete

## Step 6: Verify Connection

1. Visit your Vercel app: `https://addcontact-xi.vercel.app`
2. Open browser DevTools → **Network** tab
3. Perform an action (e.g., click a button that makes an API call)
4. Verify requests go to `https://addcontact-server.onrender.com/api/trpc`
5. Check response status is 2xx (not 5xx)

## Troubleshooting

### "Network Error" in Browser
- **Check**: Is Render deployment successful? (check Render Logs)
- **Check**: Are environment variables set in Render?
- **Check**: Is `VITE_API_URL` set in Vercel?
- **Check**: CORS: Ensure `ALLOWED_ORIGINS` includes your Vercel domain

### "Cannot find module" on Render
- Render uses `pnpm install` if `pnpm-lock.yaml` exists ✅
- Ensure all dependencies are listed in `package.json`
- Check build logs: `pnpm build` must succeed

### Cold Start / Slow Response
- Free tier Render instances spin down after inactivity
- First request after 15 min of inactivity may take 30-60 seconds
- Upgrade to **Starter** plan ($7/mo) for always-on availability

## Free Tier Limits (Render)
- Spins down after 15 minutes of inactivity (first request slow)
- 0.5 CPU, 512MB RAM
- Suitable for testing only
- Upgrade to **Starter** for production

## Cost Estimate (Monthly)
- **Render Starter**: $7/month (always-on server)
- **Vercel**: Free (static client)
- **PostgreSQL (Supabase)**: Free tier or $25+/month
- **Total**: ~$7-32/month depending on tier choices
