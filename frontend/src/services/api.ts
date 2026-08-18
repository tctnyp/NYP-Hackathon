import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { Task, Module, DashboardData, CollaborativeGroup, GroupInvitation, GroupSummary, GroupTask } from '../types/api';
import { tokenStorage, cognitoAuth } from './cognitoAuth';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://your-api-url.com/dev';

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL.replace(/\/$/, ''),
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const idToken = tokenStorage.getIdToken();
    if (idToken) {
      config.headers.Authorization = `Bearer ${idToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

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
  },
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

export const groupsApi = {
  getAll: () => apiClient.get<{ data: { groups: GroupSummary[]; invitations: GroupInvitation[] } }>('/groups'),
  getById: (id: string) => apiClient.get<{ data: { group: CollaborativeGroup } }>(`/groups/${id}`),
  create: (data: { name: string; description?: string; color?: string }) => (
    apiClient.post<{ data: { group: CollaborativeGroup } }>('/groups', data)
  ),
  sendInvitation: (id: string, email: string) => (
    apiClient.post<{ data: { message: string } }>(`/groups/${id}/members`, { email })
  ),
  acceptInvitation: (id: string) => apiClient.post(`/groups/${id}/invitations/accept`),
  declineInvitation: (id: string) => apiClient.delete(`/groups/${id}/invitations`),
  clearInvitations: (id: string) => apiClient.delete(`/groups/${id}/invitations`),
  removeMember: (id: string, memberId: string) => apiClient.delete(`/groups/${id}/members/${memberId}`),
  delete: (id: string) => apiClient.delete(`/groups/${id}`),
  createTask: (id: string, data: Partial<GroupTask>) => (
    apiClient.post<{ data: { task: GroupTask } }>(`/groups/${id}/tasks`, data)
  ),
  updateTask: (id: string, taskId: string, data: Partial<GroupTask>) => (
    apiClient.put<{ data: { task: GroupTask } }>(`/groups/${id}/tasks/${taskId}`, data)
  ),
  deleteTask: (id: string, taskId: string) => apiClient.delete(`/groups/${id}/tasks/${taskId}`),
};

export const dashboardApi = {
  get: () => apiClient.get<{ data: DashboardData }>('/dashboard'),
};

export interface TaskExtractionRequest {
  file_name: string;
  media_type: string;
  document_base64: string;
  locale: string;
}

export interface TaskExtractionSuggestion<T> {
  value: T;
  confidence: number;
}

export interface TaskExtractionFields {
  title: TaskExtractionSuggestion<string> | null;
  description: TaskExtractionSuggestion<string> | null;
  task_type: TaskExtractionSuggestion<Task['task_type']> | null;
  deadline_local: TaskExtractionSuggestion<string> | null;
  estimated_hours: TaskExtractionSuggestion<number> | null;
  grade_weight: TaskExtractionSuggestion<number> | null;
  is_group_work: TaskExtractionSuggestion<boolean> | null;
  module_hint: TaskExtractionSuggestion<string> | null;
}

export interface TaskExtractionData {
  fields: TaskExtractionFields;
  warnings: string[];
  document: {
    pages: number;
  };
}

export const taskExtractionsApi = {
  extract: (data: TaskExtractionRequest) => (
    apiClient.post<{ data: TaskExtractionData }>('/task-extractions', data)
  ),
};

export default apiClient;

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
  completeOnboarding: (version: number) => (
    apiClient.put<AccountApiResponse>('/account', { action: 'completeOnboarding', version }, { timeout: 8000 })
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
