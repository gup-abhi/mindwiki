import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'

// Minimal block-level markdown renderer (no dependency): headings, bullets, and
// paragraphs. Inline emphasis markers are stripped. Enough for the short
// synthesized page content; richer rendering can swap in a lib later.
function stripInline(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
}

export function Markdown({ content }: { content: string }) {
  const styles = useThemedStyles(makeStyles)
  const lines = content.split('\n')
  return (
    <View>
      {lines.map((line, i) => {
        const t = line.trim()
        if (t === '') return <View key={i} style={styles.gap} />
        if (t.startsWith('### '))
          return (
            <Text key={i} variant="bodyStrong" style={styles.heading}>
              {stripInline(t.slice(4))}
            </Text>
          )
        if (t.startsWith('## '))
          return (
            <Text key={i} variant="subtitle" style={styles.heading}>
              {stripInline(t.slice(3))}
            </Text>
          )
        if (t.startsWith('# '))
          return (
            <Text key={i} variant="heading" style={styles.heading}>
              {stripInline(t.slice(2))}
            </Text>
          )
        if (/^[-*]\s/.test(t)) {
          return (
            <Text key={i} variant="body" style={styles.bullet}>
              {'• '}
              {stripInline(t.replace(/^[-*]\s/, ''))}
            </Text>
          )
        }
        return (
          <Text key={i} variant="body">
            {stripInline(t)}
          </Text>
        )
      })}
    </View>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    gap: { height: t.spacing.sm },
    heading: { marginTop: t.spacing.sm, marginBottom: t.spacing.xs },
    bullet: { marginLeft: t.spacing.sm },
  })
