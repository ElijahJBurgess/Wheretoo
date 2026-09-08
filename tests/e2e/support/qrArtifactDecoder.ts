import { BrowserQRCodeReader } from '@zxing/browser'

export async function decodeQrArtifact(dataUrl: string): Promise<string | null> {
  try {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(image, 0, 0)
    return new BrowserQRCodeReader().decodeFromCanvas(canvas).getText()
  } catch {
    return null
  }
}
