/**
 * Push on the device — phase 7's client half of §15's push notifications.
 *
 * Three jobs: ask for permission (only when the reader turns push on, never at launch — a cold
 * permission prompt is the one users most often refuse, and a refusal is permanent until they dig
 * through Settings), register the device's Expo token against the account, and route a tapped
 * notification to the screen it is about.
 *
 * ── What is needed for a token ────────────────────────────────────────────────
 *
 * Expo push tokens are issued per EAS project, so `getExpoPushTokenAsync` needs the project id
 * from `eas init`. Until that exists, `enablePush` reports `no_project` and the toggle says so;
 * nothing else in the app depends on push. Android push also needs a development build (Expo Go
 * dropped remote notifications on Android in SDK 53); iOS Expo Go still receives them.
 */

import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { registerPushToken, unregisterPushToken } from '@/lib/api';
import { reportError } from '@/lib/observability';

Notifications.setNotificationHandler({
  // In the foreground, show it as a banner: the inbox already updates by itself, but a reply
  // arriving while the reader is on another tab is exactly what the banner is for.
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let currentToken: string | null = null;

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

export type PushOutcome = 'enabled' | 'denied' | 'no_project' | 'unsupported' | 'failed';

async function tokenAndRegister(): Promise<PushOutcome> {
  const id = projectId();
  if (!id) return 'no_project';

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'CareerDeck',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await registerPushToken(data, Platform.OS === 'ios' ? 'ios' : 'android');
    currentToken = data;
    return 'enabled';
  } catch (error) {
    reportError(error, { where: 'push.register' });
    return 'failed';
  }
}

/** Asks for permission if needed, then registers this device. Called by the Settings toggle. */
export async function enablePush(): Promise<PushOutcome> {
  if (Platform.OS === 'web') return 'unsupported';

  const existing = await Notifications.getPermissionsAsync();
  const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return 'denied';

  return tokenAndRegister();
}

/**
 * On launch: refresh the registration if permission was already granted, without ever prompting.
 * Tokens rotate, and a token last registered months ago may be one Expo no longer accepts.
 */
export async function refreshPushRegistration(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { granted } = await Notifications.getPermissionsAsync();
  if (!granted) return false;
  return (await tokenAndRegister()) === 'enabled';
}

/** The Settings toggle's off position, and sign-out: this device stops receiving this account's pushes. */
export async function disablePush(): Promise<void> {
  const token = currentToken;
  currentToken = null;
  if (token) await unregisterPushToken(token).catch((error) => reportError(error, { where: 'push.unregister' }));
}

export async function pushPermissionGranted(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  return (await Notifications.getPermissionsAsync()).granted;
}

/**
 * Calls `navigate` with the route of every tapped notification, including the one that launched a
 * cold app. The server puts the route in `data.url` (`server/src/notify/push.ts`).
 */
export function onNotificationTap(navigate: (url: string) => void): () => void {
  // No push on web, and expo-notifications throws from both calls below there — which, from the
  // root layout, took down the whole web build rather than just this feature.
  if (Platform.OS === 'web') return () => {};

  const route =(response: Notifications.NotificationResponse | null) => {
    const url = response?.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) navigate(url);
  };

  void Notifications.getLastNotificationResponseAsync().then(route);
  const subscription = Notifications.addNotificationResponseReceivedListener(route);
  return () => subscription.remove();
}
