import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { FlatList, Pressable, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Screen, Text, TextField } from '@/components/ui'
import { EntryCard } from '@/components/journal/EntryCard'
import { searchEntries, type Entry } from '@/services/storage/entries'
import { type Theme, useTheme, useThemedStyles } from '@/theme'

export default function SearchScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Entry[]>([])

  // Debounced search as you type; a blank query returns nothing.
  useEffect(() => {
    let active = true
    const t = setTimeout(async () => {
      const res = await searchEntries(query)
      if (active && res.success) setResults(res.data)
    }, 200)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [query])

  const blank = query.trim() === ''

  return (
    <Screen padded={false} animated={false}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={26} color={theme.colors.textPrimary} />
        </Pressable>
        <View style={styles.field}>
          <TextField
            placeholder="Search your entries"
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCapitalize="none"
            returnKeyType="search"
            testID="search-input"
          />
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <EntryCard entry={item} onPress={() => router.push(`/entries/${item.id}`)} />
        )}
        ListEmptyComponent={
          <Text variant="body" color="textMuted" style={styles.empty}>
            {blank ? 'Search across everything you’ve written.' : `No entries match “${query.trim()}”.`}
          </Text>
        }
      />
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.md,
      paddingHorizontal: t.spacing.xl,
      paddingTop: t.spacing.sm,
      paddingBottom: t.spacing.md,
    },
    field: { flex: 1 },
    list: { paddingBottom: t.spacing['2xl'] },
    empty: { textAlign: 'center', marginTop: t.spacing['2xl'], paddingHorizontal: t.spacing.xl },
  })
