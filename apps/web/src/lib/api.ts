import axios, { AxiosRequestConfig, AxiosRequestHeaders } from "axios";

function normalizeBaseUrl(raw: string | undefined) {
  return (raw ?? "").trim().replace(/\/+$/, "");
}

function isLocalDevHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0"
  );
}

function isRenderHostedUrl(raw: string) {
  try {
    const parsed = new URL(raw);
    return parsed.hostname.toLowerCase().endsWith(".onrender.com");
  } catch {
    return false;
  }
}

const configuredApiBaseUrl = normalizeBaseUrl(
  process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL
);
const hostedFallbackApiBaseUrl = "https://solar-lead.onrender.com";
const fallbackApiBaseUrl =
  process.env.NODE_ENV === "production"
    ? hostedFallbackApiBaseUrl
    : "http://localhost:4000";

const runningLocallyInBrowser =
  typeof window !== "undefined" && isLocalDevHost(window.location.hostname);
const shouldUseLocalApiForDev =
  process.env.NODE_ENV !== "production" &&
  runningLocallyInBrowser &&
  Boolean(configuredApiBaseUrl) &&
  isRenderHostedUrl(configuredApiBaseUrl);

const apiBaseUrl = shouldUseLocalApiForDev
  ? "http://localhost:4000"
  : configuredApiBaseUrl || fallbackApiBaseUrl;

if (!configuredApiBaseUrl) {
  console.error("API_CONFIG_ERROR", {
    reason:
      process.env.NODE_ENV === "production"
        ? "MISSING_NEXT_PUBLIC_API_BASE_URL_IN_PRODUCTION"
        : "MISSING_NEXT_PUBLIC_API_BASE_URL",
    fallbackApiBaseUrl
  });
} else if (shouldUseLocalApiForDev) {
  console.warn("API_CONFIG_WARNING", {
    reason: "REMOTE_API_URL_IN_LOCAL_DEV",
    configuredApiBaseUrl,
    selectedApiBaseUrl: apiBaseUrl
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
  const headers = (config.headers ?? {}) as AxiosRequestHeaders;
  if (!headers["X-Requested-With"]) {
    headers["X-Requested-With"] = "XMLHttpRequest";
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
    const isLogoutCall = requestUrl.includes("/auth/logout");
    const isSetupPasswordCall = requestUrl.includes("/auth/setup-password");

    if (
      status === 401 &&
      !config._retry &&
      !isRefreshCall &&
      !isLoginCall &&
      !isLogoutCall &&
      !isSetupPasswordCall
    ) {
      config._retry = true;
      try {
        await api.post("/api/auth/refresh");
        return api.request(config);
      } catch {
        return Promise.reject(err);
      }
    }
    return Promise.reject(err);
  }
);
