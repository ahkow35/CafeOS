-- ========================================
-- EMAIL NOTIFICATION SETUP
-- ========================================
-- This file documents the webhook setup for automatic email notifications
-- when leave requests are approved or rejected.
--
-- IMPORTANT: The recommended approach is to set up webhooks via the
-- Supabase Dashboard UI (see EMAIL_SETUP_GUIDE.md).
-- This SQL file is for REFERENCE ONLY.
--
-- ========================================

-- ========================================
-- OPTION A: DATABASE WEBHOOKS (RECOMMENDED)
-- ========================================
-- Set up via Supabase Dashboard:
-- 1. Go to: Database → Webhooks → Create a new hook
-- 2. Configure:
--    - Name: send-leave-notification
--    - Table: leave_requests
--    - Events: Update
--    - Type: Supabase Edge Functions
--    - Edge Function: send-leave-email
-- 3. Enable the webhook
--
-- See EMAIL_SETUP_GUIDE.md for detailed step-by-step instructions.

-- ========================================
-- OPTION B: DATABASE TRIGGER (ADVANCED)
-- ========================================
-- Alternative approach using pg_net extension to call Edge Functions directly.
-- This is more complex and requires additional setup.
--
-- Prerequisites:
-- 1. Enable pg_net extension in Supabase Dashboard
-- 2. Set up service role key for authentication
--
-- Example implementation (NOT RECOMMENDED for beginners):

-- Enable pg_net extension
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create trigger function
-- CREATE OR REPLACE FUNCTION notify_leave_status_change()
-- RETURNS TRIGGER AS $$
-- DECLARE
--   request_body jsonb;
--   function_url text;
-- BEGIN
--   -- Only trigger if status actually changed to approved or rejected
--   IF (OLD.status != NEW.status) AND 
--      (NEW.status IN ('approved', 'rejected')) THEN
--     
--     -- Build request body
--     request_body := jsonb_build_object(
--       'record', row_to_json(NEW),
--       'old_record', row_to_json(OLD)
--     );
--     
--     -- Get your Edge Function URL from Supabase Dashboard
--     function_url := 'YOUR_SUPABASE_URL/functions/v1/send-leave-email';
--     
--     -- Make async HTTP request
--     PERFORM net.http_post(
--       url := function_url,
--       body := request_body,
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
--       )
--     );
--   END IF;
--   
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
-- DROP TRIGGER IF EXISTS on_leave_status_change ON public.leave_requests;
-- CREATE TRIGGER on_leave_status_change
--   AFTER UPDATE ON public.leave_requests
--   FOR EACH ROW
--   EXECUTE FUNCTION notify_leave_status_change();

-- ========================================
-- VERIFICATION QUERIES
-- ========================================

-- Check if webhooks exist (requires dashboard access)
-- This query won't work in SQL editor, webhooks are managed via Dashboard

-- Check if Edge Function is deployed
-- Go to: Edge Functions in Supabase Dashboard

-- Test if profiles table has user emails
SELECT 
    id,
    email,
    full_name
FROM public.profiles
WHERE id IN (
    SELECT DISTINCT user_id 
    FROM public.leave_requests
);

-- View recent leave status changes (to test webhook)
SELECT 
    lr.id,
    lr.user_id,
    p.email,
    p.full_name,
    lr.status,
    lr.leave_type,
    lr.start_date,
    lr.end_date,
    lr.updated_at
FROM public.leave_requests lr
JOIN public.profiles p ON p.id = lr.user_id
WHERE lr.updated_at > NOW() - INTERVAL '1 day'
ORDER BY lr.updated_at DESC;

-- ========================================
-- TROUBLESHOOTING
-- ========================================

-- 1. Check if user email exists
-- SELECT email FROM public.profiles WHERE id = 'USER_ID_HERE';

-- 2. Manually test the status change
-- UPDATE public.leave_requests 
-- SET status = 'approved' 
-- WHERE id = 'YOUR_TEST_LEAVE_REQUEST_ID';

-- 3. Check Edge Function logs in Supabase Dashboard:
-- Edge Functions → send-leave-email → Logs
