import axios, { AxiosRequestConfig } from "axios";

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL,
  withCredentials: true
});

type RetriableConfig = {
  _retry?: boolean;
  url?: string;
};

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
