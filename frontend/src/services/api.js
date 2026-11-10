import { apiClient } from '@/services/api-client'

export const authApi = {
  me: () => apiClient.get('/api/v1/auth/me').then((r) => r.data),
  changePassword: (body) => apiClient.post('/api/v1/auth/change-password', body).then((r) => r.data),
  logoutAll: () => apiClient.post('/api/v1/auth/logout-all').then((r) => r.data),
}

export const usersApi = {
  me: () => apiClient.get('/api/v1/users/me').then((r) => r.data),
  updateMe: (body) => apiClient.patch('/api/v1/users/me', body).then((r) => r.data),
  directory: (params) => apiClient.get('/api/v1/users', { params }).then((r) => r.data),
  get: (id) => apiClient.get(`/api/v1/users/${id}`).then((r) => r.data),
  initPhoto: (body) => apiClient.post('/api/v1/users/me/photo', body).then((r) => r.data),
  completePhoto: (body) => apiClient.post('/api/v1/users/me/photo/complete', body).then((r) => r.data),
  removePhoto: () => apiClient.delete('/api/v1/users/me/photo').then((r) => r.data),
  photoUrl: (id) => apiClient.get(`/api/v1/users/${id}/photo-url`).then((r) => r.data),
  requestPhoneOtp: (body) => apiClient.post('/api/v1/users/me/phone/otp', body).then((r) => r.data),
  verifyPhone: (body) => apiClient.post('/api/v1/users/me/phone/verify', body).then((r) => r.data),
}

export const conversationsApi = {
  list: (params) => apiClient.get('/api/v1/conversations', { params }).then((r) => r.data),
  details: (id) => apiClient.get(`/api/v1/conversations/${id}`).then((r) => r.data),
  direct: (userId) => apiClient.post('/api/v1/conversations/direct', { userId }).then((r) => r.data),
  read: (id, sequenceNumber) =>
    apiClient.post(`/api/v1/conversations/${id}/read`, { sequenceNumber }).then((r) => r.data),
}

export const messagesApi = {
  list: (conversationId, params) =>
    apiClient.get(`/api/v1/conversations/${conversationId}/messages`, { params }).then((r) => r.data),
  sync: (conversationId, params) =>
    apiClient.get(`/api/v1/conversations/${conversationId}/sync`, { params }).then((r) => r.data),
  create: (conversationId, body) =>
    apiClient.post(`/api/v1/conversations/${conversationId}/messages`, body).then((r) => r.data),
  edit: (id, content) => apiClient.patch(`/api/v1/messages/${id}`, { content }).then((r) => r.data),
  remove: (id) => apiClient.delete(`/api/v1/messages/${id}`).then((r) => r.data),
  hide: (id) => apiClient.post(`/api/v1/messages/${id}/hide`).then((r) => r.data),
  react: (id, emoji) => apiClient.post(`/api/v1/messages/${id}/reactions`, { emoji }).then((r) => r.data),
  forward: (id, body) => apiClient.post(`/api/v1/messages/${id}/forward`, body).then((r) => r.data),
  delivered: (id) => apiClient.post(`/api/v1/messages/${id}/delivered`).then((r) => r.data),
}

export const attachmentsApi = {
  init: (conversationId, body) =>
    apiClient.post(`/api/v1/conversations/${conversationId}/attachments`, body).then((r) => r.data),
  signParts: (id, body) => apiClient.post(`/api/v1/attachments/${id}/parts`, body).then((r) => r.data),
  parts: (id) => apiClient.get(`/api/v1/attachments/${id}/parts`).then((r) => r.data),
  finalize: (id, body) => apiClient.post(`/api/v1/attachments/${id}/finalize`, body).then((r) => r.data),
  completeBatch: (conversationId, body) =>
    apiClient.post(`/api/v1/conversations/${conversationId}/attachments/complete`, body).then((r) => r.data),
  url: (id, params) => apiClient.get(`/api/v1/attachments/${id}/url`, { params }).then((r) => r.data),
  remove: (id) => apiClient.delete(`/api/v1/attachments/${id}`).then((r) => r.data),
}

export const receiptsApi = {
  conversation: (id) => apiClient.get(`/api/v1/conversations/${id}/receipts`).then((r) => r.data),
}

