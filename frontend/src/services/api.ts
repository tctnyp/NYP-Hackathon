import axios, { AxiosInstance } from 'axios';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Task, Module, DashboardData, AIRecommendations } from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://your-api-url.com/dev';

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
apiClient.interceptors.request.use(async (config) => {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (error) {
    console.error('Error getting auth token:', error);
  }
  return config;
});

// Tasks API
export const tasksApi = {
  getAll: (params = {}) => apiClient.get<{ data: { tasks: Task[] } }>('/tasks', { params }),
  getById: (id: string) => apiClient.get<{ data: { task: Task } }>(`/tasks/${id}`),
  create: (data: Partial<Task>) => apiClient.post<{ data: { task: Task } }>('/tasks', data),
  update: (id: string, data: Partial<Task>) => apiClient.put<{ data: { task: Task } }>(`/tasks/${id}`, data),
  delete: (id: string) => apiClient.delete(`/tasks/${id}`),
};

// Modules API
export const modulesApi = {
  getAll: () => apiClient.get<{ data: { modules: Module[] } }>('/modules'),
  create: (data: Partial<Module>) => apiClient.post<{ data: { module: Module } }>('/modules', data),
  update: (id: string, data: Partial<Module>) => apiClient.put<{ data: { module: Module } }>(`/modules/${id}`, data),
  delete: (id: string) => apiClient.delete(`/modules/${id}`),
};

// Dashboard API
export const dashboardApi = {
  get: () => apiClient.get<{ data: DashboardData }>('/dashboard'),
};

// AI Features API
export const aiApi = {
  getPrioritization: () => apiClient.post<{ data: { recommendations: AIRecommendations } }>('/ai/prioritize'),
  getBreakdown: (taskId: string) => apiClient.post(`/ai/breakdown/${taskId}`),
};

export default apiClient;
