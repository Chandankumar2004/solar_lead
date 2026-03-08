import axios, { AxiosRequestConfig } from "axios";

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
        await api.post("/api/auth/refresh");
        return api.request(config);
      } catch {
        return Promise.reject(err);
      }
    }
    return Promise.reject(err);
  }
);
