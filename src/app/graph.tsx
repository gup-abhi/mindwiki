import { useEffect } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { opaqueRouteId } from '@/lib/route-params'

/**
 * Legacy /graph route — redirects to the You tab's Map segment so that
 * deep-links from entry detail (/graph?nodeId=<opaque-id>) still work.
 */
export default function GraphRedirect() {
  const router = useRouter()
  const { nodeId: rawNodeId } = useLocalSearchParams<{ nodeId?: string }>()
  const nodeId = opaqueRouteId(rawNodeId)
  useEffect(() => {
    const params: Record<string, string> = {}
    if (nodeId) params.nodeId = nodeId
    router.replace({ pathname: '/(tabs)/you', params })
  }, [router, nodeId])
  return null
}
