import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsShell } from './SettingsShell'

vi.mock('@/hooks/use-workspace', () => ({
  useWorkspace: () => ({ openView: vi.fn(), openChat: vi.fn() }),
}))

afterEach(() => cleanup())

function renderShell(isAdmin = true) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsShell
        user={{ id: 'u1', displayName: 'Alex Rivera', username: 'alex', role: isAdmin ? 'admin' : 'user' }}
        isAdmin={isAdmin}
      />
    </QueryClientProvider>,
  )
}

describe('settings shell', () => {
  it('groups accounts devices workplace and about in the sidebar', () => {
    renderShell()
    expect(screen.getByTestId('settings-shell')).toBeInTheDocument()
    expect(screen.getByTestId('settings-nav-accounts')).toBeInTheDocument()
    expect(screen.getByTestId('settings-nav-devices')).toBeInTheDocument()
    expect(screen.getByTestId('settings-nav-workplace')).toBeInTheDocument()
    expect(screen.getByTestId('settings-nav-about')).toBeInTheDocument()
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
  })

  it('marks the active category and opens a settings card', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByTestId('settings-nav-devices'))
    expect(screen.getByTestId('settings-nav-devices')).toHaveClass('bg-accent')
    expect(screen.getByTestId('settings-open-devices')).toBeInTheDocument()
  })
})
