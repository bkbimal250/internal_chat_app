import { afterEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/common/UserAvatar'

afterEach(() => cleanup())

function renderAvatar(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  )
}

describe('UserAvatar', () => {
  it('shows initials when no photo is available', () => {
    renderAvatar(<UserAvatar name="Alex Rivera" />)
    expect(screen.getByText('AR')).toBeInTheDocument()
    expect(screen.queryByTestId('avatar-image')).not.toBeInTheDocument()
  })

  it('renders a group icon fallback', () => {
    renderAvatar(<UserAvatar variant="group" name="Ops" />)
    expect(screen.getByTestId('group-avatar')).toBeInTheDocument()
    expect(screen.getByLabelText('Ops')).toBeInTheDocument()
  })

  it('shows an online indicator on the avatar', () => {
    renderAvatar(<UserAvatar name="Bea Cole" online />)
    expect(screen.getByTestId('online-indicator')).toBeInTheDocument()
    expect(screen.getByText('BC')).toBeInTheDocument()
  })
})
