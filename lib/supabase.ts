import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import * as aesjs from 'aes-js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * The Supabase client, and the one place the session is persisted.
 *
 * Reads that RLS can express go through this client directly; anything needing a secret,
 * the ranking engine, or Auto Apply orchestration goes to the API service instead
 * (docs/README.md §2.1). In phase 0 everything is the former.
 */

/**
 * Keeps the session encrypted at rest without hitting SecureStore's size limit.
 *
 * A Supabase session is a few kilobytes of JWT; SecureStore warns above 2048 bytes and
 * is not built for values that size. So the session is encrypted with a random AES key,
 * the ciphertext goes to AsyncStorage, and only the 32-byte key — which is small, and
 * the only part worth protecting — goes to the Keychain / Keystore. Losing either half
 * makes the other useless.
 *
 * This is the pattern from Supabase's own Expo guide.
 */
class LargeSecureStore implements SupportedStorage {
  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = Crypto.getRandomBytes(256 / 8);
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));

    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));

    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) return null;

    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1),
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));

    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;

    try {
      return await this.decrypt(key, encrypted);
    } catch {
      // A half-written or key-less entry can only ever decrypt to garbage. Clearing it
      // costs the user one sign-in; leaving it makes the app un-startable until they
      // reinstall, because every launch would throw on the same bytes.
      await this.removeItem(key);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, await this.encrypt(key, value));
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}

/**
 * A session store that forgets everything, for the one environment that has nowhere to
 * put it: `expo export --platform web` prerenders each route in Node, where there is no
 * `window` for AsyncStorage to reach. Reading storage during that pass throws, and the
 * export fails on a page nobody is signed in on anyway.
 */
function memoryStorage(): SupportedStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

// SecureStore has no web implementation. In a browser the session lives in AsyncStorage,
// which is localStorage there — the same place every other web app keeps one.
const storage: SupportedStorage =
  Platform.OS !== 'web'
    ? new LargeSecureStore()
    : typeof window === 'undefined'
      ? memoryStorage()
      : AsyncStorage;

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    // Native has no URL bar to read a session out of; the OAuth redirect is handled
    // explicitly in context/AuthContext.tsx instead.
    detectSessionInUrl: Platform.OS === 'web',
    flowType: 'pkce',
  },
});

/**
 * Refresh only while the app is in front of the user.
 *
 * Without this the refresh timer keeps firing in the background, burning requests and
 * occasionally racing a suspended network stack into a spurious sign-out.
 */
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
