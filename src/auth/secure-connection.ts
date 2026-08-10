import * as SecureStore from "expo-secure-store";

import { normalizeBaseUrl } from "@/api/client";
import { parseNavigationSelection } from "@/navigation/last-active";
import type { NavigationSelection } from "@/navigation/model";

const CONNECTION_KEY = "wmux.connection.v1";

let storageWrite = Promise.resolve();

const enqueueStorageWrite = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = storageWrite.then(operation, operation);
  storageWrite = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

export interface StoredConnection {
  baseUrl: string;
  lastNavigation: NavigationSelection | undefined;
  token: string | undefined;
  tokenExpiresAt: number | undefined;
  username: string | undefined;
}

const emptyConnection = (baseUrl: string, lastNavigation?: NavigationSelection): StoredConnection => ({
  baseUrl,
  lastNavigation,
  token: undefined,
  tokenExpiresAt: undefined,
  username: undefined,
});

const parseStoredConnection = (value: string): StoredConnection | null => {
  try {
    const parsed = JSON.parse(value) as Partial<StoredConnection>;
    if (typeof parsed.baseUrl !== "string") return null;
    const baseUrl = normalizeBaseUrl(parsed.baseUrl);
    const lastNavigation = parseNavigationSelection(parsed.lastNavigation);
    const token = typeof parsed.token === "string" && parsed.token ? parsed.token : undefined;
    const tokenExpiresAt =
      typeof parsed.tokenExpiresAt === "number" && Number.isFinite(parsed.tokenExpiresAt)
        ? parsed.tokenExpiresAt
        : undefined;
    const username = typeof parsed.username === "string" && parsed.username ? parsed.username : undefined;

    if (token && tokenExpiresAt && tokenExpiresAt <= Date.now()) return emptyConnection(baseUrl, lastNavigation);
    return { baseUrl, lastNavigation, token, tokenExpiresAt, username };
  } catch {
    return null;
  }
};

const persist = async (connection: StoredConnection): Promise<void> => {
  await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(connection), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
};

const loadStoredConnectionNow = async (): Promise<StoredConnection | null> => {
  const stored = await SecureStore.getItemAsync(CONNECTION_KEY);
  if (!stored) return null;
  const connection = parseStoredConnection(stored);
  if (!connection) await SecureStore.deleteItemAsync(CONNECTION_KEY);
  return connection;
};

export const loadStoredConnection = async (): Promise<StoredConnection | null> => {
  await storageWrite;
  return loadStoredConnectionNow();
};

export const storeEndpoint = (baseUrl: string): Promise<StoredConnection> =>
  enqueueStorageWrite(async () => {
    const normalized = normalizeBaseUrl(baseUrl);
    const existing = await loadStoredConnectionNow();
    const connection = existing?.baseUrl === normalized ? existing : emptyConnection(normalized);
    await persist(connection);
    return connection;
  });

export const storeSession = (
  baseUrl: string,
  username: string,
  token: string,
  expiresInMs: number,
): Promise<StoredConnection> =>
  enqueueStorageWrite(async () => {
    const normalized = normalizeBaseUrl(baseUrl);
    const existing = await loadStoredConnectionNow();
    const connection: StoredConnection = {
      baseUrl: normalized,
      lastNavigation: existing?.baseUrl === normalized ? existing.lastNavigation : undefined,
      token,
      tokenExpiresAt: Date.now() + expiresInMs,
      username,
    };
    await persist(connection);
    return connection;
  });

export const storeAccessToken = (baseUrl: string, token: string): Promise<StoredConnection> =>
  enqueueStorageWrite(async () => {
    const normalized = normalizeBaseUrl(baseUrl);
    const existing = await loadStoredConnectionNow();
    const connection: StoredConnection = {
      baseUrl: normalized,
      lastNavigation: existing?.baseUrl === normalized ? existing.lastNavigation : undefined,
      token,
      tokenExpiresAt: undefined,
      username: undefined,
    };
    await persist(connection);
    return connection;
  });

export const clearStoredSession = (): Promise<void> =>
  enqueueStorageWrite(async () => {
    const connection = await loadStoredConnectionNow();
    if (!connection) return;
    await persist(emptyConnection(connection.baseUrl, connection.lastNavigation));
  });

export const storeLastNavigation = (
  baseUrl: string,
  lastNavigation: NavigationSelection | undefined,
): Promise<void> => {
  const normalized = normalizeBaseUrl(baseUrl);
  return enqueueStorageWrite(async () => {
    const existing = await loadStoredConnectionNow();
    const connection = existing?.baseUrl === normalized ? existing : emptyConnection(normalized);
    await persist({ ...connection, lastNavigation });
  });
};

export const forgetStoredConnection = (): Promise<void> =>
  enqueueStorageWrite(() => SecureStore.deleteItemAsync(CONNECTION_KEY));
