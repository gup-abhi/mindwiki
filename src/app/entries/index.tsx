import { useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, ScrollView, SectionList, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Button, Chip, EmptyState, Screen, Text, TextField } from '@/components/ui'
import { EntryCard } from '@/components/journal/EntryCard'
import { groupEntriesByDay } from '@/components/journal/grouping'
import { useEntryArchive } from '@/hooks/useEntries'
import { type Theme, useTheme, useThemedStyles } from '@/theme'

export default function EntriesScreen() {
  const router = useRouter()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const {
    entries,
    query,
    emotion,
    loading,
    loadingMore,
    error,
    total,
    emotions,
    setQuery,
    setEmotion,
    loadMore,
    refresh,
  } = useEntryArchive()
  const [searchOpen, setSearchOpen] = useState(false)
  const sections = useMemo(() => groupEntriesByDay(entries, Date.now()), [entries])
  const hasFilters = query.trim() !== '' || emotion !== null

  const toggleSearch = () => {
    setSearchOpen((open) => {
      if (open) setQuery('')
      return !open
    })
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.back}
          testID="entries-back"
        >
          <Ionicons name="arrow-back" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <View style={styles.heading}>
          <Text variant="title">Entries</Text>
          <Text variant="caption" color="textMuted">
            {total} journal {total === 1 ? 'entry' : 'entries'}
          </Text>
        </View>
        <Button
          title="New"
          size="sm"
          icon="add"
          onPress={() => router.push('/entry')}
          testID="entries-new"
        />
      </View>
      <View style={styles.filterBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={searchOpen ? 'Close search' : 'Search entries'}
          onPress={toggleSearch}
          testID="entries-search-toggle"
          style={styles.searchBtn}
        >
          <Ionicons
            name={searchOpen ? 'close' : 'search'}
            size={20}
            color={searchOpen ? theme.colors.accent : theme.colors.textSecondary}
          />
          <Text variant="label" color={searchOpen ? 'accent' : 'textSecondary'}>
            {searchOpen ? 'Close' : 'Search'}
          </Text>
        </Pressable>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          accessibilityLabel="Entry feeling filters"
        >
          <Chip
            label="All"
            selected={emotion === null}
            onPress={() => setEmotion(null)}
            testID="entries-filter-All"
          />
          {emotions.map((item) => (
            <Chip
              key={item}
              label={item}
              selected={emotion === item}
              onPress={() => setEmotion(item === emotion ? null : item)}
              testID={`entries-filter-${item}`}
            />
          ))}
        </ScrollView>
      </View>
      {searchOpen && (
        <View style={styles.searchField}>
          <TextField
            sensitive
            accessibilityLabel="Search your entries"
            placeholder="Search your entries"
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCapitalize="none"
            returnKeyType="search"
            testID="entries-search"
          />
        </View>
      )}
    </View>
  )

  return (
    <Screen padded={false} animated={false}>
      <View style={styles.container}>
        {header}
        {loading && entries.length === 0 ? (
          <View style={styles.center} accessibilityLabel="Loading entries">
            <ActivityIndicator size="large" color={theme.colors.accent} />
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(entry) => entry.id}
            stickySectionHeadersEnabled
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
            renderSectionHeader={({ section }) => (
              <Text variant="label" color="textSecondary" style={styles.sectionHeader}>
                {section.title}
              </Text>
            )}
            renderItem={({ item }) => (
              <EntryCard entry={item} onPress={() => router.push(`/entries/${item.id}`)} />
            )}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              error && entries.length > 0 ? (
                <View style={styles.footer}>
                  <Text variant="caption" color="danger">{error.message}</Text>
                  <Button title="Try again" size="sm" variant="ghost" onPress={() => void refresh()} testID="entries-retry-more" />
                </View>
              ) : loadingMore ? (
                <ActivityIndicator color={theme.colors.accent} style={styles.footerSpinner} accessibilityLabel="Loading more entries" />
              ) : null
            }
            ListEmptyComponent={
              error ? (
                <View style={styles.emptyWrap}>
                  <EmptyState title="Couldn’t load entries" message="Your journal is still safe on this device." />
                  <Button title="Try again" onPress={() => void refresh()} testID="entries-retry" />
                </View>
              ) : hasFilters ? (
                <View style={styles.emptyWrap}>
                  <EmptyState title="No entries match your search" />
                  <Button title="Clear filters" variant="secondary" onPress={() => { setQuery(''); setEmotion(null) }} testID="entries-clear" />
                </View>
              ) : (
                <View style={styles.emptyWrap}>
                  <EmptyState title="No entries yet" message="Start with a quick check-in." />
                  <Button title="New entry" onPress={() => router.push('/entry')} testID="entries-empty-new" />
                </View>
              )
            }
          />
        )}
      </View>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1 },
    content: { paddingBottom: t.spacing['3xl'] },
    header: { paddingTop: t.spacing.lg, paddingHorizontal: t.spacing.xl, paddingBottom: t.spacing.md, gap: t.spacing.md },
    filterBar: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
    searchBtn: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs, paddingVertical: t.spacing.xs },
    searchField: { marginTop: -t.spacing.xs },
    topRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
    back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    heading: { flex: 1 },
    chipsLabel: { marginTop: t.spacing.xs },
    chips: { gap: t.spacing.sm, paddingRight: t.spacing.xl },
    sectionHeader: { paddingHorizontal: t.spacing.xl, paddingTop: t.spacing.lg, paddingBottom: t.spacing.xs, backgroundColor: t.colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyWrap: { alignItems: 'center', paddingHorizontal: t.spacing.xl },
    footer: { alignItems: 'center', gap: t.spacing.xs, padding: t.spacing.lg },
    footerSpinner: { padding: t.spacing.lg },
  })