import { apiClient } from '@/services/api-client'

export const callsApi = {
  capabilities: () => apiClient.get('/api/v1/calls/capabilities').then((r) => r.data),
  iceConfig: () => apiClient.get('/api/v1/calls/ice-config').then((r) => r.data),
  create: (calleeId) => apiClient.post('/api/v1/calls', { calleeId }).then((r) => r.data),
  get: (id) => apiClient.get(`/api/v1/calls/${id}`).then((r) => r.data),
  accept: (id) => apiClient.post(`/api/v1/calls/${id}/accept`).then((r) => r.data),
  reject: (id) => apiClient.post(`/api/v1/calls/${id}/reject`).then((r) => r.data),
  cancel: (id) => apiClient.post(`/api/v1/calls/${id}/cancel`).then((r) => r.data),
  busy: (id) => apiClient.post(`/api/v1/calls/${id}/busy`).then((r) => r.data),
  connected: (id) => apiClient.post(`/api/v1/calls/${id}/connected`).then((r) => r.data),
  end: (id) => apiClient.post(`/api/v1/calls/${id}/end`).then((r) => r.data),
}
