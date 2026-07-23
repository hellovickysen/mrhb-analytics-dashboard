import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

/**
 * Supabase client for use in Server Components, Server Actions, and Route Handlers.
 *
 * Reads/writes auth cookies via next/headers `cookies()` so sessions stay in
 * sync between the browser and the server.
 */
export function createClient() {
  const cookieStore = cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options })
          } catch {
            // The `set` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options })
          } catch {
            // The `delete` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}

/**
 * Service-role Supabase client that bypasses Row Level Security.
 *
 * Use this for dashboard data reads — RLS is enabled on all analytics tables
 * with no policies defined, so the anon key returns empty results. The
 * service-role key bypasses RLS entirely.
 *
 * Safe to use here because the dashboard has its own cookie-based auth
 * (middleware.ts checks mrhb_user cookie before any route loads).
 */
let _serviceClient: ReturnType<typeof createSupabaseClient> | null = null

export function createServiceClient() {
  if (_serviceClient) return _serviceClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    console.warn('Missing SUPABASE_SERVICE_ROLE_KEY — falling back to anon client')
    return createClient()
  }

  _serviceClient = createSupabaseClient(url, key)
  return _serviceClient
}
