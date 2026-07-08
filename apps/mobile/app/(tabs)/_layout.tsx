import { Tabs } from 'expo-router';
import { List, Search, Trash2 } from 'lucide-react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#3b82f6',
        tabBarStyle: { backgroundColor: '#09090b', borderTopColor: '#27272a' },
        tabBarInactiveTintColor: '#71717a',
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Lists',
          tabBarIcon: ({ color, size }) => <List size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color, size }) => <Search size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="trash"
        options={{
          title: 'Trash',
          tabBarIcon: ({ color, size }) => <Trash2 size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
