# Email Notification Setup Guide

This guide will help you set up automatic email notifications when leave requests are approved or rejected.

## Overview

When a manager or owner approves/rejects a leave request, the system will automatically send an email to the employee via the **Resend** email service.

## Prerequisites

- Access to your Supabase project dashboard
- A Resend account (free tier available)

---

## Step 1: Get Your Resend API Key

1. **Sign up for Resend** at [resend.com](https://resend.com)
   - The free tier includes 100 emails/day, which should be sufficient for most small teams

2. **Get your API key:**
   - After signing up, go to **API Keys** in the Resend dashboard
   - Click **Create API Key**
   - Copy the API key (starts with `re_...`)
   - ⚠️ **Save this key securely** - you won't be able to see it again

---

## Step 2: Configure Supabase Environment Variables

1. **Open your Supabase project dashboard**

2. **Navigate to:** Settings → Edge Functions → Add new secret

3. **Add the following secret:**
   - **Name:** `RESEND_API_KEY`
   - **Value:** Your Resend API key (from Step 1)
   - Click **Save**

> **Note:** `SUPABASE_URL` and `SUPABASE_ANON_KEY` are automatically provided by Supabase and don't need to be configured.

---

## Step 3: Deploy the Edge Function

The Edge Function code already exists at `supabase/functions/send-leave-email/index.ts`.

### Option A: Deploy via Supabase CLI (if installed)

```bash
# Make sure you're in the project root
cd /Users/nyanyk/Antigravity/CafeOs

# Deploy the function
npx supabase functions deploy send-leave-email
```

### Option B: Deploy via Supabase Dashboard

1. Go to **Edge Functions** in your Supabase dashboard
2. Click **Deploy new function**
3. Upload the contents of `supabase/functions/send-leave-email/`

---

## Step 4: Set Up Database Webhook

This is the crucial step that triggers the email function when leave status changes.

1. **In Supabase Dashboard, go to:** Database → Webhooks

2. **Click "Create a new hook"**

3. **Configure the webhook:**
   - **Name:** `send-leave-notification`
   - **Table:** `leave_requests`
   - **Events:** Check ✅ **Update**
   - **Type:** `Supabase Edge Functions`
   - **Edge Function:** Select `send-leave-email` from dropdown
   - **HTTP Headers:** Leave empty (Supabase handles auth automatically)
   - **Timeout:** 5000ms (default is fine)

4. **Click "Create webhook"**

5. **Enable the webhook** using the toggle switch

---

## Step 5: Test the Email Notification

1. **Go to your app's admin panel:** `http://localhost:3000/admin/leave`

2. **Approve or reject a test leave request**

3. **Check the inbox** of the user who submitted the leave request
   - You should receive an email within a few seconds
   - The email will show the status (APPROVED/REJECTED) and leave dates

### If emails are not being sent:

1. **Check Supabase Edge Function logs:**
   - Go to: Edge Functions → `send-leave-email` → Logs
   - Look for any errors (missing API key, network issues, etc.)

2. **Check the webhook is active:**
   - Go to: Database → Webhooks
   - Make sure `send-leave-notification` is toggled ON

3. **Verify the environment variable:**
   - Go to: Settings → Edge Functions
   - Confirm `RESEND_API_KEY` exists

4. **Test the function manually:**
   - Go to: Edge Functions → `send-leave-email` → Test
   - Use this test payload:
   ```json
   {
     "record": {
       "id": "test-id",
       "user_id": "YOUR_USER_ID",
       "status": "approved",
       "leave_type": "annual",
       "start_date": "2026-02-10",
       "end_date": "2026-02-12",
       "days_requested": 2
     },
     "old_record": {
       "status": "pending_owner"
     }
   }
   ```

---

## Customizing the Email

To customize the email content, edit `supabase/functions/send-leave-email/index.ts`:

- **Line 54:** Change the "from" address (requires domain verification in Resend)
- **Lines 56-63:** Customize the email subject and HTML content

After making changes, redeploy the function using Step 3.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No emails received | Check Edge Function logs for errors |
| "Missing RESEND_API_KEY" error | Add the secret in Settings → Edge Functions |
| Webhook not triggering | Verify webhook is enabled and watching `leave_requests` table |
| Email goes to spam | Set up SPF/DKIM records in Resend (requires custom domain) |
| Wrong email address | Check that `profiles` table has correct email for `user_id` |

---

## Next Steps

Once email notifications are working:

1. **Verify your domain in Resend** (optional but recommended)
   - Allows using your own email address (e.g., `noreply@yourcompany.com`)
   - Improves email deliverability
   - Prevents emails from going to spam

2. **Monitor your Resend usage**
   - Free tier: 100 emails/day
   - Upgrade if needed for larger teams

3. **Consider adding:**
   - Email templates with your company branding
   - Notification preferences (allow users to opt out)
   - Digest emails (daily summary instead of per-request)
