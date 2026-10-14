import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e) => {
    const result = await $.process.run(['git', 'status', '--short', '--branch'])
    const lines = result.stdout.split('\n')
    const firstLine = lines[0]
    const branch = result.exitCode === 0 ? firstLine?.replace(/^##\s*/, '').split('...')[0] : undefined
    const dirty = lines.some(line => line && !line.startsWith('## '))
    $.ui.status(branch ? `Git: ${branch}${dirty ? ' • dirty' : ''}` : 'Git: unavailable')
    return { cwd: e.cwd }
  })
}
