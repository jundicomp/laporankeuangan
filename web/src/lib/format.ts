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

export function tglPanjang(ymd: string) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd || '—'
  return `${Number(ymd.slice(8, 10))} ${BULAN_PANJANG[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`
}

export function addDays(ymd: string, n: number) {
  const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))))
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string) {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  return Math.round((t(b) - t(a)) / 86400000)
}

/** Angka ke kata untuk invoice: 1250000 → "satu juta dua ratus lima puluh ribu rupiah". */
export function terbilang(n: number): string {
  const satuan = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas']
  const f = (x: number): string => {
    if (x < 12) return satuan[x]
    if (x < 20) return f(x - 10) + ' belas'
    if (x < 100) return f(Math.floor(x / 10)) + ' puluh' + (x % 10 ? ' ' + f(x % 10) : '')
    if (x < 200) return 'seratus' + (x - 100 ? ' ' + f(x - 100) : '')
    if (x < 1000) return f(Math.floor(x / 100)) + ' ratus' + (x % 100 ? ' ' + f(x % 100) : '')
    if (x < 2000) return 'seribu' + (x - 1000 ? ' ' + f(x - 1000) : '')
    if (x < 1e6) return f(Math.floor(x / 1000)) + ' ribu' + (x % 1000 ? ' ' + f(x % 1000) : '')
    if (x < 1e9) return f(Math.floor(x / 1e6)) + ' juta' + (x % 1e6 ? ' ' + f(x % 1e6) : '')
    if (x < 1e12) return f(Math.floor(x / 1e9)) + ' miliar' + (x % 1e9 ? ' ' + f(x % 1e9) : '')
    return f(Math.floor(x / 1e12)) + ' triliun' + (x % 1e12 ? ' ' + f(x % 1e12) : '')
  }
  const whole = Math.floor(Math.abs(n))
  const sen = Math.round((Math.abs(n) - whole) * 100)
  let s = whole === 0 ? 'nol' : f(whole)
  if (sen) s += ' koma ' + f(sen)
  return (n < 0 ? 'minus ' : '') + s + ' rupiah'
}
