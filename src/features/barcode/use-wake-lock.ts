import { useEffect } from 'react'

/**
 * Hold a screen wake lock while mounted (register surfaces: scan mode,
 * the POS sheet). Wake locks auto-release when the tab is hidden (OS
 * behavior) — re-acquire on return. No-ops silently on browsers without
 * the API; the brightness hint copy still stands.
 */
export function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let disposed = false

    const acquire = () => {
      navigator.wakeLock
        ?.request('screen')
        .then((sentinel) => {
          if (disposed) void sentinel.release()
          else lock = sentinel
        })
        .catch(() => {}) // low battery / not allowed — hint copy covers us
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      void lock?.release().catch(() => {})
    }
  }, [])
}
