// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SensitiveContentSheet } from './sensitive-content-sheet'

afterEach(cleanup)

describe('SensitiveContentSheet', () => {
  it('opens as a focused modal and closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <SensitiveContentSheet
        open
        reason="Remove an email address, then try again."
        onClose={onClose}
      />,
    )

    expect(screen.getByRole('dialog')).not.toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Back to draft' }),
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders nothing while closed', () => {
    render(<SensitiveContentSheet open={false} reason="" onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
