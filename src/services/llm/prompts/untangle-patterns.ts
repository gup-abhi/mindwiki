/**
 * Fast-model instruction: suggest at most two cognitive-distortion labels (from
 * the controlled CBT taxonomy) that might fit the user's thought. Output is
 * ONLY a JSON object with a "patterns" array. Suggestions are framed as
 * observations, not diagnoses. Runs on-device only; the thought never leaves
 * the device.
 */
export function buildUntanglePatternsPrompt(thought: string): string {
  return [
    'You help someone gently notice patterns in a difficult thought using CBT.',
    '',
    'Suggest at most two cognitive distortion labels (from the list below) that',
    'might fit this thought. If none fit, return an empty list.',
    '',
    'Rules:',
    '- Use only labels from the list.',
    '- Return them as a JSON object: {"patterns": ["label1", "label2"]}',
    '- Return at most two.',
    '- Frame suggestions, not verdicts — the user chooses what fits.',
    '',
    'Available labels:',
    [
      'All-or-nothing thinking',
      'Overgeneralization',
      'Mental filter',
      'Discounting the positive',
      'Jumping to conclusions',
      'Mind reading',
      'Catastrophizing',
      'Emotional reasoning',
      'Should statements',
      'Labeling',
      'Personalization',
      'Blaming',
    ].join(', '),
    '',
    `The thought: ${thought}`,
    '',
    'JSON:',
  ].join('\n')
}
