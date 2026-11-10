import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const attachmentsApi = {
  url: vi.fn(),
}

vi.mock('@/services/api', () => ({ attachmentsApi }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

describe('attachment views', () => {
  beforeEach(() => {
    attachmentsApi.url.mockReset()
    attachmentsApi.url.mockResolvedValue({
      url: 'https://storage.test/get?X-Amz-Signature=test',
      fileName: 'MiChat Image 2026-11-10 at 5.42.14 PM.png',
      mimeType: 'image/png',
      inline: true,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      })),
    )
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('loads a signed image preview without exposing storage keys', async () => {
    const { AttachmentMedia } = await import('./AttachmentViews')
    render(
      <AttachmentMedia
        attachment={{
          id: 'att-1',
          kind: 'image',
          status: 'available',
          displayName: 'MiChat Image 2026-11-10 at 5.42.14 PM.png',
          mimeType: 'image/png',
          sizeBytes: 4,
        }}
      />,
    )
    expect(await screen.findByTestId('attachment-image')).toBeInTheDocument()
    expect(attachmentsApi.url).toHaveBeenCalledWith('att-1')
    expect(screen.getByTestId('attachment-image').getAttribute('src')).toContain('storage.test/get')
  })

  it('requests a download URL and fetches the private object', async () => {
    const { downloadAttachment } = await import('./AttachmentViews')
    await downloadAttachment({
      id: 'att-1',
      displayName: 'MiChat Image 2026-11-10 at 5.42.14 PM.png',
      mimeType: 'image/png',
      sizeBytes: 4,
    })
    expect(attachmentsApi.url).toHaveBeenCalledWith('att-1', { download: true })
    expect(fetch).toHaveBeenCalled()
    const requested = fetch.mock.calls[0][0]
    expect(String(requested)).toContain('X-Amz-Signature=test')
  })

  it('shows retry and cancel controls for failed and in-flight uploads', async () => {
    const { UploadProgress } = await import('./AttachmentViews')
    const onRetry = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(
      <UploadProgress item={{ file: { name: 'pixel.png' }, progress: 40, phase: 'uploading' }} onCancel={onCancel} onRetry={onRetry} />,
    )
    expect(screen.getByTestId('upload-progress')).toHaveTextContent('40%')
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
    rerender(
      <UploadProgress
        item={{ file: { name: 'pixel.png' }, progress: 40, error: true }}
        onCancel={onCancel}
        onRetry={onRetry}
      />,
    )
    fireEvent.click(screen.getByText('Retry'))
    expect(onRetry).toHaveBeenCalled()
  })
})
