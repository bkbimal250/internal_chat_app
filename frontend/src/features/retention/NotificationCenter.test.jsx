import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationCenter } from './NotificationCenter'
import { retentionApi } from '@/services/api'

vi.mock('@/hooks/use-workspace', () => ({
  useWorkspace: () => ({ openChat: vi.fn() }),
}))

vi.mock('@/services/api', () => ({
  retentionApi: {
    notifications: vi.fn(async () => []),
    readNotification: vi.fn(),
  },
}))

afterEach(() => cleanup())

function renderBell(rows) {
  retentionApi.notifications.mockResolvedValue(rows)
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NotificationCenter collapsed />
    </QueryClientProvider>,
  )
}

describe('notification center', () => {
  it('shows a clean unread badge aligned with the rail control', async () => {
    const user = userEvent.setup()
    renderBell([
      { id: 'n1', title: 'Retention reminder', body: 'A chat will expire', createdAt: new Date().toISOString() },
      { id: 'n2', title: 'Read already', body: 'Done', createdAt: new Date().toISOString(), readAt: new Date().toISOString() },
    ])
    expect(await screen.findByTestId('notification-unread')).toHaveTextContent('1')
    expect(screen.getByTestId('notification-bell')).toHaveAccessibleName('1 notifications')
    await user.click(screen.getByTestId('notification-bell'))
    expect(await screen.findByText('1 unread')).toBeInTheDocument()
    expect(screen.getByText('Retention reminder')).toBeInTheDocument()
  })

  it('uses a neutral empty state when there are no alerts', async () => {
    const user = userEvent.setup()
    renderBell([])
    expect(await screen.findByTestId('notification-bell')).toHaveAccessibleName('Notifications')
    expect(screen.queryByTestId('notification-unread')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('notification-bell'))
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument()
  })
})
