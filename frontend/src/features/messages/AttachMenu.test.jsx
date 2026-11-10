import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachMenu } from './AttachMenu'

afterEach(() => cleanup())

describe('AttachMenu', () => {
  it('exposes the attach control for enabled chats', () => {
    render(<AttachMenu onPick={() => {}} />)
    expect(screen.getByTestId('attach-menu')).toHaveAttribute('aria-label', 'Attach')
    expect(screen.getByTestId('attach-menu')).not.toBeDisabled()
  })

  it('disables attach when the composer cannot send', () => {
    render(<AttachMenu disabled onPick={() => {}} />)
    expect(screen.getByTestId('attach-menu')).toBeDisabled()
  })
})
