import { describe, expect, it } from 'vitest'
import { isInAppBrowser, isIOS, resolveInstallSurface } from './detect'

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadOS:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 14; SM-S928U Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36',
  instagramIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.0.0',
  facebookIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/467.0.0.0]',
  googleAppIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/320.0.639621219 Mobile/15E148 Safari/604.1',
  desktopFirefox:
    'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  desktopMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}

describe('isIOS', () => {
  it('detects iPhone', () => {
    expect(isIOS(UA.iphoneSafari, 5)).toBe(true)
  })

  it('detects iPadOS masquerading as macOS via touch points', () => {
    expect(isIOS(UA.ipadOS, 5)).toBe(true)
  })

  it('does not flag a real Mac (no touch)', () => {
    expect(isIOS(UA.desktopMac, 0)).toBe(false)
  })

  it('does not flag Android', () => {
    expect(isIOS(UA.androidChrome, 5)).toBe(false)
  })
})

describe('isInAppBrowser', () => {
  it('detects Instagram, Facebook, and Google-app webviews', () => {
    expect(isInAppBrowser(UA.instagramIOS)).toBe(true)
    expect(isInAppBrowser(UA.facebookIOS)).toBe(true)
    expect(isInAppBrowser(UA.googleAppIOS)).toBe(true)
  })

  it('detects generic Android WebViews via the wv token', () => {
    expect(isInAppBrowser(UA.androidWebView)).toBe(true)
  })

  it('does not flag real browsers', () => {
    expect(isInAppBrowser(UA.iphoneSafari)).toBe(false)
    expect(isInAppBrowser(UA.androidChrome)).toBe(false)
    expect(isInAppBrowser(UA.desktopFirefox)).toBe(false)
  })
})

describe('resolveInstallSurface', () => {
  const base = {
    standalone: false,
    inAppBrowser: false,
    ios: false,
    hasNativePrompt: false,
  }

  it('installed wins over everything', () => {
    expect(
      resolveInstallSurface({
        ...base,
        standalone: true,
        ios: true,
        hasNativePrompt: true,
      }),
    ).toBe('installed')
  })

  it('in-app browser wins over install paths (no share sheet in a webview)', () => {
    expect(
      resolveInstallSurface({ ...base, inAppBrowser: true, ios: true }),
    ).toBe('in-app-browser')
  })

  it('native prompt beats the manual iOS hint when both exist', () => {
    // iOS never fires beforeinstallprompt today, but if that ever changes
    // the one-tap path is strictly better than the walkthrough.
    expect(
      resolveInstallSurface({ ...base, ios: true, hasNativePrompt: true }),
    ).toBe('native-prompt')
  })

  it('falls back to the iOS walkthrough, then to nothing', () => {
    expect(resolveInstallSurface({ ...base, ios: true })).toBe('ios-manual')
    expect(resolveInstallSurface(base)).toBe('none')
  })
})
