import { z } from 'zod'

// Deep-model page synthesis returns markdown directly (no JSON wrapper — avoids
// escaping issues for long content). Validate it's non-empty and bounded.
export const WikiContentSchema = z.string().trim().min(1).max(4000)

export type WikiContent = z.infer<typeof WikiContentSchema>
