import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CareerDeckProvider } from '@/context/CareerDeckContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <CareerDeckProvider>
            <RootNavigator />
          </CareerDeckProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Split out from RootLayout so it sits *inside* ThemeProvider and can repaint the
 * navigator chrome — screen backgrounds and the native modal headers — along with
 * everything else when the scheme flips.
 */
function RootNavigator() {
  const { scheme, colors } = useTheme();

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="job/[id]" options={{ presentation: 'modal', title: 'Job details' }} />
        <Stack.Screen name="company/[id]" options={{ title: '' }} />
      </Stack>
    </>
  );
}
