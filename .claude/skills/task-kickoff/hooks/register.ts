import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', ($, e) => {
    $.ui.status('MindWiki: Graphify → SPEC/PSEUDO/ARCH → TDD → /verify')
    return { cwd: e.cwd }
  })
  on('turn.complete', ($, e) => {
    if (e.agentId === undefined && e.reason === 'answer') {
      $.ui.status('MindWiki: run /verify before wrapping up code changes')
    }
    return { text: e.answer }
  })
}
