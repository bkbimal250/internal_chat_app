import { useState } from 'react'
import { groupsApi } from '@/services/api'
import { groupSettings } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'

function PolicyRow({ label, hint, value, onChange, testId }) {
  return (
    <div className="border-b px-1 py-3 last:border-b-0">
      <p className="text-sm font-medium">{label}</p>
      <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      <div className="grid grid-cols-2 gap-2" data-testid={testId}>
        {[
          ['all', 'All members'],
          ['admins', 'Admins only'],
        ].map(([key, title]) => (
          <button
            key={key}
            type="button"
            className={`rounded-lg border px-3 py-2 text-sm ${value === key ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted/70'}`}
            onClick={() => onChange(key)}
          >
            {title}
          </button>
        ))}
      </div>
    </div>
  )
}

export function GroupPermissionsDialog({ conversation, open, onOpenChange, onSaved }) {
  const current = groupSettings(conversation)
  const [editInfo, setEditInfo] = useState(current.editInfo)
  const [sendMessages, setSendMessages] = useState(current.sendMessages)
  const [addMembers, setAddMembers] = useState(current.addMembers)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const updated = await groupsApi.updateSettings(conversation.id, { editInfo, sendMessages, addMembers })
      onSaved?.(updated)
      onOpenChange(false)
      toast.success('Group permissions updated')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Group permissions</DialogTitle>
          <DialogDescription>Only the group owner can change these settings. The server enforces every option.</DialogDescription>
        </DialogHeader>
        <PolicyRow
          label="Edit group info"
          hint="Name, description, and group photo"
          value={editInfo}
          onChange={setEditInfo}
          testId="perm-edit-info"
        />
        <PolicyRow
          label="Send messages"
          hint="Ordinary members can still read the chat"
          value={sendMessages}
          onChange={setSendMessages}
          testId="perm-send-messages"
        />
        <PolicyRow
          label="Add members"
          hint="Who can invite eligible employees"
          value={addMembers}
          onChange={setAddMembers}
          testId="perm-add-members"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy} data-testid="save-group-permissions">
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
