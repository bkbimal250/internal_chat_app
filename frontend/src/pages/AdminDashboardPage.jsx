import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/common/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { adminApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'
import { formatExactTime } from '@/lib/time'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PhotoEditor } from '@/features/users/PhotoEditor'
import { UserAvatar } from '@/components/common/UserAvatar'
import { syncUserPhoto } from '@/lib/realtime-events'
import { useAuth } from '@/hooks/use-auth'
import { canDeleteEmployee } from '@/lib/permissions'
import { RetentionSettings } from '@/features/retention/RetentionSettings'

const emptyForm = {
  username: '',
  displayName: '',
  fullName: '',
  email: '',
  phone: '',
  address: '',
  role: 'user',
  password: '',
}

function generateTemporaryPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  return `${btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, 'A').slice(0, 16)}9x`
}

export function AdminDashboardPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [temporaryPassword, setTemporaryPassword] = useState('')

  const users = useQuery({
    queryKey: queryKeys.adminUsers({ search, page, limit: 20, status, role }),
    queryFn: () =>
      adminApi.users({
        search,
        page,
        limit: 20,
        status: status || undefined,
        role: role || undefined,
      }),
  })
  const audit = useQuery({
    queryKey: queryKeys.adminAudit({ page: 1, limit: 20 }),
    queryFn: () => adminApi.audit({ page: 1, limit: 20 }),
  })

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    queryClient.invalidateQueries({ queryKey: ['admin-audit'] })
  }

  const createUser = useMutation({
    mutationFn: () =>
      adminApi.createUser({
        username: form.username,
        displayName: form.displayName,
        fullName: form.fullName || form.displayName,
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        role: form.role,
        password: form.password || undefined,
      }),
    onSuccess: (result) => {
      setTemporaryPassword(result.temporaryPassword)
      setCreateOpen(false)
      setForm(emptyForm)
      refresh()
      toast.success('Employee created')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const saveUser = useMutation({
    mutationFn: () =>
      adminApi.updateUser(editUser.id, {
        displayName: form.displayName,
        fullName: form.fullName || form.displayName,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        role: form.role,
      }),
    onSuccess: () => {
      setEditUser(null)
      refresh()
      toast.success('Employee updated')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  async function act(label, fn) {
    try {
      const result = await fn()
      refresh()
      if (result?.temporaryPassword) setTemporaryPassword(result.temporaryPassword)
      toast.success(label)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await adminApi.removeUser(pendingDelete.id)
      setPendingDelete(null)
      refresh()
      toast.success('Employee deleted')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  function openEdit(employee) {
    setEditUser(employee)
    setForm({
      username: employee.username,
      displayName: employee.displayName ?? '',
      fullName: employee.fullName ?? employee.displayName ?? '',
      email: employee.email ?? '',
      phone: employee.phoneE164 ?? '',
      address: employee.address ?? '',
      role: employee.role,
      password: '',
    })
  }

  function onEmployeePhoto(updated) {
    if (!updated) return
    syncUserPhoto(updated)
    setEditUser(updated)
    refresh()
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 overflow-auto p-6">
      <PageHeader
        eyebrow="Control"
        title="Admin dashboard"
        description="Create employees, manage access, and review authentication events."
        actions={<Button onClick={() => { setForm(emptyForm); setCreateOpen(true) }}>New employee</Button>}
      />
      {temporaryPassword ? (
        <Card>
          <CardHeader>
            <CardTitle>One-time password</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-sm" data-testid="temporary-password">
              {temporaryPassword}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">Share this privately. Existing passwords cannot be retrieved.</p>
          </CardContent>
        </Card>
      ) : null}
      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">Employees</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="retention">Retention</TabsTrigger>
        </TabsList>
        <TabsContent value="people" className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem]">
            <Input
              placeholder="Search employees"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
            />
            <select
              aria-label="Filter status"
              className="border-input h-10 rounded-md border bg-card px-3 text-sm"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
            <select
              aria-label="Filter role"
              className="border-input h-10 rounded-md border bg-card px-3 text-sm"
              value={role}
              onChange={(event) => {
                setRole(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All roles</option>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left">
                <tr>
                  <th className="p-3">Person</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(users.data?.data ?? []).map((employee) => (
                  <tr key={employee.id} className="border-t" data-testid="admin-employee-row">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <UserAvatar person={employee} />
                        <div>
                          <p className="font-medium">{employee.displayName}</p>
                          <p className="text-xs text-muted-foreground">@{employee.username}</p>
                          {employee.phoneE164 ? (
                            <p className="text-xs text-muted-foreground">{employee.phoneE164}</p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="p-3 capitalize">{employee.role}</td>
                    <td className="p-3 capitalize">{employee.status}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" size="sm" variant="outline" onClick={() => openEdit(employee)}>
                          Edit
                        </Button>
                        {employee.status === 'active' ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => act('Account suspended', () => adminApi.suspend(employee.id))}>
                            Suspend
                          </Button>
                        ) : (
                          <Button type="button" size="sm" variant="outline" onClick={() => act('Account reactivated', () => adminApi.reactivate(employee.id))}>
                            Reactivate
                          </Button>
                        )}
                        <Button type="button" size="sm" variant="outline" onClick={() => act('Password reset', () => adminApi.resetPassword(employee.id))}>
                          Reset password
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          data-testid="admin-revoke"
                          onClick={() => act('Sessions revoked', () => adminApi.revokeSessions(employee.id))}
                        >
                          Revoke sessions
                        </Button>
                        {canDeleteEmployee(user, employee) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            data-testid="admin-delete"
                            onClick={() => setPendingDelete(employee)}
                          >
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              Previous
            </Button>
            <Button variant="outline" disabled={(users.data?.data?.length ?? 0) < 20} onClick={() => setPage((value) => value + 1)}>
              Next
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="audit">
          <ul className="space-y-2">
            {(audit.data?.data ?? []).map((entry) => (
              <li key={entry.id} className="rounded-lg border bg-card p-3 text-sm">
                <p className="font-medium">{entry.action}</p>
                <p className="text-xs text-muted-foreground">{formatExactTime(entry.createdAt)}</p>
              </li>
            ))}
          </ul>
        </TabsContent>
        <TabsContent value="retention">
          <RetentionSettings />
        </TabsContent>
      </Tabs>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create employee</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-3 overflow-auto">
            <Input placeholder="Username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
            <Input placeholder="Display name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
            <Input placeholder="Full name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
            <Input placeholder="Email (optional)" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            <Input placeholder="Phone E.164 (optional)" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            <Input placeholder="Address (optional)" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
            <div className="flex gap-2">
              <Input
                placeholder="Temporary password (optional)"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
              <Button type="button" variant="outline" onClick={() => setForm({ ...form, password: generateTemporaryPassword() })}>
                Generate
              </Button>
            </div>
            <select
              className="border-input h-10 w-full rounded-md border bg-card px-3 text-sm"
              value={form.role}
              aria-label="Role"
              onChange={(event) => setForm({ ...form, role: event.target.value })}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <DialogFooter>
            <Button onClick={() => createUser.mutate()} disabled={createUser.isPending}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(editUser)} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit employee</DialogTitle>
          </DialogHeader>
          {editUser ? (
            <div className="max-h-[70vh] space-y-3 overflow-auto">
              <p className="text-sm text-muted-foreground">@{editUser.username}</p>
              <Input placeholder="Display name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
              <Input placeholder="Full name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
              <Input placeholder="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
              <Input placeholder="Phone E.164" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
              <Input placeholder="Address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
              <select
                className="border-input h-10 w-full rounded-md border bg-card px-3 text-sm"
                value={form.role}
                aria-label="Role"
                onChange={(event) => setForm({ ...form, role: event.target.value })}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <PhotoEditor
                person={editUser}
                initFn={(body) => adminApi.initPhoto(editUser.id, body)}
                completeFn={(body) => adminApi.completePhoto(editUser.id, body)}
                removeFn={() => adminApi.removePhoto(editUser.id)}
                onChanged={onEmployeePhoto}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => saveUser.mutate()} disabled={saveUser.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && !deleting && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete employee?</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `This deactivates @${pendingDelete.username}. Their messages stay in chat history, and they will not be able to sign in again.`
                : 'This deactivates the employee. Their messages stay in chat history, and they will not be able to sign in again.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              data-testid="cancel-delete-employee"
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="confirm-delete-employee"
              disabled={deleting}
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
