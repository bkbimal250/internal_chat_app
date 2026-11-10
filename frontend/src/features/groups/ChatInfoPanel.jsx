import { useMemo, useState } from 'react'
import { useWorkspace } from '@/hooks/use-workspace'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  Download,
  FileText,
  Image as ImageIcon,
  Link2,
  LogOut,
  MoreVertical,
  Pencil,
  Search,
  Settings,
  Shield,
  UserPlus,
  UserMinus,
  Users,
} from 'lucide-react'
import { conversationsApi, groupsApi, retentionApi } from '@/services/api'
import { AddMembersDialog } from '@/features/groups/AddMembersDialog'
import { GroupPermissionsDialog } from '@/features/groups/GroupPermissionsDialog'
import { PHOTO_ACCEPT, uploadProfilePhoto } from '@/features/users/upload-photo'
import { queryKeys } from '@/lib/query-keys'
import {
  canAddGroupMembers,
  canEditGroupInfo,
  canRemoveMember,
  canTransferOwnership,
  groupSettings,
  memberRole,
} from '@/lib/permissions'
import { useAuth } from '@/hooks/use-auth'
import { useUiStore } from '@/stores/ui-store'
import { UserAvatar } from '@/components/common/UserAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AttachmentMedia, AttachmentThumb, downloadAttachment } from '@/features/messages/AttachmentViews'
import { downloadAttachmentsZip } from '@/features/messages/download-zip'
import { attachmentDisplayName } from '@/lib/michat-filename'
import { asDate, formatExactTime, formatMessageTime } from '@/lib/time'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const LINK_RE = /https?:\/\/[^\s<>]+/gi

function collectShared(messages) {
  const media = []
  const docs = []
  const links = []
  for (const message of messages ?? []) {
    if (message.deletedAt) continue
    const files = Array.isArray(message.attachments) && message.attachments.length
      ? message.attachments
      : message.attachment
        ? [message.attachment]
        : []
    for (const attachment of files) {
      if (attachment?.status !== 'available') continue
      if (attachment.kind === 'image' || attachment.kind === 'video') {
        media.push({ message, attachment })
      } else {
        docs.push({ message, attachment })
      }
    }
    const matches = String(message.content || '').match(LINK_RE)
    if (matches) {
      matches.forEach((url) => links.push({ message, url }))
    }
  }
  return { media, docs, links }
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function linkHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function mediaPeriodLabel(value) {
  const date = asDate(value)
  if (!date) return 'Older'
  const now = new Date()
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) return 'This month'
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  if (date.getFullYear() === last.getFullYear() && date.getMonth() === last.getMonth()) return 'Last month'
  return format(date, 'MMMM yyyy')
}

