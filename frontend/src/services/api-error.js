export class ApiError extends Error {
  constructor({ code, message, status, requestId, details }) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
    this.details = details
  }
}

export function toApiError(error) {
  const payload = error.response?.data?.error
  if (payload?.code) {
    return new ApiError({
      code: payload.code,
      message: payload.message || 'Request failed',
      status: error.response?.status ?? 0,
      requestId: payload.requestId,
      details: payload.details,
    })
  }

  if (error.request && !error.response) {
    return new ApiError({
      code: 'NETWORK_ERROR',
      message: 'Unable to reach the chat service',
      status: 0,
    })
  }

  if (error.response?.status === 429) {
    return new ApiError({
      code: 'RATE_LIMIT',
      message: error.response?.data?.message || 'Too many requests',
      status: 429,
    })
  }

  return new ApiError({
    code: 'UNKNOWN_ERROR',
    message: error.message || 'Unexpected error',
    status: error.response?.status ?? 0,
  })
}

export function getErrorMessage(error) {
  if (error instanceof ApiError && error.code === 'SMS_UNAVAILABLE') {
    return 'Unable to send verification code right now. Please try again later or use another sign-in method.'
  }
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Unexpected error'
}
