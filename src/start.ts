import { clerkMiddleware } from '@clerk/tanstack-react-start/server'
import { createStart } from '@tanstack/react-start'

/**
 * Start instance (IMA-27): clerkMiddleware() attaches auth state to every
 * server function / server route request, which is what makes `auth()` work
 * inside src/server/auth.ts. No routes are protected here — protection is
 * opt-in at each server function via requireUser().
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [clerkMiddleware()],
}))
