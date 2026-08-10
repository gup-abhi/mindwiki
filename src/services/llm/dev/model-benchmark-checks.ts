export function checkWikiHouseStyle(content: string): string[] {
  const violations: string[] = []
  const lines = content.split('\n').map((line) => line.trim())

  if (/\bI\b|\bI['’](m|ve|ll|d)\b|\bmy\b|\bmine\b/.test(content)) {
    violations.push('first-person voice')
  }
  if (lines.some((line) => /^#{1,6}\s/.test(line))) {
    violations.push('markdown heading')
  }
  const label = /^(situation|thought|behaviou?r|current page|new reflection|reframe lens|thinking pattern|feeling):/i
  if (lines.some((line) => label.test(line))) {
    violations.push('section label')
  }
  return violations
}

function countSentences(text: string): number {
  return text
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean).length
}

function countQuestions(text: string): number {
  return (text.match(/\?+/g) ?? []).length
}

export function checkReflectReply(reply: string): string[] {
  const violations: string[] = []
  const text = reply.trim()

  if (text === '') return ['empty']
  if (countSentences(text) > 4) violations.push('too long')
  if (countQuestions(text) > 1) violations.push('multiple questions')

  const scaffolding = [
    /background from their wiki/i,
    /^\s*pages:\s*$/im,
    /^\s*connections:\s*$/im,
    /\[\d+\]\s/,
    /^\s*system:/im,
  ]
  if (scaffolding.some((re) => re.test(text))) violations.push('scaffolding leak')

  const clinical = [
    /\byou (have|'ve got|are suffering from)\s+(depression|anxiety disorder|bipolar|ptsd|ocd|adhd)\b/i,
    /\bI('?m)?\s+(diagnos|can diagnose)/i,
    /\b(should|need to)\s+take\s+(medication|antidepressants?|an?\s+ssri)\b/i,
  ]
  if (clinical.some((re) => re.test(text))) violations.push('clinical language')
  const deflection = [
    /\b(talk|talking|speak|speaking|reach out|reaching out|open up|opening up)\s+(to|with)\s+(someone|somebody|a friend|a therapist|a counsellor|a counselor|a professional|your (friend|family|parents|partner|doctor))\b/i,
    /\bconsider(ed|ing)? (seeing|telling|talking to)\b/i,
    /\bshare (this|it|that) with\b/i,
  ]
  if (deflection.some((re) => re.test(text))) violations.push('deflection')

  return violations
}
