import { createBrowserClient } from '@supabase/ssr';

// Create a Supabase client without strict typing to avoid TS inference issues
// Types are applied manually where needed via casting
export function createClient() {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
}
