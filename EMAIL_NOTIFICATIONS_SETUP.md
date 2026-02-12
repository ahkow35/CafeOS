# 📧 Email Notification Quick Start

Follow these steps to enable automatic email notifications for leave approvals/rejections.

## ✅ Quick Checklist

### 1. Get Resend API Key (5 minutes)
- [ ] Sign up at [resend.com](https://resend.com)
- [ ] Go to **API Keys** → **Create API Key**
- [ ] Copy the key (starts with `re_...`)

### 2. Configure Supabase (2 minutes)
- [ ] Open Supabase Dashboard → **Settings** → **Edge Functions**
- [ ] Click **Add new secret**
- [ ] Name: `RESEND_API_KEY`
- [ ] Value: (paste your Resend API key)
- [ ] Click **Save**

### 3. Deploy Edge Function (2 minutes)

**Option A - Using CLI:**
```bash
cd /Users/nyanyk/Antigravity/CafeOs
npx supabase functions deploy send-leave-email
```

**Option B - Using Dashboard:**
- Go to **Edge Functions** → **Deploy new function**
- Upload `supabase/functions/send-leave-email/`

### 4. Set Up Database Webhook (3 minutes)
- [ ] Go to **Database** → **Webhooks** → **Create a new hook**
- [ ] Configure:
  - **Name:** `send-leave-notification`
  - **Table:** `leave_requests`
  - **Events:** ✅ Update
  - **Type:** Supabase Edge Functions
  - **Edge Function:** `send-leave-email`
- [ ] Click **Create webhook**
- [ ] Toggle webhook **ON**

### 5. Test (1 minute)
- [ ] Go to `http://localhost:3000/admin/leave`
- [ ] Approve or reject a test leave request
- [ ] Check user's email inbox

---

## 🔧 Troubleshooting

**No email received?**
1. Check **Edge Functions** → `send-leave-email` → **Logs**
2. Verify **Database** → **Webhooks** → `send-leave-notification` is **ON**
3. Confirm **Settings** → **Edge Functions** → `RESEND_API_KEY` exists

**Need more details?** See [`EMAIL_SETUP_GUIDE.md`](./EMAIL_SETUP_GUIDE.md)

---

## 📚 Files Created

- **[EMAIL_SETUP_GUIDE.md](./EMAIL_SETUP_GUIDE.md)** - Detailed setup guide
- **[supabase/setup_email_notifications.sql](./supabase/setup_email_notifications.sql)** - SQL reference (for advanced users)
- **[supabase/fix_performance_issues.sql](./supabase/fix_performance_issues.sql)** - Database performance fixes

## 🎯 What Happens

When you approve/reject a leave request:
1. Database status changes (`pending_manager` → `approved`)
2. Webhook triggers → calls `send-leave-email` Edge Function
3. Function fetches user email from `profiles` table
4. Email sent via Resend API
5. User receives notification ✅
