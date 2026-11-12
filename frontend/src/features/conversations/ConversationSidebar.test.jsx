import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fireEvent } from '@testing-library/react'
import { ConversationSidebar } from '@/features/conversations/ConversationSidebar'
import { queryKeys } from '@/lib/query-keys'
import { TooltipProvider } from '@/components/ui/tooltip'

const openChat = vi.fn()
const closeChat = vi.fn()
const hideMany = vi.fn()
const pinMany = vi.fn()
const muteMany = vi.fn()
const archiveMany = vi.fn()
const readMany = vi.fn()
const unreadMany = vi.fn()
const list = vi.fn()

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'me', displayName: 'Alex' }, isAdmin: false }),
}))

vi.mock('@/hooks/use-workspace', () => ({
  useWorkspace: () => ({ conversationId: 'c1', openChat, closeChat }),
}))

vi.mock('@/hooks/use-media-query', () => ({
  useMediaQuery: (query) => query.includes('768') || query.includes('480'),
}))

const ui = {
  conversationFilter: 'all',
  setConversationFilter: (value) => {
    ui.conversationFilter = value
  },
  conversationQuery: '',
  setConversationQuery: (value) => {
    ui.conversationQuery = value
  },
  setMobileNavOpen: vi.fn(),
}

vi.mock('@/stores/ui-store', () => ({
  useUiStore: (selector) => selector(ui),
  usePresenceStore: (selector) => selector({ online: {} }),
}))

vi.mock('@/services/api', () => ({
  conversationsApi: {
    list: (...args) => list(...args),
    hideMany: (...args) => hideMany(...args),
    pinMany: (...args) => pinMany(...args),
    muteMany: (...args) => muteMany(...args),
    archiveMany: (...args) => archiveMany(...args),
    readMany: (...args) => readMany(...args),
    unreadMany: (...args) => unreadMany(...args),
    direct: vi.fn(),
  },
  usersApi: { directory: vi.fn() },
}))

vi.mock('@/features/groups/CreateGroupDialog', () => ({
  CreateGroupDialog: () => null,
}))

const inbox = [
  {
    id: 'c1',
    type: 'direct',
    unreadCount: 2,
    lastMessageSeq: 4,
    updatedAt: '2026-11-12T12:00:00.000Z',
    members: [
      { id: 'me', displayName: 'Alex' },
      { id: 'you', displayName: 'Jordan Lee', username: 'jordan' },
    ],
    latestMessage: { content: 'Are you free?', createdAt: '2026-11-12T12:00:00.000Z' },
  },
  {
    id: 'gone',
    type: 'direct',
    unreadCount: 0,
    lastMessageSeq: 1,
    updatedAt: '2026-11-11T12:00:00.000Z',
    members: [
      { id: 'me', displayName: 'Alex' },
      { id: 'old', displayName: 'Deleted employee', username: 'gone' },
    ],
    latestMessage: { content: 'Last note', createdAt: '2026-11-11T12:00:00.000Z' },
  },
]

