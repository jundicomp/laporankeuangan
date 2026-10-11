/** Format & parsing angka rupiah gaya Indonesia: 1.250.000,50 */
const nf = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

export function rp(n: number | string | null | undefined, dashZero = false) {
  const v = Number(n) || 0
  if (dashZero && v === 0) return '—'
  return v < 0 ? `(${nf.format(-v)})` : nf.format(v)
}

/** "1.250.000,5" atau "1250000.5" → 1250000.5. Kosong → 0. */
export function parseNum(s: string): number {
  const t = String(s ?? '').trim().replace(/\s/g, '')
  if (!t) return 0
  // titik sebagai pemisah ribuan bila ada koma desimal atau pola ribuan
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t
  const n = Number(normalized)
  return isFinite(n) ? Math.round(n * 100) / 100 : NaN
}

export function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function monthStart(ymd = today()) {
  return ymd.slice(0, 8) + '01'
}

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

export function tglID(ymd: string) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd || '—'
  return `${Number(ymd.slice(8, 10))} ${BULAN[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`
}

export function bulanID(ym: string, long = true) {
  const m = Number(ym.slice(5, 7)) - 1
  return `${(long ? BULAN_PANJANG : BULAN)[m]} ${ym.slice(0, 4)}`
}
