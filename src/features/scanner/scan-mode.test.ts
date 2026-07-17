// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getScanMode,
  SCAN_MODE_EVENT,
  SCAN_MODE_STORAGE,
  setScanMode,
} from './scan-mode'

describe('scan mode store', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to detail (the IMA-34 behavior)', () => {
    expect(getScanMode()).toBe('detail')
  })

  it('persists a set mode', () => {
    setScanMode('compare')
    expect(getScanMode()).toBe('compare')
    setScanMode('chat')
    expect(getScanMode()).toBe('chat')
  })

  it('dispatches the change event for same-tab subscribers', () => {
    const onChange = vi.fn()
    window.addEventListener(SCAN_MODE_EVENT, onChange)
    setScanMode('compare')
    expect(onChange).toHaveBeenCalledTimes(1)
    window.removeEventListener(SCAN_MODE_EVENT, onChange)
  })

  it('survives garbage in storage', () => {
    localStorage.setItem(SCAN_MODE_STORAGE, 'turbo')
    expect(getScanMode()).toBe('detail')
  })
})
