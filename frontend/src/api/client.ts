import axios from "axios";

const baseURL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

export function getBaseUrl(): string {
  return baseURL;
}

export const apiClient = axios.create({
  baseURL,
  withCredentials: false
});

