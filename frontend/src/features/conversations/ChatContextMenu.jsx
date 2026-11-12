import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export function ChatContextMenu({ x, y, actions, onClose }) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-50" data-testid="chat-context-scrim" onMouseDown={onClose}>
      <ul
        role="menu"
        data-testid="chat-context-menu"
        className="bg-popover text-popover-foreground absolute min-w-44 overflow-hidden rounded-md border p-1 shadow-md"
        style={{ left: Math.min(x, window.innerWidth - 180), top: Math.min(y, window.innerHeight - 240) }}
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        {actions.map((action) =>
          action.separator ? (
            <li key={action.id} className="bg-border my-1 h-px" />
          ) : (
            <li key={action.id}>
              <button
                type="button"
                role="menuitem"
                data-testid={`context-${action.id}`}
                className={`flex w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent ${
                  action.destructive ? 'text-destructive' : ''
                }`}
                onClick={() => {
                  action.onSelect()
                  onClose()
                }}
              >
                {action.label}
              </button>
            </li>
          ),
        )}
      </ul>
    </div>,
    document.body,
  )
}
