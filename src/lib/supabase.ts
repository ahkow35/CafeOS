import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// Browser-only singleton — do NOT import in Server Components or API route handlers.
// Those require a per-request client with cookie context (use @supabase/ssr createServerClient).
let client: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
    if (!client) {
        client = createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
    }
    return client;
}
