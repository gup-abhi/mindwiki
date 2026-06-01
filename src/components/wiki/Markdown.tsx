import { StyleSheet, Text, View } from 'react-native'

// Minimal block-level markdown renderer (no dependency): headings, bullets, and
// paragraphs. Inline emphasis markers are stripped. Enough for the short
// synthesized page content; richer rendering can swap in a lib later.
function stripInline(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
}

export function Markdown({ content }: { content: string }) {
  const lines = content.split('\n')
  return (
    <View>
      {lines.map((line, i) => {
        const t = line.trim()
        if (t === '') return <View key={i} style={styles.gap} />
        if (t.startsWith('### ')) return <Text key={i} style={styles.h3}>{stripInline(t.slice(4))}</Text>
        if (t.startsWith('## ')) return <Text key={i} style={styles.h2}>{stripInline(t.slice(3))}</Text>
        if (t.startsWith('# ')) return <Text key={i} style={styles.h1}>{stripInline(t.slice(2))}</Text>
        if (/^[-*]\s/.test(t)) {
          return (
            <Text key={i} style={styles.bullet}>
              {'• '}
              {stripInline(t.replace(/^[-*]\s/, ''))}
            </Text>
          )
        }
        return <Text key={i} style={styles.p}>{stripInline(t)}</Text>
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  gap: { height: 10 },
  h1: { fontSize: 22, fontWeight: '700', color: '#1a1a2e', marginTop: 8, marginBottom: 4 },
  h2: { fontSize: 19, fontWeight: '700', color: '#1a1a2e', marginTop: 8, marginBottom: 4 },
  h3: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginTop: 6, marginBottom: 2 },
  p: { fontSize: 16, color: '#222', lineHeight: 24 },
  bullet: { fontSize: 16, color: '#222', lineHeight: 24, marginLeft: 8 },
})
