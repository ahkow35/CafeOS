-- Lock down medical_certificates bucket: public → private.
-- Previously both a public-read and an authenticated-read policy existed,
-- making every uploaded medical cert world-readable. This migration:
--   1. Flips the bucket to private.
--   2. Drops the overly permissive policies.
--   3. Recreates scoped policies: owner of the file + managers/owners can read.

UPDATE storage.buckets SET public = false WHERE id = 'medical_certificates';

DROP POLICY IF EXISTS "Allow public read access" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view MCs" ON storage.objects;

CREATE POLICY "MC read: owner or manager/owner" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'medical_certificates'
    AND (owner = auth.uid() OR public.is_manager_or_owner())
  );
