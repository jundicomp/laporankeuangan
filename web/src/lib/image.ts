/** Utilitas gambar logo: buang tepi kosong (putih / transparan) supaya logo tampil penuh. */

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((ok, no) => {
    const i = new Image()
    i.onload = () => ok(i)
    i.onerror = () => no(new Error('x'))
    i.src = src
  })
}

/** Kotak isi gambar tanpa tepi putih/transparan. null bila gambar kosong. */
export function contentBox(img: HTMLImageElement) {
  const w = img.naturalWidth, h = img.naturalHeight
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4
      const empty = d[k + 3] < 20 || (d[k] > 238 && d[k + 1] > 238 && d[k + 2] > 238)
      if (empty) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Data URL baru tanpa tepi kosong. Mengembalikan aslinya bila tidak ada yang perlu dipotong. */
export async function trimImage(src: string): Promise<string> {
  const img = await loadImage(src)
  const b = contentBox(img)
  if (!b || (b.w >= img.naturalWidth - 1 && b.h >= img.naturalHeight - 1)) return src
  const cv = document.createElement('canvas')
  cv.width = b.w
  cv.height = b.h
  cv.getContext('2d')!.drawImage(img, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h)
  return cv.toDataURL('image/png')
}
