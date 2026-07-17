/**
 * One-time cleanup of retired BYOK/PKCE storage (IMA-16 #367). The
 * OpenRouter-key feature is gone (the loop runs on the server pool key now),
 * but users who connected under the old flow still have their exchanged key
 * sitting in localStorage. Evict it on boot so a stale, now-unused credential
 * doesn't linger on the device.
 *
 * These are the ONLY survivors of the deleted feature: the exact storage keys
 * it used, kept here purely so we can remove them. Idempotent and cheap —
 * localStorage.removeItem on an absent key is a no-op, so this can run every
 * boot without a flag.
 */

/** localStorage key the retired feature stored the exchanged OpenRouter key in. */
const RETIRED_OPENROUTER_KEY = 'imagine:openrouter-key'
/** sessionStorage key the retired PKCE flow stashed the code_verifier in. */
const RETIRED_OPENROUTER_VERIFIER = 'imagine:openrouter-verifier'

/** Remove any lingering BYOK credentials from this device. Safe to call anytime. */
export function cleanupRetiredByok(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(RETIRED_OPENROUTER_KEY)
    sessionStorage.removeItem(RETIRED_OPENROUTER_VERIFIER)
  } catch {
    // Private-mode / disabled storage — nothing to clean, nothing to do.
  }
}
