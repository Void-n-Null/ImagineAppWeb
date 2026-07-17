import { createServerFn } from '@tanstack/react-start'
import { requireUser, UnauthorizedError } from '#/server/auth'
import { getBalanceState } from '#/server/credits/ledger'
import { getDb } from '#/server/db'

/**
 * The signed-in user's credit balance for the Settings surface (IMA-32,
 * IMA-16 #366). One indexed query (getBalanceState is a single SELECT), so
 * there's nothing to cache — TanStack Query on the client handles staleness.
 *
 * Error-VALUE idiom like every function here: signed-out is a `signed_out`
 * status the UI renders as a sign-in prompt, not a thrown error the caller
 * has to catch. `granted` distinguishes the waitlist (no grant row) from an
 * empty wallet (grant issued, credits spent) so the UI can say the honest
 * thing for each (IMA-16 #366).
 */
export type GetBalanceResult =
  | {
      status: 'ok'
      /** Display credits: floor(balance / $0.005), computed in SQL. */
      credits: number
      /** False = waitlisted (no grant row yet); true = grant issued. */
      granted: boolean
      email: string | null
    }
  | { status: 'signed_out' }

export const getBalance = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GetBalanceResult> => {
    let user: Awaited<ReturnType<typeof requireUser>>
    try {
      user = await requireUser()
    } catch (err) {
      if (err instanceof UnauthorizedError) return { status: 'signed_out' }
      throw err
    }

    const state = await getBalanceState(getDb(), user.id)
    return {
      status: 'ok',
      credits: state.credits,
      granted: state.granted,
      email: user.email,
    }
  },
)
