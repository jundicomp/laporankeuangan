/**
 * Baca/tulis Excel (.xlsx) di browser. Library dimuat saat dibutuhkan saja
 * supaya aplikasi tetap ringan saat dibuka.
 */
import type { Workbook, Worksheet } from 'exceljs'

async function lib() {
  const m = await import('exceljs')
  return (m.default ?? m) as typeof import('exceljs')
}

export type Col = { header: string; key: string; width?: number; money?: boolean }
export type SheetSpec = {
  name: string
  title?: string[]          // baris judul di atas tabel (mis. nama perusahaan, judul laporan, periode)
  columns: Col[]
  rows: Record<string, unknown>[]
  bold?: (row: Record<string, unknown>) => boolean
  note?: string[]           // catatan di bawah tabel
  headerFill?: string
}

function saveBlob(buf: ArrayBuffer, filename: string) {
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
}

function writeSheet(ws: Worksheet, s: SheetSpec) {
  let r = 1
  ;(s.title ?? []).forEach((t, i) => {
    ws.getCell(r, 1).value = t
    ws.getCell(r, 1).font = { bold: i < 2, size: i === 1 ? 13 : 11 }
    r++
  })
  if (s.title?.length) r++
  const headRow = r
  s.columns.forEach((c, i) => {
    const cell = ws.getCell(headRow, i + 1)
    cell.value = c.header
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.headerFill ?? 'FFE3F1EC' } }
    cell.border = { bottom: { style: 'thin' } }
    ws.getColumn(i + 1).width = c.width ?? Math.max(12, c.header.length + 2)
  })
  s.rows.forEach((row, j) => {
    const rr = headRow + 1 + j
    s.columns.forEach((c, i) => {
      const cell = ws.getCell(rr, i + 1)
      const v = row[c.key]
      cell.value = (v === undefined || v === null ? '' : v) as never
      if (c.money) cell.numFmt = '#,##0;(#,##0);"-"'
      if (s.bold?.(row)) cell.font = { bold: true }
    })
  })
  let n = headRow + s.rows.length + 2
  ;(s.note ?? []).forEach((t) => { ws.getCell(n++, 1).value = t })
  ws.views = [{ state: 'frozen', ySplit: headRow }]
}

export async function downloadXlsx(filename: string, sheets: SheetSpec[], prepare?: (wb: Workbook) => void) {
  const X = await lib()
  const wb = new X.Workbook()
  wb.creator = 'Neraca'
  sheets.forEach((s) => writeSheet(wb.addWorksheet(s.name.slice(0, 31)), s))
  prepare?.(wb)
  saveBlob(await wb.xlsx.writeBuffer() as ArrayBuffer, filename)
}

/**
 * Baca sheet pertama. Baris header = baris pertama yang berisi salah satu `expect` kolom.
 * Kunci objek = header huruf kecil tanpa tanda *, spasi jadi garis bawah.
 */
export async function readXlsx(file: File, expect: string[]): Promise<Record<string, unknown>[]> {
  const X = await lib()
  const wb = new X.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('File tidak berisi sheet.')
  const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/\*/g, '').trim().replace(/\s+/g, '_')
  let headerRow = 0
  let keys: string[] = []
  ws.eachRow((row, i) => {
    if (headerRow) return
    const vals = (row.values as unknown[]).slice(1).map(norm)
    if (vals.some((v) => expect.includes(v))) { headerRow = i; keys = vals }
  })
  if (!headerRow) throw new Error(`Kolom judul tidak ditemukan. Pastikan memakai template (kolom: ${expect.join(', ')}).`)
  const out: Record<string, unknown>[] = []
  ws.eachRow((row, i) => {
    if (i <= headerRow) return
    const vals = (row.values as unknown[]).slice(1)
    const o: Record<string, unknown> = {}
    let any = false
    keys.forEach((k, j) => {
      if (!k) return
      let v = vals[j]
      if (v && typeof v === 'object') {
        const obj = v as { result?: unknown; text?: unknown; richText?: { text: string }[] }
        v = obj.result ?? obj.text ?? obj.richText?.map((t) => t.text).join('') ?? ''
      }
      if (v !== undefined && v !== null && v !== '') any = true
      o[k] = v ?? ''
    })
    o._baris = i
    if (any) out.push(o)
  })
  return out
}
