import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
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
      mobileNavOpen: false,
      setMobileNavOpen: vi.fn(),
      connectionStatus: 'open',
    }),
}))

describe('responsive navigation', () => {
  it('renders chats people groups settings and admin destinations', () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <ChatLayout />
        </MemoryRouter>
      </TooltipProvider>,
    )
    expect(screen.getAllByText('Chats').length).toBeGreaterThan(0)
    expect(screen.getAllByText('People').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Groups').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0)
  })
})
