import axios, { AxiosRequestConfig, AxiosRequestHeaders } from "axios";
import { getSupabaseBrowserClient } from "./supabase";

function normalizeBaseUrl(raw: string | undefined) {
  return (raw ?? "").trim().replace(/\/+$/, "");
}

const configuredApiBaseUrl = normalizeBaseUrl(
  process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL
);
const fallbackApiBaseUrl =
  process.env.NODE_ENV === "production"
    ? "https://solar-lead.onrender.com"
    : "http://localhost:4000";

const apiBaseUrl = configuredApiBaseUrl || fallbackApiBaseUrl;

if (!configuredApiBaseUrl) {
  console.error("API_CONFIG_ERROR", {
    reason: "MISSING_NEXT_PUBLIC_API_BASE_URL",
    fallbackApiBaseUrl
  });
}

export const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json"
  }
});

type RetriableConfig = {
  _retry?: boolean;
  url?: string;
};

export function getApiErrorMessage(error: unknown, fallbackMessage: string) {
  if (!axios.isAxiosError(error)) {
    return fallbackMessage;
  }

  const apiMessage = error.response?.data?.message;
  const apiCode = error.response?.data?.error?.code;
  const apiReason = error.response?.data?.error?.details?.reason;
  const apiErrorCodes = error.response?.data?.error?.details?.errorCodes;
  if (typeof apiMessage === "string" && apiMessage.trim().length > 0) {
    const extraBits: string[] = [];
    if (typeof apiCode === "string" && apiCode.trim().length > 0) {
      extraBits.push(apiCode.trim());
    }
    if (typeof apiReason === "string" && apiReason.trim().length > 0) {
      extraBits.push(apiReason.trim());
    }
    if (
      Array.isArray(apiErrorCodes) &&
      apiErrorCodes.length > 0 &&
      typeof apiErrorCodes[0] === "string"
    ) {
      extraBits.push(apiErrorCodes[0]);
    }
    if (extraBits.length > 0) {
      return `${apiMessage} [${extraBits.join(" | ")}]`;
    }
    return apiMessage;
  }

  if (typeof error.response?.status === "number") {
    return `${fallbackMessage} (${error.response.status})`;
  }

  if (error.code === "ERR_NETWORK") {
    return "Network/CORS error: backend is unreachable or blocked by CORS";
  }

  return fallbackMessage;
}

api.interceptors.request.use(async (config) => {
  if (typeof window === "undefined") {
    return config;
  }

  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return config;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    return config;
  }

  const headers = (config.headers ?? {}) as AxiosRequestHeaders;
  if (!headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  config.headers = headers;
  return config;
});

api.interceptors.response.use(
  (resp) => resp,
  async (err) => {
    const status = err.response?.status as number | undefined;
    const config = (err.config ?? {}) as AxiosRequestConfig & RetriableConfig;
    const requestUrl = String(config.url ?? "");
    const isRefreshCall = requestUrl.includes("/auth/refresh");
    const isLoginCall = requestUrl.includes("/auth/login");
    if (status === 401 && !config._retry && !isRefreshCall && !isLoginCall) {
      config._retry = true;
      try {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) {
          return Promise.reject(err);
        }

        const refreshed = await supabase.auth.refreshSession();
        const nextAccessToken = refreshed.data.session?.access_token;
        if (!nextAccessToken) {
          await supabase.auth.signOut();
          return Promise.reject(err);
        }

        const headers = (config.headers ?? {}) as AxiosRequestHeaders;
        headers.Authorization = `Bearer ${nextAccessToken}`;
        config.headers = headers;
        return api.request(config);
      } catch {
        const supabase = getSupabaseBrowserClient();
        if (supabase) {
          await supabase.auth.signOut();
        }
        return Promise.reject(err);
      }
    }
    return Promise.reject(err);
  }
);