function renderSidebar(client) {
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ConversationSidebar />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

function clientWithLists({ inboxRows = inbox, archivedRows = [] } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(queryKeys.conversations, { data: inboxRows })
  client.setQueryData(queryKeys.archivedConversations, { data: archivedRows })
  return client
}

describe('conversation sidebar actions', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })

  beforeEach(() => {
    ui.conversationFilter = 'all'
    ui.conversationQuery = ''
    list.mockImplementation(async (params) => ({ data: params?.archived ? [] : inbox }))
    hideMany.mockResolvedValue({ hidden: [{ id: 'gone', hiddenUntilSeq: 1 }], failed: [] })
    pinMany.mockResolvedValue({ pinned: [{ id: 'c1', pinnedAt: '2026-11-12T12:00:00.000Z' }], failed: [] })
    muteMany.mockResolvedValue({ muted: [{ conversationId: 'c1', mutedUntil: '2099-01-01T00:00:00.000Z' }], failed: [] })
    archiveMany.mockResolvedValue({ archived: [{ id: 'c1', archivedAt: '2026-11-12T12:00:00.000Z', pinnedAt: null }], failed: [] })
    readMany.mockResolvedValue({ read: [{ id: 'c1', lastReadSeq: 4 }], failed: [] })
    unreadMany.mockResolvedValue({ unread: [{ id: 'c1', lastReadSeq: 3 }], failed: [] })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('opens a right-click menu with pin mute archive and delete', async () => {
    renderSidebar(clientWithLists())
    fireEvent.contextMenu(screen.getByText('Jordan Lee'))
    const menu = await screen.findByTestId('chat-context-menu')
    expect(within(menu).getByTestId('context-pin')).toHaveTextContent('Pin')
    expect(within(menu).getByTestId('context-delete')).toHaveTextContent('Delete')
  })

  it('deletes a deleted-employee chat after confirmation', async () => {
    const user = userEvent.setup()
    const client = clientWithLists()
    renderSidebar(client)
    fireEvent.contextMenu(screen.getByText('Deleted employee'))
    await user.click(await screen.findByTestId('context-delete'))
    expect(await screen.findByText('Delete this chat?')).toBeInTheDocument()
    await user.click(screen.getByTestId('delete-confirm'))
    await waitFor(() => expect(hideMany).toHaveBeenCalledWith(['gone']))
    await waitFor(() => expect(screen.queryByText('Deleted employee')).not.toBeInTheDocument())
  })

  it('cancels delete without calling hide', async () => {
    const user = userEvent.setup()
    renderSidebar(clientWithLists())
    fireEvent.contextMenu(screen.getByText('Jordan Lee'))
    await user.click(await screen.findByTestId('context-delete'))
    await user.click(await screen.findByTestId('delete-cancel'))
    expect(hideMany).not.toHaveBeenCalled()
    expect(screen.getByText('Jordan Lee')).toBeInTheDocument()
  })

  it('hides every selected chat in one request', async () => {
    const user = userEvent.setup()
    hideMany.mockResolvedValue({
      hidden: [
        { id: 'c1', hiddenUntilSeq: 4 },
        { id: 'gone', hiddenUntilSeq: 1 },
      ],
      failed: [],
    })
    renderSidebar(clientWithLists())
    fireEvent.click(screen.getByText('Jordan Lee'), { ctrlKey: true })
    fireEvent.click(screen.getByText('Deleted employee'), { ctrlKey: true })
    expect(screen.getByTestId('selected-count')).toHaveTextContent('2 selected')
    await user.click(screen.getByTestId('toolbar-delete'))
    await user.click(screen.getByTestId('delete-confirm'))
    await waitFor(() => expect(hideMany).toHaveBeenCalledWith(['c1', 'gone']))
  })

  it('pins mutes archives and marks unread from the toolbar', async () => {
    const user = userEvent.setup()
    renderSidebar(clientWithLists())
    fireEvent.click(screen.getByText('Jordan Lee'), { ctrlKey: true })
    await user.click(screen.getByTestId('toolbar-pin'))
    await waitFor(() => expect(pinMany).toHaveBeenCalledWith(['c1'], true))
    fireEvent.click(screen.getByText('Jordan Lee'), { ctrlKey: true })
    await user.click(screen.getByTestId('toolbar-mute'))
    await waitFor(() => expect(muteMany).toHaveBeenCalledWith(['c1'], true))
  })

  it('moves a chat into the archived list', async () => {
    const user = userEvent.setup()
    const client = clientWithLists()
    renderSidebar(client)
    const menus = screen.getAllByTestId('chat-row-menu')
    await user.click(menus[0])
    await user.click(screen.getByTestId('row-action-archive'))
    await waitFor(() => expect(archiveMany).toHaveBeenCalledWith(['c1'], true))
    await waitFor(() => expect(screen.queryByText('Jordan Lee')).not.toBeInTheDocument())
  })

  it('clears selection with Escape', async () => {
    renderSidebar(clientWithLists())
    fireEvent.click(screen.getByText('Jordan Lee'), { ctrlKey: true })
    expect(screen.getByTestId('chat-selection-toolbar')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByTestId('conversation-sidebar'), { key: 'Escape' })
    expect(screen.queryByTestId('chat-selection-toolbar')).not.toBeInTheDocument()
  })

  it('keeps failed chats after a partial bulk hide', async () => {
    const user = userEvent.setup()
    hideMany.mockResolvedValue({
      hidden: [{ id: 'gone', hiddenUntilSeq: 1 }],
      failed: [{ id: 'c1', message: 'Denied' }],
    })
    renderSidebar(clientWithLists())
    fireEvent.click(screen.getByText('Jordan Lee'), { ctrlKey: true })
    fireEvent.click(screen.getByText('Deleted employee'), { ctrlKey: true })
    await user.click(screen.getByTestId('toolbar-delete'))
    await user.click(screen.getByTestId('delete-confirm'))
    await waitFor(() => expect(screen.getByText('Jordan Lee')).toBeInTheDocument())
    await waitFor(() => expect(screen.queryByText('Deleted employee')).not.toBeInTheDocument())
  })
})
