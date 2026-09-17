import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { CareerDeckProvider } from '@/context/CareerDeckContext';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <CareerDeckProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="job/[id]"
              options={{ presentation: 'modal', title: 'Job details' }}
            />
            <Stack.Screen
              name="news/[id]"
              options={{ presentation: 'modal', title: 'News' }}
            />
          </Stack>
        </CareerDeckProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
