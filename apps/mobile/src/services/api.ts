import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { Platform } from "react-native";

type RetriableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

type AuthFailureHandler = (() => void) | null;

let authFailureHandler: AuthFailureHandler = null;
let isRefreshing = false;
let pendingQueue: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

function normalizeBaseUrl(rawValue: string | undefined) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) {
    return "https://solar-lead.onrender.com";
  }
  return trimmed.replace(/\/+$/, "");
}

function resolveMobileBaseUrl(baseUrl: string) {
  if (Platform.OS !== "android") {
    return baseUrl;
  }

  try {
    const parsed = new URL(baseUrl);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      parsed.hostname = "10.0.2.2";
      return parsed.toString().replace(/\/+$/, "");
    }
  } catch {
    return baseUrl;
  }

  return baseUrl;
}

export const resolvedApiBaseUrl = resolveMobileBaseUrl(
  normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL)
);

function isAuthRoute(url?: string) {
  if (!url) return false;
  return url.includes("/api/auth/login") || url.includes("/api/auth/refresh");
}

function flushQueue(error?: unknown) {
  const queue = [...pendingQueue];
  pendingQueue = [];

  for (const entry of queue) {
    if (error) {
      entry.reject(error);
    } else {
      entry.resolve();
    }
  }
}

export function setAuthFailureHandler(handler: AuthFailureHandler) {
  authFailureHandler = handler;
}

export const api = axios.create({
  baseURL: resolvedApiBaseUrl,
  withCredentials: true,
  timeout: 15000
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableRequestConfig | undefined;
    const status = error.response?.status;

    if (!originalRequest || status !== 401 || originalRequest._retry || isAuthRoute(originalRequest.url)) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    if (isRefreshing) {
      await new Promise<void>((resolve, reject) => {
        pendingQueue.push({ resolve, reject });
      });
      return api(originalRequest);
    }

    isRefreshing = true;
    try {
      await api.post("/api/auth/refresh");
      flushQueue();
      return api(originalRequest);
    } catch (refreshError) {
      flushQueue(refreshError);
      if (authFailureHandler) {
        authFailureHandler();
      }
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);
