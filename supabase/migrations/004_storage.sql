-- Create 'medical_certificates' bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('medical_certificates', 'medical_certificates', true)
ON CONFLICT (id) DO NOTHING;

-- Remove the ALTER TABLE line (RLS is already enabled by Supabase internally)

-- Drop existing policies to avoid name conflicts if re-running
DROP POLICY IF EXISTS "Authenticated users can upload MCs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view MCs" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own MCs" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own MCs" ON storage.objects;

-- Allow authenticated users to upload files to 'medical_certificates'
CREATE POLICY "Authenticated users can upload MCs" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'medical_certificates');

-- Allow authenticated users to view MCs (e.g. managers/owners)
CREATE POLICY "Authenticated users can view MCs" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'medical_certificates');

-- Allow users to update/delete their own files
CREATE POLICY "Users can update own MCs" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'medical_certificates' AND auth.uid() = owner);

CREATE POLICY "Users can delete own MCs" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'medical_certificates' AND auth.uid() = owner);
