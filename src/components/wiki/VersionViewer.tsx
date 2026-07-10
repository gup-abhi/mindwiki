import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui'
import { Markdown } from '@/components/wiki/Markdown'
import { type Theme, useThemedStyles } from '@/theme'

interface VersionInfo {
  version: number
  content: string
  updated_at: number
}

interface Props {
  version: VersionInfo
  /** How many entries had shaped the page at this point (optional, for display). */
  entryCount?: number | null
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Read-only viewer for a single past wiki version. Shows the version header
 * (number + date) and the full markdown content. No edit or dismiss actions.
 */
export const VersionViewer = ({ version, entryCount }: Props) => {
  const styles = useThemedStyles(makeStyles)

  return (
    <View style={styles.container} testID="version-viewer">
      <View style={styles.header}>
        <Text variant="label" color="accent">
          Version {version.version}
        </Text>
        <Text variant="caption" color="textMuted">
          {formatDate(version.updated_at)}
          {entryCount != null ? ` · ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}` : ''}
        </Text>
      </View>
      <Markdown content={version.content} />
    </View>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.border,
      paddingTop: t.spacing.md,
      gap: t.spacing.sm,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
  })
