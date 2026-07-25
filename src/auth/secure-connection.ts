import * as SecureStore from "expo-secure-store";

import { normalizeBaseUrl } from "@/api/client";

const CONNECTION_KEY = "wmux.connection.v1";

export interface StoredConnection {
  baseUrl: string;
  token: string | undefined;
  tokenExpiresAt: number | undefined;
  username: string | undefined;
}

const emptyConnection = (baseUrl: string): StoredConnection => ({
  baseUrl,
  token: undefined,
  tokenExpiresAt: undefined,
  username: undefined,
});

const parseStoredConnection = (value: string): StoredConnection | null => {
  try {
    const parsed = JSON.parse(value) as Partial<StoredConnection>;
    if (typeof parsed.baseUrl !== "string") return null;
    const baseUrl = normalizeBaseUrl(parsed.baseUrl);
    const token = typeof parsed.token === "string" && parsed.token ? parsed.token : undefined;
    const tokenExpiresAt =
      typeof parsed.tokenExpiresAt === "number" && Number.isFinite(parsed.tokenExpiresAt)
        ? parsed.tokenExpiresAt
        : undefined;
    const username = typeof parsed.username === "string" && parsed.username ? parsed.username : undefined;

    if (token && tokenExpiresAt && tokenExpiresAt <= Date.now()) return emptyConnection(baseUrl);
    return { baseUrl, token, tokenExpiresAt, username };
  } catch {
    return null;
  }
};

const persist = async (connection: StoredConnection): Promise<void> => {
  await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(connection), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
};

export const loadStoredConnection = async (): Promise<StoredConnection | null> => {
  const stored = await SecureStore.getItemAsync(CONNECTION_KEY);
  if (!stored) return null;
  const connection = parseStoredConnection(stored);
  if (!connection) await SecureStore.deleteItemAsync(CONNECTION_KEY);
  return connection;
};

export const storeEndpoint = async (baseUrl: string): Promise<StoredConnection> => {
  const normalized = normalizeBaseUrl(baseUrl);
  const existing = await loadStoredConnection();
  const connection = existing?.baseUrl === normalized ? existing : emptyConnection(normalized);
  await persist(connection);
  return connection;
};

export const storeSession = async (
  baseUrl: string,
  username: string,
  token: string,
  expiresInMs: number,
): Promise<StoredConnection> => {
  const connection: StoredConnection = {
    baseUrl: normalizeBaseUrl(baseUrl),
    token,
    tokenExpiresAt: Date.now() + expiresInMs,
    username,
  };
  await persist(connection);
  return connection;
};

export const storeAccessToken = async (baseUrl: string, token: string): Promise<StoredConnection> => {
  const connection: StoredConnection = {
    baseUrl: normalizeBaseUrl(baseUrl),
    token,
    tokenExpiresAt: undefined,
    username: undefined,
  };
  await persist(connection);
  return connection;
};

export const clearStoredSession = async (): Promise<void> => {
  const connection = await loadStoredConnection();
  if (!connection) return;
  await persist(emptyConnection(connection.baseUrl));
};

export const forgetStoredConnection = (): Promise<void> => SecureStore.deleteItemAsync(CONNECTION_KEY);
