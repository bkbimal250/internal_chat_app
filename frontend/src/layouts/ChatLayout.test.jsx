import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { ChatLayout } from '@/layouts/ChatLayout'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { displayName: 'Alex Rivera', username: 'alex', role: 'admin' },
    isAdmin: true,
    logout: vi.fn(),
  }),
}))

vi.mock('@/stores/ui-store', () => ({
  useUiStore: (selector) =>
    selector({
      workspaceView: 'chats',
      activeConversationId: null,
      openWorkspace: vi.fn(),
      mobileNavOpen: false,
      setMobileNavOpen: vi.fn(),
      connectionStatus: 'open',
    }),
}))

describe('responsive navigation', () => {
  it('renders chats people groups settings and admin destinations', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider>
          <MemoryRouter>
            <ChatLayout />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    )
    expect(screen.getAllByRole('button', { name: 'Chats' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'People' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Groups' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Settings' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Admin' }).length).toBeGreaterThan(0)
  })
})