export const groupsApi = {
  list: () => apiClient.get('/api/v1/groups').then((r) => r.data),
  details: (id) => apiClient.get(`/api/v1/groups/${id}`).then((r) => r.data),
  create: (body) => apiClient.post('/api/v1/groups', body).then((r) => r.data),
  update: (id, body) => apiClient.patch(`/api/v1/groups/${id}`, body).then((r) => r.data),
  addMember: (id, userId) => apiClient.post(`/api/v1/groups/${id}/members`, { userId }).then((r) => r.data),
  setRole: (id, userId, role) =>
    apiClient.patch(`/api/v1/groups/${id}/members/${userId}/role`, { role }).then((r) => r.data),
  removeMember: (id, userId) => apiClient.delete(`/api/v1/groups/${id}/members/${userId}`).then((r) => r.data),
  transferOwner: (id, userId) =>
    apiClient.post(`/api/v1/groups/${id}/transfer-owner`, { userId }).then((r) => r.data),
  leave: (id) => apiClient.post(`/api/v1/groups/${id}/leave`).then((r) => r.data),
  updateSettings: (id, body) => apiClient.patch(`/api/v1/groups/${id}/settings`, body).then((r) => r.data),
  initPhoto: (id, body) => apiClient.post(`/api/v1/groups/${id}/photo`, body).then((r) => r.data),
  completePhoto: (id, body) => apiClient.post(`/api/v1/groups/${id}/photo/complete`, body).then((r) => r.data),
  removePhoto: (id) => apiClient.delete(`/api/v1/groups/${id}/photo`).then((r) => r.data),
  photoUrl: (id) => apiClient.get(`/api/v1/groups/${id}/photo-url`).then((r) => r.data),
}

export const sessionsApi = {
  list: () => apiClient.get('/api/v1/sessions').then((r) => r.data),
  revoke: (id) => apiClient.delete(`/api/v1/sessions/${id}`).then((r) => r.data),
  devices: () => apiClient.get('/api/v1/devices').then((r) => r.data),
}

export const adminApi = {
  users: (params) => apiClient.get('/api/v1/admin/users', { params }).then((r) => r.data),
  user: (id) => apiClient.get(`/api/v1/admin/users/${id}`).then((r) => r.data),
  createUser: (body) => apiClient.post('/api/v1/admin/users', body).then((r) => r.data),
  updateUser: (id, body) => apiClient.patch(`/api/v1/admin/users/${id}`, body).then((r) => r.data),
  suspend: (id) => apiClient.post(`/api/v1/admin/users/${id}/suspend`).then((r) => r.data),
  reactivate: (id) => apiClient.post(`/api/v1/admin/users/${id}/reactivate`).then((r) => r.data),
  resetPassword: (id, body) =>
    apiClient.post(`/api/v1/admin/users/${id}/reset-password`, body ?? {}).then((r) => r.data),
  revokeSessions: (id) => apiClient.delete(`/api/v1/admin/users/${id}/sessions`).then((r) => r.data),
  removeUser: (id) => apiClient.delete(`/api/v1/admin/users/${id}`).then((r) => r.data),
  initPhoto: (id, body) => apiClient.post(`/api/v1/admin/users/${id}/photo`, body).then((r) => r.data),
  completePhoto: (id, body) =>
    apiClient.post(`/api/v1/admin/users/${id}/photo/complete`, body).then((r) => r.data),
  removePhoto: (id) => apiClient.delete(`/api/v1/admin/users/${id}/photo`).then((r) => r.data),
  audit: (params) => apiClient.get('/api/v1/admin/audit-logs', { params }).then((r) => r.data),
  retention: () => apiClient.get('/api/v1/admin/retention').then((r) => r.data),
  updateRetention: (body) => apiClient.patch('/api/v1/admin/retention', body).then((r) => r.data),
  activateRetention: () => apiClient.post('/api/v1/admin/retention/activate').then((r) => r.data),
  pauseRetention: () => apiClient.post('/api/v1/admin/retention/pause').then((r) => r.data),
}

export const retentionApi = {
  policy: () => apiClient.get('/api/v1/retention/policy').then((r) => r.data),
  conversation: (id) => apiClient.get(`/api/v1/conversations/${id}/retention`).then((r) => r.data),
  notifications: () => apiClient.get('/api/v1/notifications').then((r) => r.data),
  readNotification: (id) => apiClient.post(`/api/v1/notifications/${id}/read`).then((r) => r.data),
  exportChat: (id) => apiClient.post(`/api/v1/conversations/${id}/export`).then((r) => r.data),
  exportStatus: (id) => apiClient.get(`/api/v1/exports/${id}`).then((r) => r.data),
}
