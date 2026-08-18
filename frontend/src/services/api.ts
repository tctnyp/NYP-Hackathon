import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { Task, Module, DashboardData, AIRecommendations } from '../types/api';
import { tokenStorage, cognitoAuth } from './cognitoAuth';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://your-api-url.com/dev';

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL.replace(/\/$/, ''),
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - add Authorization Bearer ID token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const idToken = tokenStorage.getIdToken();
    if (idToken) {
      config.headers.Authorization = `Bearer ${idToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle token refresh on 401
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: any) => void;
  reject: (reason?: any) => void;
}> = [];

const processQueue = (error: any = null) => {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else {
      promise.resolve();
    }
  });
  failedQueue = [];
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // Queue requests while refreshing
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(() => {
            const idToken = tokenStorage.getIdToken();
            if (originalRequest.headers && idToken) {
              originalRequest.headers.Authorization = `Bearer ${idToken}`;
            }
            return apiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        await cognitoAuth.refreshTokens();
        const idToken = tokenStorage.getIdToken();

        if (originalRequest.headers && idToken) {
          originalRequest.headers.Authorization = `Bearer ${idToken}`;
        }

        processQueue();
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError);
        tokenStorage.clearTokens();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export const tasksApi = {
  getAll: (params = {}) => apiClient.get<{ data: { tasks: Task[] } }>('/tasks', { params }),
  getById: (id: string) => apiClient.get<{ data: { task: Task } }>(`/tasks/${id}`),
  create: (data: Partial<Task>) => apiClient.post<{ data: { task: Task } }>('/tasks', data),
  update: (id: string, data: Partial<Task>) => apiClient.put<{ data: { task: Task } }>(`/tasks/${id}`, data),
  delete: (id: string) => apiClient.delete(`/tasks/${id}`),
};

export const modulesApi = {
  getAll: () => apiClient.get<{ data: { modules: Module[] } }>('/modules'),
  create: (data: Partial<Module>) => apiClient.post<{ data: { module: Module } }>('/modules', data),
  update: (id: string, data: Partial<Module>) => apiClient.put<{ data: { module: Module } }>(`/modules/${id}`, data),
  delete: (id: string) => apiClient.delete(`/modules/${id}`),
};

export const dashboardApi = {
  get: () => apiClient.get<{ data: DashboardData }>('/dashboard'),
};

export const aiApi = {
  getPrioritization: () => apiClient.post<{ data: { recommendations: AIRecommendations } }>('/ai/prioritize'),
  getBreakdown: (taskId: string) => apiClient.post(`/ai/breakdown/${taskId}`),
};

export interface AccountApiProfile {
  display_name: string;
  full_name: string;
  profile_picture: string | null;
  email?: string;
  [key: string]: unknown;
}

export interface AccountApiData {
  profile: AccountApiProfile;
  connections: Record<string, boolean | { connected: boolean; [key: string]: unknown }>;
  password_change_available: boolean;
  authorization_url?: string;
  url?: string;
}

type AccountApiResponse = { data: AccountApiData };

export const accountApi = {
  get: () => apiClient.get<AccountApiResponse>('/account'),
  updateProfile: (profile: Pick<AccountApiProfile, 'display_name' | 'full_name' | 'profile_picture'>) => (
    apiClient.put<AccountApiResponse>('/account', profile)
  ),
  oauthAuthorize: (provider: 'google' | 'discord') => (
    apiClient.put<AccountApiResponse>('/account', { action: 'oauthAuthorize', provider })
  ),
  oauthCallback: (code: string, state: string) => (
    apiClient.put<AccountApiResponse>('/account', { action: 'oauthCallback', code, state })
  ),
  disconnect: (provider: 'google' | 'discord') => (
    apiClient.put<AccountApiResponse>('/account', { action: 'disconnect', provider })
  ),
};

export default apiClient;

export interface GoogleCalendarSyncStatus {
  linked: boolean;
  available: boolean;
  enabled: boolean;
  status: 'disabled' | 'enabled' | 'disable_pending' | 'reauthorization_required' | string;
  calendar_email?: string;
  last_sync_at?: string;
  last_attempt_at?: string;
  last_error?: string | null;
}

type CalendarApiResponse = {
  data: {
    calendar_sync: GoogleCalendarSyncStatus;
    authorization_url?: string;
    expires_at?: string;
  };
};

export const googleCalendarApi = {
  get: () => apiClient.get<CalendarApiResponse>('/calendar/google'),
  authorize: () => apiClient.put<CalendarApiResponse>('/calendar/google', { action: 'authorize' }),
  callback: (code: string, state: string) => (
    apiClient.put<CalendarApiResponse>('/calendar/google', { action: 'callback', code, state })
  ),
  sync: () => apiClient.put<CalendarApiResponse>('/calendar/google', { action: 'sync' }),
  disable: () => apiClient.put<CalendarApiResponse>('/calendar/google', { action: 'disable' }),
};
