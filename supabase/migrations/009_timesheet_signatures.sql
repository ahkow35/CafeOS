-- Add employee and manager signature fields to timesheets
ALTER TABLE timesheets
  ADD COLUMN IF NOT EXISTS employee_signature TEXT,
  ADD COLUMN IF NOT EXISTS manager_signature TEXT;
