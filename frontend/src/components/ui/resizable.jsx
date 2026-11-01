import { Group, Panel, Separator } from 'react-resizable-panels'
import { cn } from '@/lib/utils'

function ResizablePanelGroup({ className, ...props }) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn('h-full w-full', className)}
      {...props}
    />
  )
}

function ResizablePanel({ className, ...props }) {
  return (
    <Panel data-slot="resizable-panel" className={cn('min-h-0 min-w-0', className)} {...props} />
  )
}

function ResizableHandle({ className, ...props }) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        'relative z-10 w-1 shrink-0 bg-border transition-colors hover:bg-sidebar-primary active:bg-sidebar-primary',
        className,
      )}
      {...props}
    />
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
