# CafeOS Deployment Guide

## 🚀 Quick Start

CafeOS is a Next.js Progressive Web App (PWA) for employee leave management,
using Supabase for backend services.

## 📋 Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account
- Jenkins (for CI/CD)
- Resend account (for email notifications)

## 🗄️ Database Architecture

**Important:** CafeOS uses **Supabase** as a cloud-hosted PostgreSQL database.
This means:

- ✅ **No database migration needed during deployment**
- ✅ **Database is shared across all environments** (dev, staging, production)
- ✅ **Migrations are already applied** to your Supabase instance
- ✅ **Only environment variables need to be configured**

### Database Migrations

Your Supabase database already has these migrations applied:

- `001_schema.sql` - Core tables (profiles, leave_applications,
  leave_entitlements)
- `002_2level_approval.sql` - Manager/Owner approval workflow
- `003_medical_evidence.sql` - Medical certificate handling
- `004_storage.sql` - File storage configuration
- `005_email_notifications.sql` - Email notification system

**You do NOT need to run these migrations again for deployment.**

## 🔐 Environment Variables

### Required Variables

Create a `.env.local` file (for local development) or configure in Jenkins:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### Getting Supabase Credentials

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Settings** → **API**
4. Copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 🏗️ Jenkins Deployment

### 1. Setup Jenkins Credentials

Add these credentials in Jenkins (**Manage Jenkins** → **Credentials**):

- **ID**: `cafeos-supabase-url`
  - **Type**: Secret text
  - **Value**: Your Supabase URL

- **ID**: `cafeos-supabase-anon-key`
  - **Type**: Secret text
  - **Value**: Your Supabase anon key

### 2. Create Jenkins Pipeline

1. Create a new **Pipeline** job in Jenkins
2. Configure **Pipeline** section:
   - **Definition**: Pipeline script from SCM
   - **SCM**: Git
   - **Repository URL**: Your GitHub repository URL
   - **Script Path**: `Jenkinsfile`

### 3. Deploy

- Trigger the pipeline manually or set up webhooks for automatic deployment on
  push

### 4. Post-Deployment

The app will be accessible at `http://your-jenkins-server:3000`

## 📧 Supabase Edge Functions (Email Notifications)

The email notification system runs as a **Supabase Edge Function**, separate
from your Jenkins deployment.

### Deploy Edge Function

```bash
# Login to Supabase
npx supabase login

# Link your project
npx supabase link --project-ref your-project-ref

# Deploy the function
npx supabase functions deploy send-leave-email
```

### Configure Resend API Key

1. Get API key from [resend.com](https://resend.com)
2. Add to Supabase:
   - Go to **Edge Functions** → **send-leave-email** → **Settings**
   - Add secret: `RESEND_API_KEY`

### Database Webhook (Already Configured)

The database trigger is already set up via `005_email_notifications.sql`. It
automatically calls the Edge Function when leave status changes.

## 🎯 Manual Deployment (Without Jenkins)

### Local Development

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.local.example .env.local
# Edit .env.local with your credentials

# Run development server
npm run dev
```

### Production Build

```bash
# Build the application
npm run build

# Start production server
npm start
```

## 🔍 Verification Checklist

After deployment, verify:

- [ ] App loads at the deployment URL
- [ ] Login/authentication works (Supabase Auth)
- [ ] Leave applications can be created
- [ ] Leave applications appear in admin dashboard
- [ ] Approval workflow functions (manager → owner)
- [ ] Email notifications are sent (check Supabase Edge Function logs)
- [ ] PWA installs on mobile devices

## 🐛 Troubleshooting

### Build Fails

- Check Node.js version (must be 18+)
- Clear `.next` folder: `rm -rf .next`
- Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`

### Database Connection Issues

- Verify environment variables are set correctly
- Check Supabase project is active
- Verify RLS (Row Level Security) policies are enabled

### Email Notifications Not Sending

- Check Supabase Edge Function logs
- Verify `RESEND_API_KEY` is set in Edge Function secrets
- Confirm database webhook is active

## 📚 Additional Resources

- [Next.js Deployment Docs](https://nextjs.org/docs/deployment)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Resend Documentation](https://resend.com/docs)

## 🆘 Support

For issues, check:

1. Jenkins build logs
2. Supabase Edge Function logs
3. Browser console (F12)
4. Application logs: `/var/log/cafeos/app.log` (on Jenkins server)
