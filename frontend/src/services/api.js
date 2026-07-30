import axios from 'axios';
import { fetchAuthSession } from 'aws-amplify/auth';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://your-api-url.com/dev';

const apiClient = axios.create({
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
  getAll: (params = {}) => apiClient.get('/tasks', { params }),
  getById: (id) => apiClient.get(`/tasks/${id}`),
  create: (data) => apiClient.post('/tasks', data),
  update: (id, data) => apiClient.put(`/tasks/${id}`, data),
  delete: (id) => apiClient.delete(`/tasks/${id}`),
};

// Modules API
export const modulesApi = {
  getAll: () => apiClient.get('/modules'),
  create: (data) => apiClient.post('/modules', data),
  update: (id, data) => apiClient.put(`/modules/${id}`, data),
  delete: (id) => apiClient.delete(`/modules/${id}`),
};

// Dashboard API
export const dashboardApi = {
  get: () => apiClient.get('/dashboard'),
};

// AI Features API
export const aiApi = {
  getPrioritization: () => apiClient.post('/ai/prioritize'),
  getBreakdown: (taskId) => apiClient.post(`/ai/breakdown/${taskId}`),
};

export default apiClient;
