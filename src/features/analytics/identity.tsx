import { useUser } from '@clerk/tanstack-react-start'
import { useEffect, useRef } from 'react'
import { posthog } from './analytics'

export function AnalyticsIdentity() {
  const { isLoaded, isSignedIn, user } = useUser()
  const identifiedRef = useRef(false)
  const userId = user?.id
  const email = user?.primaryEmailAddress?.emailAddress

  useEffect(() => {
    if (!isLoaded) return

    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || !posthog.__loaded) return

      if (isSignedIn && userId) {
        if (posthog.get_distinct_id() !== userId) {
          posthog.identify(userId, { email })
        }
        identifiedRef.current = true
      } else if (identifiedRef.current) {
        posthog.reset()
        identifiedRef.current = false
      }
    })

    return () => {
      cancelled = true
    }
  }, [email, isLoaded, isSignedIn, userId])

  return null
}
