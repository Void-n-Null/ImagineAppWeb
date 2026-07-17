/**
 * Downscale a photo before attaching it to a chat message. Full-resolution
 * phone camera output is 5-12MB; vision models bill by resolution and the
 * request rides the user's data plan on a store floor. 1280px JPEG keeps
 * shelf tags and box labels legible at a fraction of the payload.
 */

import type { ImageAttachment } from '#/features/agent'

const MAX_DIMENSION = 1280
const JPEG_QUALITY = 0.85

export async function compressImageFile(file: File): Promise<ImageAttachment> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(
      1,
      MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
    )
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D unavailable')
    ctx.drawImage(bitmap, 0, 0, width, height)

    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    return { dataUrl, mimeType: 'image/jpeg' }
  } finally {
    bitmap.close()
  }
}
