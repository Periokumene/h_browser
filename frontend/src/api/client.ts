import axios from "axios";

const baseURL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

export function getBaseUrl(): string {
  return baseURL;
}

export function getToken(): string | null {
  return localStorage.getItem("authToken");
}

export const apiClient = axios.create({
  baseURL,
  withCredentials: false
});

apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${token}`
    };
  }
  return config;
});

