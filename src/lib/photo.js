// Phone photos are 3–8 MB and any shape. The reception board shows them in a
// grid of small circles, so we square-crop and shrink to 600×600 in the browser
// BEFORE upload: ~60 KB instead of 6 MB, uniform grid, and it uploads in a
// second on club wifi.
export function squarePhoto(file, size = 600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const side = Math.min(img.width, img.height)      // centre-crop to square
      const sx = (img.width - side) / 2
      const sy = (img.height - side) / 2
      const c = document.createElement('canvas')
      c.width = c.height = size
      const ctx = c.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
      c.toBlob(
        (blob) => (blob ? resolve(new File([blob], 'profile.jpg', { type: 'image/jpeg' })) : reject(new Error('Could not process the photo'))),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image')) }
    img.src = url
  })
}
