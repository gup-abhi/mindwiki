import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet } from 'react-native'

import { useTheme } from '@/theme'
import { haptics } from '@/lib/haptics'

/** Bottom tab bar: Home / You / Reflect / Settings, themed. */
export default function TabsLayout() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const tabBarStyle = StyleSheet.create({
    bar: {
      minHeight: 56 + insets.bottom,
      paddingTop: theme.spacing.xs,
      paddingBottom: insets.bottom,
      backgroundColor: theme.colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      elevation: 0,
      shadowOpacity: 0,
    },
    item: {
      minHeight: 48,
    },
  })
  return (
    <Tabs
      screenListeners={{ tabPress: () => haptics.select() }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: tabBarStyle.bar,
        tabBarItemStyle: tabBarStyle.item,
        tabBarLabelStyle: {
          fontFamily: theme.fontFamily.uiSemibold,
          fontSize: 11,
          lineHeight: 14,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarAccessibilityLabel: 'Home',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: 'You',
          tabBarAccessibilityLabel: 'You',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'apps' : 'apps-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="query"
        options={{
          title: 'Reflect',
          tabBarAccessibilityLabel: 'Reflect',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarAccessibilityLabel: 'Settings',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'settings' : 'settings-outline'} color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  )
}
