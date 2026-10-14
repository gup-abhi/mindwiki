import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e) => {
    await $.command.register({
      name: 'handoff',
      description: 'Summarize the current task, changed files, verification, and open items.',
    })
    return { cwd: e.cwd }
  })

  on('command.run', { command: 'handoff' }, async ($) => {
    const cwd = await $.session.cwd()
    const [branch, changes, recent] = await Promise.all([
      $.process.run(['git', 'branch', '--show-current'], { cwd }),
      $.process.run(['git', 'status', '--short'], { cwd }),
      $.session.messages({ as: 'api' }),
    ])
    const userPrompts = recent.filter(message => message.role === 'user').slice(-4)
    const promptSummary = userPrompts.map(message => message.text.slice(0, 240)).join('\n')
    const files = changes.stdout.trim() || 'No uncommitted changes.'
    const lastUserText = userPrompts.at(-1)?.text.slice(0, 500) ?? 'No recent user prompt available.'

    return {
      text: [
        `Branch: ${branch.stdout.trim() || '(detached / unavailable)'}`,
        `Working tree:\n${files}`,
        `Recent task context:\n${promptSummary || 'No recent user prompts available.'}`,
        `Latest request:\n${lastUserText}`,
        'Verification: check the transcript for tests or /verify completed; this command does not infer that tests passed.',
        'Open items: review the latest request and working-tree diff for anything unfinished.',
      ].join('\n\n'),
    }
  })
}
