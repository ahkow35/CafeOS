-- Sample data for local development. Run AFTER db/schema.sql, on a database
-- named cafeos_dev (see scripts/local-db.sh) — NEVER against production.
--
-- Every phone number below is fake, in the +65 8000xxxx range reserved for
-- this seed. PINs are documented in scripts/local-db.sh's output and in
-- docs/LOCAL_DEV.md; they hash the same way db/bootstrap-super-admin.sql does
-- (pgcrypto's `crypt()`/`gen_salt('bf', 12)`, which bcryptjs also reads).

\set ON_ERROR_STOP on

DO $$
DECLARE
    demo_cafe_id    UUID;
    second_cafe_id  UUID;
    owner_id        UUID;
    manager_id      UUID;
    staff1_id       UUID;
    staff2_id       UUID;
    pt1_id          UUID;
    pt2_id          UUID;
    owner2_id       UUID;
    super_id        UUID;
    ts1_id          UUID; -- staff1's timesheet (submitted)
    ts2_id          UUID; -- staff2's timesheet (pending_owner)
    ts3_id          UUID; -- pt1's timesheet (approved)
BEGIN
    -- ── Cafés ────────────────────────────────────────────────────────────
    INSERT INTO public.cafes (slug, name, status)
    VALUES ('demo', 'Demo Café', 'active')
    RETURNING id INTO demo_cafe_id;

    INSERT INTO public.cafes (slug, name, status)
    VALUES ('second', 'Second Café', 'active')
    RETURNING id INTO second_cafe_id;

    -- ── People ───────────────────────────────────────────────────────────
    -- profiles.role is the legacy single-tenant column; kept in sync with
    -- each person's primary café role (cafe_memberships.role is what the app
    -- actually reads for authz).
    INSERT INTO public.profiles (phone_e164, full_name, role, pin_hash, is_active)
    VALUES ('+6580001001', 'Owner Tan', 'owner', crypt('284915', gen_salt('bf', 12)), TRUE)
    RETURNING id INTO owner_id;

    INSERT INTO public.profiles (phone_e164, full_name, role, pin_hash, is_active)
    VALUES ('+6580001002', 'Manager Lim', 'manager', crypt('573062', gen_salt('bf', 12)), TRUE)
    RETURNING id INTO manager_id;

    INSERT INTO public.profiles (phone_e164, full_name, role, pin_hash, is_active)
    VALUES ('+6580001003', 'Staff Wong', 'staff', crypt('619427', gen_salt('bf', 12)), TRUE)
    RETURNING id INTO staff1_id;

    INSERT INTO public.profiles (phone_e164, full_name, role, pin_hash, is_active)
    VALUES ('+6580001004', 'Staff Ong', 'staff', crypt('738254', gen_salt('bf', 12)), TRUE)
    RETURNING id INTO staff2_id;

    INSERT INTO public.profiles (phone_e164, full_name, role, pin_hash, is_active)
    VALUES ('+6580001005', 'Parttime Goh', 'part_timer', crypt('947163', gen_salt('bf', 12)), TRUE)
    RETURNING id INTO pt1_id;

    -- Works at both cafés (demo + second) — exercises cafe_memberships.
    INSERT INTO public.profiles (phone_e164, full_name, role, pin_hash, is_active)
    VALUES ('+6580001006', 'Parttime Koh', 'part_timer', crypt('385290', gen_salt('bf', 12)), TRUE)
    RETURNING id INTO pt2_id;

    -- A separate owner for the second café, so its login is a clean
    -- single-membership case too (not a /login/select pick).
    INSERT INTO public.profiles (phone_e164, full_name, role, pin_hash, is_active)
    VALUES ('+6580002001', 'Owner Farida', 'owner', crypt('512973', gen_salt('bf', 12)), TRUE)
    RETURNING id INTO owner2_id;

    INSERT INTO public.profiles (phone_e164, full_name, role, pin_hash, is_active, is_super_admin)
    VALUES ('+6580009999', 'Super Admin', 'owner', crypt('826734', gen_salt('bf', 12)), TRUE, TRUE)
    RETURNING id INTO super_id;

    UPDATE public.cafes SET created_by = owner_id, approved_by = owner_id, approved_at = NOW()
     WHERE id = demo_cafe_id;
    UPDATE public.cafes SET created_by = owner2_id, approved_by = owner2_id, approved_at = NOW()
     WHERE id = second_cafe_id;

    -- ── Memberships ──────────────────────────────────────────────────────
    INSERT INTO public.cafe_memberships
        (cafe_id, user_id, role, job_title, annual_leave_balance, medical_leave_balance, medical_claim_balance, hourly_rate)
    VALUES
        (demo_cafe_id, owner_id,   'owner',       'Café Owner',       14, 14, 500.00, NULL),
        (demo_cafe_id, manager_id, 'manager',     'Shift Manager',    14, 14, 500.00, 18.00),
        (demo_cafe_id, staff1_id,  'staff',       'Barista',          14, 14, 500.00, 14.00),
        (demo_cafe_id, staff2_id,  'staff',       'Barista',          14, 14, 500.00, 14.00),
        (demo_cafe_id, pt1_id,     'part_timer',  'Part-time Crew',   7,  7,  200.00, 12.00),
        (demo_cafe_id, pt2_id,     'part_timer',  'Part-time Crew',   7,  7,  200.00, 12.00),
        (second_cafe_id, owner2_id, 'owner',      'Café Owner',       14, 14, 500.00, NULL),
        (second_cafe_id, pt2_id,    'part_timer', 'Part-time Crew',   7,  7,  200.00, 13.00);

    -- ── Leave requests: two in each status ──────────────────────────────
    INSERT INTO public.leave_requests
        (cafe_id, user_id, leave_type, start_date, end_date, days_requested, status, reason)
    VALUES
        (demo_cafe_id, staff1_id, 'annual',  '2026-10-05', '2026-10-06', 2, 'pending_manager', 'Family trip'),
        (demo_cafe_id, pt1_id,    'medical', '2026-10-08', '2026-10-08', 1, 'pending_manager', 'Dentist appointment');

    INSERT INTO public.leave_requests
        (cafe_id, user_id, leave_type, start_date, end_date, days_requested, status, reason,
         manager_action_by, manager_action_at)
    VALUES
        (demo_cafe_id, staff2_id, 'annual', '2026-10-10', '2026-10-10', 1, 'pending_owner', 'Personal errand',
         manager_id, NOW() - INTERVAL '1 day'),
        (demo_cafe_id, pt2_id, 'annual', '2026-10-12', '2026-10-13', 2, 'pending_owner', 'Wedding',
         manager_id, NOW() - INTERVAL '1 day');

    INSERT INTO public.leave_requests
        (cafe_id, user_id, leave_type, start_date, end_date, days_requested, status, reason,
         manager_action_by, manager_action_at, owner_action_by, owner_action_at)
    VALUES
        (demo_cafe_id, pt1_id, 'medical', '2026-09-15', '2026-09-16', 2, 'approved', 'Flu',
         manager_id, NOW() - INTERVAL '5 days', owner_id, NOW() - INTERVAL '4 days'),
        (demo_cafe_id, manager_id, 'annual', '2026-09-20', '2026-09-21', 2, 'approved', 'Long weekend',
         owner_id, NOW() - INTERVAL '3 days', owner_id, NOW() - INTERVAL '3 days');

    INSERT INTO public.leave_requests
        (cafe_id, user_id, leave_type, start_date, end_date, days_requested, status, reason,
         manager_action_by, manager_action_at, owner_action_by, owner_action_at)
    VALUES
        (demo_cafe_id, staff1_id, 'medical', '2026-09-01', '2026-09-01', 1, 'rejected', 'MC not submitted in time',
         manager_id, NOW() - INTERVAL '10 days', NULL, NULL),
        (demo_cafe_id, staff2_id, 'annual', '2026-09-05', '2026-09-09', 5, 'rejected', 'Peak season blackout',
         manager_id, NOW() - INTERVAL '8 days', owner_id, NOW() - INTERVAL '7 days');

    -- ── Medical claims: pending + approved ──────────────────────────────
    INSERT INTO public.medical_claims
        (cafe_id, user_id, receipt_date, amount_claimed, description, receipt_url, status)
    VALUES
        (demo_cafe_id, staff1_id, '2026-09-10', 45.50, 'GP visit - flu',
         'local-seed/receipts/staff1-medical-01.jpg', 'pending');

    INSERT INTO public.medical_claims
        (cafe_id, user_id, receipt_date, amount_claimed, amount_approved, description, receipt_url,
         status, decided_by, decided_at, decision_note)
    VALUES
        (demo_cafe_id, staff2_id, '2026-09-05', 120.00, 120.00, 'Physiotherapy session',
         'local-seed/receipts/staff2-medical-01.jpg', 'approved', manager_id, NOW() - INTERVAL '2 days', NULL);

    -- ── Timesheets + entries: submitted / pending_owner / approved ──────
    INSERT INTO public.timesheets (cafe_id, user_id, month_year, status, employee_signature)
    VALUES (demo_cafe_id, staff1_id, '2026-08', 'submitted', 'Staff Wong')
    RETURNING id INTO ts1_id;

    INSERT INTO public.timesheet_entries (cafe_id, timesheet_id, entry_date, start_time, end_time, break_hours, total_hours)
    VALUES
        (demo_cafe_id, ts1_id, '2026-08-03', '09:00', '18:00', 1, 8),
        (demo_cafe_id, ts1_id, '2026-08-04', '09:00', '17:00', 1, 7);

    INSERT INTO public.timesheets
        (cafe_id, user_id, month_year, status, employee_signature, manager_signature, manager_action_by, manager_action_at)
    VALUES (demo_cafe_id, staff2_id, '2026-08', 'pending_owner', 'Staff Ong', 'Manager Lim',
            manager_id, NOW() - INTERVAL '1 day')
    RETURNING id INTO ts2_id;

    INSERT INTO public.timesheet_entries (cafe_id, timesheet_id, entry_date, start_time, end_time, break_hours, total_hours)
    VALUES
        (demo_cafe_id, ts2_id, '2026-08-05', '10:00', '19:00', 1, 8),
        (demo_cafe_id, ts2_id, '2026-08-06', '10:00', '18:00', 1, 7);

    INSERT INTO public.timesheets
        (cafe_id, user_id, month_year, status, employee_signature, manager_signature,
         manager_action_by, manager_action_at, approved_by, approved_at)
    VALUES (demo_cafe_id, pt1_id, '2026-08', 'approved', 'Parttime Goh', 'Manager Lim',
            manager_id, NOW() - INTERVAL '5 days', owner_id, NOW() - INTERVAL '4 days')
    RETURNING id INTO ts3_id;

    INSERT INTO public.timesheet_entries (cafe_id, timesheet_id, entry_date, start_time, end_time, break_hours, total_hours)
    VALUES
        (demo_cafe_id, ts3_id, '2026-08-07', '14:00', '20:00', 0.5, 5.5),
        (demo_cafe_id, ts3_id, '2026-08-08', '14:00', '20:00', 0.5, 5.5);

    -- ── Tasks: one assigned to everyone, two assigned individually ──────
    INSERT INTO public.tasks (cafe_id, title, description, deadline, assigned_to, status, created_by)
    VALUES (demo_cafe_id, 'Restock napkins and cups', 'Check the storeroom, top up front-of-house supplies',
            NOW() + INTERVAL '2 days', 'all', 'pending', owner_id);

    INSERT INTO public.tasks (cafe_id, title, description, deadline, assigned_to, status, created_by)
    VALUES (demo_cafe_id, 'Deep-clean espresso machine', 'Weekly backflush + descale',
            NOW() + INTERVAL '3 days', staff1_id::text, 'pending', manager_id);

    INSERT INTO public.tasks (cafe_id, title, description, deadline, assigned_to, status, created_by, completed_by, completed_at)
    VALUES (demo_cafe_id, 'Submit weekly rota', 'Rota for next week to owner by Friday',
            NOW() - INTERVAL '1 day', manager_id::text, 'done', owner_id, manager_id, NOW() - INTERVAL '1 day');

    RAISE NOTICE 'Seed complete: cafes demo (%) and second (%)', demo_cafe_id, second_cafe_id;
END $$;
