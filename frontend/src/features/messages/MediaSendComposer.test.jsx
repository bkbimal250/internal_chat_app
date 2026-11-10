import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaSendComposer } from './MediaSendComposer'

afterEach(() => cleanup())

function items() {
  return [
    { id: 'a', kind: 'image', status: 'queued', previewUrl: 'blob:a', file: new File([new Uint8Array(8)], 'one.png', { type: 'image/png' }) },
    { id: 'b', kind: 'image', status: 'queued', previewUrl: 'blob:b', file: new File([new Uint8Array(8)], 'two.png', { type: 'image/png' }) },
    { id: 'c', kind: 'image', status: 'queued', previewUrl: 'blob:c', file: new File([new Uint8Array(8)], 'three.png', { type: 'image/png' }) },
  ]
}

describe('WhatsApp-style media send composer', () => {
  it('shows a full-screen preview, caption, thumbnails and send count', () => {
    render(
      <MediaSendComposer items={items()} caption="" onCaptionChange={() => {}} onSend={() => {}} onRequestClose={() => {}} />,
    )
    expect(screen.getByTestId('attachment-draft-tray')).toHaveAttribute('aria-label', 'Send photos and files')
    expect(screen.getByPlaceholderText('Type a message')).toBeInTheDocument()
    expect(screen.getAllByTestId('attachment-draft-item')).toHaveLength(3)
    expect(screen.getByTestId('send-message')).toHaveTextContent('3')
    expect(screen.getByLabelText('Add files')).toBeInTheDocument()
    expect(screen.getByLabelText('Rotate')).toBeInTheDocument()
    expect(screen.getByLabelText('Brightness')).toBeInTheDocument()
    expect(screen.getByLabelText('HD off')).toBeInTheDocument()
    expect(screen.getByLabelText('Copy')).toBeInTheDocument()
    expect(screen.getByLabelText('Download')).toBeInTheDocument()
    expect(screen.queryByLabelText('Draw')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('attachment-draft-item')[0]).toHaveAttribute('aria-current', 'true')
  })

  it('asks to discard the selection, then keeps or clears it', async () => {
    const user = userEvent.setup()
    const onConfirmDiscard = vi.fn()
    const onCancelDiscard = vi.fn()
    const onRequestClose = vi.fn()
    const { rerender } = render(
      <MediaSendComposer
        items={items()}
        caption=""
        discardOpen={false}
        onRequestClose={onRequestClose}
        onConfirmDiscard={onConfirmDiscard}
        onCancelDiscard={onCancelDiscard}
      />,
    )
    await user.click(screen.getByLabelText('Close'))
    expect(onRequestClose).toHaveBeenCalled()
    rerender(
      <MediaSendComposer
        items={items()}
        caption=""
        discardOpen
        onRequestClose={onRequestClose}
        onConfirmDiscard={onConfirmDiscard}
        onCancelDiscard={onCancelDiscard}
      />,
    )
    expect(screen.getByText('Discard selection?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancelDiscard).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onConfirmDiscard).toHaveBeenCalled()
  })

  it('sends the selected files from the green send control in preview order', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<MediaSendComposer items={items()} caption="caption" onSend={onSend} />)
    await user.click(screen.getByTestId('send-message'))
    expect(onSend).toHaveBeenCalled()
    const sent = onSend.mock.calls[0][0]
    expect(sent.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('selects another thumbnail from the strip', async () => {
    const user = userEvent.setup()
    render(<MediaSendComposer items={items()} caption="" onSend={() => {}} />)
    const thumbs = screen.getAllByTestId('attachment-draft-item')
    await user.click(thumbs[2])
    expect(thumbs[2]).toHaveAttribute('aria-current', 'true')
    expect(thumbs[0]).not.toHaveAttribute('aria-current')
  })

  it('removes a file from the selection', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<MediaSendComposer items={items()} caption="" onSend={() => {}} onRemove={onRemove} />)
    await user.click(screen.getAllByTestId('attachment-draft-remove')[1])
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }))
  })

  it('enables undo after rotating an image', async () => {
    const user = userEvent.setup()
    render(<MediaSendComposer items={items()} caption="" onSend={() => {}} />)
    expect(screen.getByLabelText('Undo')).toBeDisabled()
    await user.click(screen.getByLabelText('Rotate'))
    expect(screen.getByLabelText('Undo')).toBeEnabled()
  })
})
