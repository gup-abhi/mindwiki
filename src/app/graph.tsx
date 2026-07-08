import { useEffect } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'

/**
 * Legacy /graph route — redirects to the You tab's Map segment so that
 * deep-links from entry detail (/graph?focus=<label>) still work.
 */
export default function GraphRedirect() {
  const router = useRouter()
  const { focus } = useLocalSearchParams<{ focus?: string }>()
  useEffect(() => {
    const params: Record<string, string> = {}
    if (typeof focus === 'string') params.focus = focus
    router.replace({ pathname: '/(tabs)/you', params })
  }, [router, focus])
  return null
}
