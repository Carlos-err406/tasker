import { Link, Stack } from 'expo-router';
import { View, Text } from 'react-native';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#09090b', padding: 20 }}>
        <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#fafafa' }}>This screen doesn't exist.</Text>
        <Link href="/" style={{ marginTop: 15, paddingVertical: 15 }}>
          <Text style={{ fontSize: 14, color: '#3b82f6' }}>Go to home screen</Text>
        </Link>
      </View>
    </>
  );
}
