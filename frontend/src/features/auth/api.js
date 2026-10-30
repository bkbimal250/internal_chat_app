import { apiClient } from '@/services/api-client'

export function fetchCurrentUser() {
  return apiClient.get('/api/v1/auth/me')
}
