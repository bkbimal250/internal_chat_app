import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatSelectionToolbar } from '@/features/conversations/ChatSelectionToolbar'

const snapshot = {
  count: 2,
  allPinned: false,
  allMuted: false,
  allArchived: false,
  anyUnread: true,
  anyRead: true,
}

describe('chat selection toolbar', () => {
  afterEach(() => cleanup())

  it('shows pin mute delete and archive on a wide toolbar', () => {
    render(<ChatSelectionToolbar snapshot={snapshot} compact={false} busy={false} onCancel={vi.fn()} onPin={vi.fn()} onMute={vi.fn()} onDelete={vi.fn()} onArchive={vi.fn()} />)
    expect(screen.getByTestId('selected-count')).toHaveTextContent('2 selected')
    expect(screen.getByTestId('toolbar-pin')).toBeInTheDocument()
    expect(screen.getByTestId('toolbar-mute')).toBeInTheDocument()
    expect(screen.getByTestId('toolbar-delete')).toBeInTheDocument()
    expect(screen.getByTestId('toolbar-archive')).toBeInTheDocument()
  })

  it('keeps delete visible and moves pin into more on a compact toolbar', async () => {
    const user = userEvent.setup()
    render(<ChatSelectionToolbar snapshot={snapshot} compact busy={false} onCancel={vi.fn()} onPin={vi.fn()} onMute={vi.fn()} onDelete={vi.fn()} onArchive={vi.fn()} onMarkRead={vi.fn()} />)
    expect(screen.getByTestId('toolbar-delete')).toBeInTheDocument()
    expect(screen.queryByTestId('toolbar-pin')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('toolbar-more'))
    expect(screen.getByTestId('toolbar-more-pin')).toHaveTextContent('Pin')
    expect(screen.getByTestId('toolbar-more-read')).toHaveTextContent('Mark as read')
  })
})
