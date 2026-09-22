import axios from "axios";

// On Railway, set VITE_API_URL to the backend service's public URL at build
// time. Falls back to localhost for local dev via docker-compose.
const baseURL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const client = axios.create({ baseURL });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("payroll_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("payroll_token");
      localStorage.removeItem("payroll_user");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default client;