function groupByPeriod(items, getDate) {
  const groups = []
  const index = new Map()
  for (const item of items) {
    const label = mediaPeriodLabel(getDate(item))
    let group = index.get(label)
    if (!group) {
      group = { label, items: [] }
      index.set(label, group)
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

const tabTriggerClass =
  'h-full flex-1 rounded-none border-b-2 border-transparent bg-transparent text-muted-foreground shadow-none transition-none data-[state=active]:border-emerald-600 data-[state=active]:bg-transparent data-[state=active]:text-emerald-700 data-[state=active]:shadow-none'

function SharedMediaScreen({ shared, onBack, onOpenMedia, conversationId }) {
  const [tab, setTab] = useState('media')
  const mediaGroups = useMemo(
    () => groupByPeriod(shared.media, (item) => item.message.createdAt),
    [shared.media],
  )
  const docGroups = useMemo(
    () => groupByPeriod(shared.docs, (item) => item.message.createdAt),
    [shared.docs],
  )
  const linkGroups = useMemo(
    () => groupByPeriod(shared.links, (item) => item.message.createdAt),
    [shared.links],
  )

  const [zipping, setZipping] = useState(false)

  async function saveDoc(attachment) {
    try {
      await downloadAttachment(attachment)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function downloadAll(items) {
    const ids = items.map((item) => item.attachment?.id).filter(Boolean)
    if (!conversationId || ids.length < 2 || zipping) return
    setZipping(true)
    try {
      await downloadAttachmentsZip({ conversationId, ids })
    } catch (error) {
      if (error?.name !== 'AbortError') toast.error(getErrorMessage(error) || 'Unable to download ZIP')
    } finally {
      setZipping(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="shared-media-gallery">
      <div className="flex h-12 items-center gap-1 border-b px-1">
        <Button type="button" variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft className="size-5" />
        </Button>
        <SheetTitle className="text-base font-semibold">Media, links and docs</SheetTitle>
        {tab !== 'links' && (tab === 'media' ? shared.media : shared.docs).length > 1 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto mr-2"
            data-testid="download-all-zip"
            disabled={zipping}
            onClick={() => downloadAll(tab === 'media' ? shared.media : shared.docs)}
          >
            {zipping ? 'Preparing ZIP…' : 'Download all'}
          </Button>
        ) : null}
      </div>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="h-12 w-full justify-stretch rounded-none border-b bg-background p-0">
          <TabsTrigger value="media" className={tabTriggerClass} data-testid="media-tab-media">
            Media
          </TabsTrigger>
          <TabsTrigger value="docs" className={tabTriggerClass} data-testid="media-tab-docs">
            Docs
          </TabsTrigger>
          <TabsTrigger value="links" className={tabTriggerClass} data-testid="media-tab-links">
            Links
          </TabsTrigger>
        </TabsList>
        <TabsContent value="media" className="min-h-0 flex-1 overflow-y-auto p-0">
          {shared.media.length ? (
            mediaGroups.map((group) => (
              <section key={group.label} className="pb-4">
                <p className="px-4 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </p>
                <div className="grid grid-cols-3 gap-0.5">
                  {group.items.map((item) => (
                    <AttachmentThumb
                      key={item.attachment.id}
                      attachment={item.attachment}
                      className="aspect-square w-full rounded-[2px]"
                      onClick={() => onOpenMedia(item)}
                    />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No media yet</p>
          )}
        </TabsContent>
        <TabsContent value="docs" className="min-h-0 flex-1 overflow-y-auto p-0">
          {shared.docs.length ? (
            docGroups.map((group) => (
              <section key={group.label}>
                <p className="px-4 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </p>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.attachment.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex size-11 items-center justify-center rounded-lg bg-muted">
                        <FileText className="size-5 text-muted-foreground" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{attachmentDisplayName(item.attachment)}</p>
                        <p className="text-xs text-muted-foreground">
                          {[formatSize(item.attachment.sizeBytes), formatMessageTime(item.message.createdAt)]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Download"
                        onClick={() => saveDoc(item.attachment)}
                      >
                        <Download className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No documents yet</p>
          )}
        </TabsContent>
        <TabsContent value="links" className="min-h-0 flex-1 overflow-y-auto p-0">
          {shared.links.length ? (
            linkGroups.map((group) => (
              <section key={group.label}>
                <p className="px-4 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </p>
                <ul>
                  {group.items.map((item) => (
                    <li key={`${item.message.id}-${item.url}`}>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/70"
                      >
                        <span className="flex size-11 items-center justify-center rounded-lg bg-muted">
                          <Link2 className="size-5 text-muted-foreground" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{linkHost(item.url)}</p>
                          <p className="truncate text-xs text-muted-foreground">{item.url}</p>
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No links yet</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function InfoRow({ icon: Icon, title, subtitle, onClick, trailing, danger, ...props }) {
  const inner = (
    <>
      <Icon className={cn('size-5 shrink-0', danger ? 'text-destructive' : 'text-muted-foreground')} />
      <div className="min-w-0 flex-1 text-left">
        <p className={cn('text-sm font-medium', danger && 'text-destructive')}>{title}</p>
        {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {trailing ?? (onClick ? <ChevronRight className="size-4 text-muted-foreground" /> : null)}
    </>
  )
  if (!onClick) {
    return (
      <div className="flex items-center gap-3 px-4 py-3" {...props}>
        {inner}
      </div>
    )
  }
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 px-4 py-3 hover:bg-muted/70"
      onClick={onClick}
      {...props}
    >
      {inner}
    </button>
  )
}

export function ChatInfoPanel({ conversation, messages = [], open, onOpenChange }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { closeChat, openChat } = useWorkspace()
  const addMembersOpen = useUiStore((state) => state.addMembersOpen)
  const setAddMembersOpen = useUiStore((state) => state.setAddMembersOpen)
  const [memberQuery, setMemberQuery] = useState('')
  const [editingAbout, setEditingAbout] = useState(false)
  const [about, setAbout] = useState(conversation?.description ?? '')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [mediaOpen, setMediaOpen] = useState(false)
  const [activeMedia, setActiveMedia] = useState(null)
  const [showMemberSearch, setShowMemberSearch] = useState(false)
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [viewingMember, setViewingMember] = useState(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(conversation?.title ?? '')
  const isGroup = conversation?.type === 'group'
  const role = memberRole(conversation?.members, user?.id)
  const settings = groupSettings(conversation)
  const manage = isGroup && canAddGroupMembers(role, settings)
  const canEdit = isGroup && canEditGroupInfo(role, settings)
  const members = conversation?.members ?? []
  const shared = useMemo(() => {
    const collected = collectShared(messages)
    return {
      media: [...collected.media].reverse(),
      docs: [...collected.docs].reverse(),
      links: [...collected.links].reverse(),
    }
  }, [messages])
  const mediaCount = shared.media.length + shared.docs.length + shared.links.length

  function openGallery() {
    setMediaOpen(true)
  }

  const peer = members.find((member) => member.id !== user?.id)
  const title = isGroup ? conversation?.title || 'Group' : peer?.displayName || 'Chat'

  const visibleMembers = members
    .filter((member) => {
      if (!memberQuery.trim()) return true
      return member.displayName.toLowerCase().includes(memberQuery.trim().toLowerCase())
    })
    .slice()
    .sort((a, b) => {
      const rank = { owner: 0, admin: 1, member: 2 }
      const diff = (rank[a.role] ?? 9) - (rank[b.role] ?? 9)
      if (diff !== 0) return diff
      return a.displayName.localeCompare(b.displayName)
    })

  function patchMembers(updater) {
    queryClient.setQueryData(queryKeys.conversation(conversation.id), (current) => {
      if (!current?.members) return current
      return { ...current, members: updater(current.members) }
    })
  }

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversation.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.group(conversation.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
      queryClient.invalidateQueries({ queryKey: ['group-photo-url', conversation.id] }),
    ])
  }

  async function saveAbout() {
    try {
      const updated = await groupsApi.update(conversation.id, { description: about.trim() || null })
      queryClient.setQueryData(queryKeys.conversation(conversation.id), (current) =>
        current ? { ...current, description: updated.description } : current,
      )
      setEditingAbout(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const description = conversation?.description || ''
  const longAbout = description.length > 140
  const shownAbout = aboutOpen || !longAbout ? description : `${description.slice(0, 140).trim()}…`

  return (
    <>
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setMediaOpen(false)
          setActiveMedia(null)
        }
        onOpenChange(next)
      }}
    >
      <SheetContent className="z-[60] w-full gap-0 overflow-hidden p-0 sm:max-w-md">
        {mediaOpen ? (
          <SharedMediaScreen
            shared={shared}
            conversationId={conversation?.id}
            onBack={() => setMediaOpen(false)}
            onOpenMedia={setActiveMedia}
          />
        ) : (
          <>
        <div className="flex h-14 items-center gap-2 border-b px-3">
          <p className="text-sm font-medium">{isGroup ? 'Group info' : 'Contact info'}</p>
        </div>
        <div className="h-[calc(100vh-3.5rem)] overflow-y-auto">
          <div className="flex flex-col items-center px-6 pt-6 pb-5 text-center">
            {isGroup ? (
              <div className="flex flex-col items-center">
                <UserAvatar
                  variant="group"
                  userId={conversation.id}
                  name={title}
                  hasPhoto={conversation.hasAvatar}
                  photoVersion={conversation.avatarVersion}
                  className="size-28"
                  fallbackClassName="text-3xl"
                  tooltip={false}
                />
                {canEdit ? (
                  <div className="mt-2 flex gap-2">
                    <label className="text-xs font-medium text-primary">
                      <input
                        type="file"
                        accept={PHOTO_ACCEPT}
                        className="sr-only"
                        data-testid="group-photo-input"
                        onChange={async (event) => {
                          const file = event.target.files?.[0]
                          event.target.value = ''
                          if (!file) return
                          try {
                            await uploadProfilePhoto(
                              file,
                              (body) => groupsApi.initPhoto(conversation.id, body),
                              (body) => groupsApi.completePhoto(conversation.id, body),
                            )
                            await refresh()
                            toast.success('Group photo updated')
                          } catch (error) {
                            toast.error(getErrorMessage(error))
                          }
                        }}
                      />
                      <span className="inline-flex items-center gap-1">
                        <Camera className="size-3.5" /> Change photo
                      </span>
                    </label>
                    {conversation.hasAvatar ? (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground"
                        onClick={async () => {
                          try {
                            await groupsApi.removePhoto(conversation.id)
                            await refresh()
                          } catch (error) {
                            toast.error(getErrorMessage(error))
                          }
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <UserAvatar person={peer} name={title} className="size-28" fallbackClassName="text-3xl" tooltip={false} />
            )}
            {editingTitle && canEdit ? (
              <div className="mt-4 flex w-full gap-2">
                <Input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} maxLength={120} />
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await groupsApi.update(conversation.id, { title: titleDraft.trim() })
                      setEditingTitle(false)
                      await refresh()
                    } catch (error) {
                      toast.error(getErrorMessage(error))
                    }
                  }}
                >
                  Save
                </Button>
              </div>
            ) : (
              <SheetTitle className="mt-4 text-xl font-semibold tracking-tight">
                {title}
                {canEdit ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="ml-1 size-8"
                    aria-label="Edit group name"
                    onClick={() => {
                      setTitleDraft(conversation?.title ?? '')
                      setEditingTitle(true)
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                ) : null}
              </SheetTitle>
            )}
            <p className="mt-1 text-sm font-medium text-emerald-600">
              {isGroup ? `Group · ${members.length} members` : 'Private chat'}
            </p>
            {conversation?.createdAt ? (
              <p className="mt-1 text-xs text-muted-foreground">Created {formatExactTime(conversation.createdAt)}</p>
            ) : null}
          </div>

          {isGroup ? (
            <div className="mb-3 flex justify-center gap-8 pb-2">
              {manage ? (
                <button
                  type="button"
                  className="flex flex-col items-center gap-1 text-xs font-medium text-primary"
                  onClick={() => setAddMembersOpen(true)}
                  aria-label="Add member"
                  data-testid="open-add-members"
                >
                  <span className="flex size-12 items-center justify-center rounded-full bg-muted">
                    <UserPlus className="size-5" />
                  </span>
                  Add
                </button>
              ) : null}
              <button
                type="button"
                className="flex flex-col items-center gap-1 text-xs font-medium text-primary"
                onClick={() => {
                  setShowMemberSearch(true)
                  window.requestAnimationFrame(() => document.getElementById('member-search')?.focus())
                }}
              >
                <span className="flex size-12 items-center justify-center rounded-full bg-muted">
                  <Search className="size-5" />
                </span>
                Search
              </button>
            </div>
          ) : null}

          <div className="bg-muted/40 py-1">
            <div className="bg-background">
              {editingAbout && canEdit ? (
                <div className="px-4 py-3">
                  <p className="mb-2 text-xs font-medium text-primary">Description</p>
                  <Textarea
                    value={about}
                    onChange={(event) => setAbout(event.target.value)}
                    className="min-h-24"
                    maxLength={2000}
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingAbout(false)
                        setAbout(conversation?.description ?? '')
                      }}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveAbout}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-primary">Description</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">
                        {shownAbout || 'No description yet.'}
                      </p>
                      {longAbout ? (
                        <button
                          type="button"
                          className="mt-1 text-sm font-medium text-emerald-700"
                          onClick={() => setAboutOpen((value) => !value)}
                        >
                          {aboutOpen ? 'Read less' : 'Read more'}
                        </button>
                      ) : null}
                    </div>
                    {canEdit ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Edit description"
                        onClick={() => {
                          setAbout(conversation?.description ?? '')
                          setEditingAbout(true)
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>

          {isGroup && role === 'owner' ? (
            <div className="mt-2 bg-background">
              <InfoRow
                icon={Settings}
                title="Group permissions"
                subtitle="Who can edit info, send messages, and add members"
                data-testid="open-group-permissions"
                onClick={() => setPermissionsOpen(true)}
              />
            </div>
          ) : null}

          <div className="mt-2 bg-background">
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 hover:bg-muted/70"
              onClick={openGallery}
              data-testid="open-shared-media"
            >
              <ImageIcon className="size-5 text-muted-foreground" />
              <div className="min-w-0 flex-1 text-left">
                <p className="text-sm font-medium">Media, links and docs</p>
                <p className="text-xs text-muted-foreground">
                  {mediaCount ? `${shared.media.length} media · ${shared.links.length} links · ${shared.docs.length} docs` : 'None yet'}
                </p>
              </div>
              <span className="text-sm text-muted-foreground">{mediaCount || ''}</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
            {shared.media.length ? (
              <div className="grid grid-cols-3 gap-0.5 px-4 pb-3">
                {shared.media.slice(0, 3).map((item) => (
                  <AttachmentThumb
                    key={item.attachment.id}
                    attachment={item.attachment}
                    className="aspect-square w-full rounded-sm"
                    onClick={openGallery}
                  />
                ))}
              </div>
            ) : null}
          </div>

          {isGroup ? (
            <div className="mt-2 bg-background">
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-sm font-medium">{members.length} members</p>
              </div>
              {showMemberSearch || members.length > 8 || memberQuery ? (
                <div className="px-4 pb-2">
                  <Input
                    id="member-search"
                    value={memberQuery}
                    onChange={(event) => setMemberQuery(event.target.value)}
                    placeholder="Search members"
                  />
                </div>
              ) : (
                <input id="member-search" className="sr-only" tabIndex={-1} readOnly />
              )}
              {visibleMembers.map((member) => {
                const showActions = member.id !== user.id
                const canPromote = role === 'owner' && member.role !== 'owner'
                const canMakeOwner = canTransferOwnership(role) && member.role !== 'owner'
                const canRemove = canRemoveMember(role, member.role, false)
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 px-4 py-2.5"
                    data-testid="group-member"
                    data-member-role={member.role}
                  >
                    <UserAvatar person={member} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {member.displayName}
                        {member.id === user.id ? ' (You)' : ''}
                      </p>
                      <p className="text-xs capitalize text-muted-foreground">{member.role}</p>
                    </div>
                    {member.role === 'owner' ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        Owner
                      </span>
                    ) : member.role === 'admin' ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                        Admin
                      </span>
                    ) : null}
                    {showActions ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label="Member actions">
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setViewingMember(member)}>
                            View profile
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={async () => {
                              try {
                                const chat = await conversationsApi.direct(member.id)
                                onOpenChange(false)
                                openChat(chat.id)
                              } catch (error) {
                                toast.error(getErrorMessage(error))
                              }
                            }}
                          >
                            Message participant
                          </DropdownMenuItem>
                          {canPromote ? (
                            <DropdownMenuItem
                              data-testid={member.role === 'admin' ? 'member-demote' : 'member-promote'}
                              onClick={async () => {
                                const nextRole = member.role === 'admin' ? 'member' : 'admin'
                                try {
                                  await groupsApi.setRole(conversation.id, member.id, nextRole)
                                  patchMembers((rows) =>
                                    rows.map((row) => (row.id === member.id ? { ...row, role: nextRole } : row)),
                                  )
                                  await refresh()
                                } catch (error) {
                                  toast.error(getErrorMessage(error))
                                }
                              }}
                            >
                              <Shield className="size-4" />
                              {member.role === 'admin' ? 'Dismiss as admin' : 'Make group admin'}
                            </DropdownMenuItem>
                          ) : null}
                          {canMakeOwner ? (
                            <DropdownMenuItem
                              data-testid="member-make-owner"
                              onClick={() => setConfirm({ type: 'transfer', member })}
                            >
                              <Users className="size-4" />
                              Transfer ownership
                            </DropdownMenuItem>
                          ) : null}
                          {canRemove ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                data-testid="member-remove"
                                onClick={() => setConfirm({ type: 'remove', member })}
                              >
                                <UserMinus className="size-4" />
                                Remove
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                )
              })}

              {manage ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 border-t px-4 py-3 text-left hover:bg-muted/70"
                  onClick={() => setAddMembersOpen(true)}
                  data-testid="open-add-members-row"
                >
                  <span className="flex size-10 items-center justify-center rounded-full bg-emerald-600 text-white">
                    <UserPlus className="size-5" />
                  </span>
                  <span className="text-sm font-medium">Add member</span>
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-2 bg-background">
            <InfoRow
              icon={Download}
              title="Export this chat"
              subtitle="Download a copy of messages you can still access before they expire"
              data-testid="export-chat"
              onClick={async () => {
                try {
                  const job = await retentionApi.exportChat(conversation.id)
                  toast.success('Export started. Check again shortly for a download link.')
                  const poll = async (attempt = 0) => {
                    const status = await retentionApi.exportStatus(job.id)
                    if (status.downloadUrl) {
                      window.open(status.downloadUrl, '_blank', 'noopener')
                      return
                    }
                    if (status.status === 'failed') throw new Error(status.error || 'Export failed')
                    if (attempt > 20) throw new Error('Export is still preparing')
                    await new Promise((resolve) => setTimeout(resolve, 1500))
                    return poll(attempt + 1)
                  }
                  await poll()
                } catch (error) {
                  toast.error(getErrorMessage(error))
                }
              }}
            />
          </div>
          {isGroup && role && role !== 'owner' ? (
            <div className="mt-2 mb-6 bg-background">
              <InfoRow
                icon={LogOut}
                title="Exit group"
                danger
                data-testid="leave-group"
                onClick={() => setConfirm({ type: 'leave' })}
              />
            </div>
          ) : (
            <div className="h-6" />
          )}
        </div>
          </>
        )}
      </SheetContent>

      <Dialog open={Boolean(activeMedia)} onOpenChange={(next) => !next && setActiveMedia(null)}>
        <DialogContent className="max-w-4xl border-none bg-black p-2">
          <DialogTitle className="sr-only">{attachmentDisplayName(activeMedia?.attachment)}</DialogTitle>
          {activeMedia ? <AttachmentMedia attachment={activeMedia.attachment} /> : null}
        </DialogContent>
      </Dialog>
    </Sheet>
    {isGroup && conversation?.id ? (
      <AddMembersDialog
        open={Boolean(addMembersOpen && manage)}
        onOpenChange={setAddMembersOpen}
        conversationId={conversation.id}
        members={members}
        onAdded={refresh}
      />
    ) : null}
    {isGroup && conversation?.id ? (
      <GroupPermissionsDialog
        key={`${conversation.id}-${conversation.settings?.editInfo}-${conversation.settings?.sendMessages}-${conversation.settings?.addMembers}`}
        conversation={conversation}
        open={permissionsOpen}
        onOpenChange={setPermissionsOpen}
        onSaved={refresh}
      />
    ) : null}
    <Dialog open={Boolean(viewingMember)} onOpenChange={(next) => !next && setViewingMember(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>Participant</DialogTitle>
        {viewingMember ? (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <UserAvatar person={viewingMember} className="size-20" tooltip={false} />
            <div>
              <p className="text-base font-medium">{viewingMember.fullName || viewingMember.displayName}</p>
              <p className="text-sm text-muted-foreground">@{viewingMember.username}</p>
              <p className="mt-1 text-xs capitalize text-muted-foreground">{viewingMember.role}</p>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(confirm)} onOpenChange={(next) => !next && setConfirm(null)}>
      <DialogContent>
        <DialogTitle>
          {confirm?.type === 'transfer'
            ? 'Transfer group ownership?'
            : confirm?.type === 'leave'
              ? 'Leave this group?'
              : 'Remove member?'}
        </DialogTitle>
        <p className="text-sm text-muted-foreground">
          {confirm?.type === 'transfer'
            ? `${confirm.member.displayName} will become the only owner. You will become a group admin.`
            : confirm?.type === 'leave'
              ? 'You will lose access immediately. The owner must transfer ownership before leaving.'
              : `${confirm?.member?.displayName} will lose access immediately.`}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            variant={confirm?.type === 'remove' || confirm?.type === 'leave' ? 'destructive' : 'default'}
            onClick={async () => {
              try {
                if (confirm.type === 'transfer') {
                  await groupsApi.transferOwner(conversation.id, confirm.member.id)
                  patchMembers((rows) =>
                    rows.map((row) => {
                      if (row.id === confirm.member.id) return { ...row, role: 'owner' }
                      if (row.role === 'owner') return { ...row, role: 'admin' }
                      return row
                    }),
                  )
                } else if (confirm.type === 'leave') {
                  await groupsApi.leave(conversation.id)
                  setConfirm(null)
                  onOpenChange(false)
                  closeChat()
                  return
                } else {
                  await groupsApi.removeMember(conversation.id, confirm.member.id)
                  patchMembers((rows) => rows.filter((row) => row.id !== confirm.member.id))
                }
                setConfirm(null)
                await refresh()
              } catch (error) {
                toast.error(getErrorMessage(error))
              }
            }}
          >
            Confirm
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
