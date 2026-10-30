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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function AdminDashboardPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ username: '', displayName: '', email: '', role: 'user' })
  const [temporaryPassword, setTemporaryPassword] = useState('')

  const users = useQuery({
    queryKey: queryKeys.adminUsers({ search, page, limit: 20 }),
    queryFn: () => adminApi.users({ search, page, limit: 20 }),
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
        email: form.email || undefined,
        role: form.role,
      }),
    onSuccess: (result) => {
      setTemporaryPassword(result.temporaryPassword)
      refresh()
      toast.success('Employee created')
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

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 overflow-auto p-6">
      <PageHeader
        eyebrow="Control"
        title="Admin dashboard"
        description="Create employees, manage access, and review authentication events."
        actions={<Button onClick={() => setCreateOpen(true)}>New employee</Button>}
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
            <p className="mt-2 text-xs text-muted-foreground">Share this privately. It will not be shown again.</p>
          </CardContent>
        </Card>
      ) : null}
      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">Employees</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="people" className="space-y-4">
          <Input
            placeholder="Search employees"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
          />
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
                      <p className="font-medium">{employee.displayName}</p>
                      <p className="text-xs text-muted-foreground">@{employee.username}</p>
                    </td>
                    <td className="p-3 capitalize">{employee.role}</td>
                    <td className="p-3 capitalize">{employee.status}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
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
      </Tabs>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create employee</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
            <Input placeholder="Display name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
            <Input placeholder="Email (optional)" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
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
    </div>
  )
}
