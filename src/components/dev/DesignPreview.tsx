import { StyleSheet, View } from 'react-native'

import {
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  IconButton,
  ListRow,
  ProgressBar,
  Screen,
  SegmentedControl,
  Text,
  TextField,
} from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'

interface DesignPreviewProps {
  onClose: () => void
}

export function DesignPreview({ onClose }: DesignPreviewProps) {
  const styles = useThemedStyles(makeStyles)

  return (
    <Screen scroll>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          color="accent"
          accessibilityLabel="Close design preview"
          onPress={onClose}
          testID="design-preview-close"
        />
        <Text accessibilityRole="header" variant="title">
          Design preview
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <Text variant="body" color="textSecondary" style={styles.intro}>
        Static, non-sensitive examples of the Quiet Editorial interface contract.
      </Text>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Type and surfaces
      </Text>
      <Card variant="surface" style={styles.group}>
        <Text variant="title">Reflective title</Text>
        <Text variant="body" color="textSecondary">
          Reading content keeps a calm serif hierarchy while controls stay clear and compact.
        </Text>
        <Divider />
        <Text variant="caption" color="textMuted">
          Secondary metadata remains quiet and does not compete with the next helpful action.
        </Text>
      </Card>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Actions
      </Text>
      <Card variant="sunken" style={styles.group}>
        <Button title="Primary action" fullWidth onPress={() => undefined} testID="design-preview-primary" />
        <Button title="Secondary action" variant="secondary" fullWidth onPress={() => undefined} />
        <Button title="Quiet action" variant="ghost" fullWidth onPress={() => undefined} />
        <Button title="Unavailable action" disabled fullWidth onPress={() => undefined} />
      </Card>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Selection and navigation
      </Text>
      <Card variant="surface" style={styles.group}>
        <SegmentedControl
          options={[
            { key: 'one', label: 'One', testID: 'design-preview-tab-one' },
            { key: 'two', label: 'Two', testID: 'design-preview-tab-two' },
            { key: 'three', label: 'Three', testID: 'design-preview-tab-three' },
          ]}
          selectedKey="one"
          onChange={() => undefined}
          testID="design-preview-tabs"
        />
        <View style={styles.chips}>
          <Chip label="Selected" selected onPress={() => undefined} />
          <Chip label="Available" onPress={() => undefined} />
          <Chip label="Static" />
        </View>
        <ListRow title="A navigable row" subtitle="With supporting context" onPress={() => undefined} />
      </Card>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Forms and states
      </Text>
      <Card variant="surface" style={styles.group}>
        <TextField label="A private field" placeholder="Enter a value" sensitive />
        <Text variant="caption" color="danger">
          An example validation message that explains what to do next.
        </Text>
        <EmptyState icon="book-outline" title="Nothing here yet" message="A calm explanation belongs with an empty state." />
      </Card>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Truthful status
      </Text>
      <Card variant="sunken" style={styles.group}>
        <Text variant="bodyStrong">Processing on this device</Text>
        <Text variant="caption" color="textSecondary" style={styles.statusText}>
          Your content is saved. Insight synthesis is still running.
        </Text>
        <ProgressBar progress={0.6} />
      </Card>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerSpacer: { width: 48 },
    intro: { marginTop: t.spacing.sm },
    section: { marginTop: t.spacing['2xl'], marginBottom: t.spacing.sm, textTransform: 'uppercase' },
    group: { gap: t.spacing.md },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
    statusText: { marginTop: -t.spacing.sm },
  })
