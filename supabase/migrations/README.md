# Database Migrations

This directory contains the sequential database migration files for CafeOS.

## Migration Files

Execute these migrations in order on your Supabase instance:

1. **001_schema.sql** - Core database schema (users, leave_requests, tasks tables)
2. **002_2level_approval.sql** - Two-level approval workflow (manager → owner)
3. **003_medical_evidence.sql** - Medical certificate attachment support
4. **004_storage.sql** - File storage bucket configuration for medical certificates
5. **005_email_notifications.sql** - Email notification system setup

## How to Apply Migrations

### Via Supabase Dashboard

1. Go to your Supabase project
2. Navigate to **SQL Editor**
3. Copy and paste each migration file in order
4. Execute each one sequentially

### Via Supabase CLI (if using local development)

```bash
supabase db push
```

## Important Notes

> [!WARNING]
> These migrations should be run in order. Do not skip or reorder them.

> [!IMPORTANT]
> The schema includes Row Level Security (RLS) policies. Make sure your project has RLS enabled.

## Migration History

These migrations represent the production-ready state of the database after development iterations. Previous debug and fix scripts have been removed for production deployment.
