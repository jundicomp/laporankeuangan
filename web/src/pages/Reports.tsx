import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, PageHead, Spinner } from '../components/ui'
import { downloadXlsx, type SheetSpec } from '../lib/excel'
import { bulanID, rp, tglID, today } from '../lib/format'

type Line = { kode: string; nama: string; amounts: number[]; computed?: boolean }
type Income = {
  ranges: { from: string; to: string }[]
  sections: Record<'pendapatan' | 'hpp' | 'beban' | 'lain' | 'pajak', { title: string; rows: Line[]; total: number[] }>
  labaBruto: number[]; labaUsaha: number[]; labaSebelumPajak: number[]; labaBersih: number[]; kerangka: string
}
type Group = { kode: string; title: string; rows: Line[]; total: number[] }
type Balance = {
  dates: string[]; kerangka: string
  aset: { groups: Group[]; total: number[] }; liabilitas: { groups: Group[]; total: number[] }; ekuitas: { groups: Group[]; total: number[] }
  totalPasiva: number[]; seimbang: boolean[]
}

// ---------------------------------------------------------------- periode

const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate()
function monthRange(y: number, m: number) { return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` } }
function shiftYear(d: string, n: number) { const y = Number(d.slice(0, 4)) + n; const m = Number(d.slice(5, 7)); const day = Math.min(Number(d.slice(8, 10)), lastDay(y, m)); return `${y}-${pad(m)}-${pad(day)}` }
function prevPeriod(r: { from: string; to: string }) {
  const f = new Date(r.from + 'T00:00:00'), t = new Date(r.to + 'T00:00:00')
  const sameMonth = r.from.endsWith('-01') && Number(r.to.slice(8, 10)) === lastDay(t.getFullYear(), t.getMonth() + 1) && r.from.slice(0, 7) === r.to.slice(0, 7)
  if (sameMonth) { const d = new Date(f.getFullYear(), f.getMonth() - 1, 1); return monthRange(d.getFullYear(), d.getMonth() + 1) }
  return { from: shiftYear(r.from, -1), to: shiftYear(r.to, -1) }
}
function periodLabel(r: { from: string; to: string }) {
  const y = r.from.slice(0, 4)
  if (r.from === `${y}-01-01` && r.to === `${y}-12-31`) return `Tahun ${y}`
  if (r.from.endsWith('-01') && r.from.slice(0, 7) === r.to.slice(0, 7) && Number(r.to.slice(8, 10)) === lastDay(Number(y), Number(r.to.slice(5, 7)))) return bulanID(r.from.slice(0, 7), false)
  return `${tglID(r.from)} – ${tglID(r.to)}`
}

export function ReportsPage() {
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') || 'laba-rugi'
  return (
    <>
      <PageHead title="Laporan Keuangan" sub="Disusun langsung dari jurnal yang sudah diposting. Klik nama akun untuk melihat rinciannya di buku besar." />
      <div className="tabs no-print">
        <button className={tab === 'laba-rugi' ? 'on' : ''} onClick={() => setSp({ tab: 'laba-rugi' })}>Laba rugi</button>
        <button className={tab === 'posisi' ? 'on' : ''} onClick={() => setSp({ tab: 'posisi' })}>Posisi keuangan (neraca)</button>
        <Link className="tab-link" to="/jurnal?tab=neraca-saldo">Neraca saldo ↗</Link>
      </div>
      {tab === 'laba-rugi' ? <IncomeReport /> : <BalanceReport />}
    </>
  )
}

function Amount({ v, strong }: { v: number; strong?: boolean }) {
  return <td className={`r ${v < 0 ? 'neg' : ''} ${strong ? 'tot' : ''}`}>{rp(v, true)}</td>
}

function useDrill() {
  const nav = useNavigate()
  return (kode: string, from?: string, to?: string) => {
    if (!kode) return
    const q = new URLSearchParams({ tab: 'buku-besar', akun: kode })
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    nav(`/jurnal?${q}`)
  }
}

// ---------------------------------------------------------------- laba rugi

function IncomeReport() {
  const { boot } = useSession()
  const now = new Date()
  const [preset, setPreset] = useState('bulan-ini')
  const [custom, setCustom] = useState({ from: `${now.getFullYear()}-01-01`, to: today() })
  const [compare, setCompare] = useState<'none' | 'prev' | 'yoy'>('prev')
  const [zero, setZero] = useState(false)
  const [d, setD] = useState<Income | null>(null)
  const [err, setErr] = useState('')
  const drill = useDrill()

  const range = useMemo(() => {
    const y = now.getFullYear(), m = now.getMonth() + 1
    if (preset === 'bulan-ini') return monthRange(y, m)
    if (preset === 'bulan-lalu') { const p = new Date(y, m - 2, 1); return monthRange(p.getFullYear(), p.getMonth() + 1) }
    if (preset === 'tahun-ini') return { from: `${y}-01-01`, to: `${y}-12-31` }
    if (preset === 'tahun-lalu') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
    return custom
  }, [preset, custom]) // eslint-disable-line react-hooks/exhaustive-deps

  const ranges = useMemo(() => {
    const r = [range]
    if (compare === 'prev') r.push(prevPeriod(range))
    if (compare === 'yoy') r.push({ from: shiftYear(range.from, -1), to: shiftYear(range.to, -1) })
    return r
  }, [range, compare])

  useEffect(() => {
    setD(null)
    setErr('')
    call<Income>('report.income', { ranges, includeZero: zero }).then(setD).catch((e) => setErr(errorText(e)))
  }, [ranges, zero])

  const labels = ranges.map(periodLabel)
  const company = boot?.company.nama ?? ''

  const exportXlsx = () => {
    if (!d) return
    const rows: Record<string, unknown>[] = []
    const push = (label: string, amounts: number[], bold = false, kode = '') => rows.push({ kode, label, bold, ...Object.fromEntries(amounts.map((a, i) => [`c${i}`, a])) })
    const sec = (k: keyof Income['sections']) => { push(d.sections[k].title, [], true); d.sections[k].rows.forEach((r) => push('   ' + r.nama, r.amounts, false, r.kode)); push('Jumlah ' + d.sections[k].title.toLowerCase(), d.sections[k].total, true) }
    sec('pendapatan'); sec('hpp'); push('LABA BRUTO', d.labaBruto, true); sec('beban'); push('LABA USAHA', d.labaUsaha, true)
    sec('lain'); push('LABA SEBELUM PAJAK', d.labaSebelumPajak, true); sec('pajak'); push('LABA TAHUN BERJALAN', d.labaBersih, true)
    const spec: SheetSpec = {
      name: 'Laba Rugi', title: [company, 'Laporan Laba Rugi', labels.join(' vs '), 'dalam Rupiah'],
      columns: [{ header: 'Kode', key: 'kode', width: 10 }, { header: 'Keterangan', key: 'label', width: 42 }, ...labels.map((l, i) => ({ header: l, key: `c${i}`, width: 18, money: true }))],
      rows, bold: (r) => !!r.bold, note: [`Disusun berdasarkan ${d.kerangka}. Dicetak ${tglID(today())}.`],
    }
    downloadXlsx(`Laba-Rugi-${ranges[0].from}-sd-${ranges[0].to}.xlsx`, [spec])
  }

  const SectionRows = ({ k }: { k: keyof Income['sections'] }) => {
    const s = d!.sections[k]
    return (
      <>
        <tr className="sec"><td colSpan={1 + ranges.length}>{s.title}</td></tr>
        {s.rows.length === 0 && <tr><td className="indent hint" colSpan={1 + ranges.length}>— tidak ada —</td></tr>}
        {s.rows.map((r) => (
          <tr key={r.kode} className="click" onClick={() => drill(r.kode, ranges[0].from, ranges[0].to)}>
            <td className="indent"><span className="mono code">{r.kode}</span> {r.nama}</td>
            {r.amounts.map((a, i) => <Amount key={i} v={a} />)}
          </tr>
        ))}
        <tr className="sub"><td>Jumlah {s.title.toLowerCase()}</td>{s.total.map((a, i) => <Amount key={i} v={a} strong />)}</tr>
      </>
    )
  }

  return (
    <>
      <div className="filters no-print">
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="bulan-ini">Bulan ini</option><option value="bulan-lalu">Bulan lalu</option>
          <option value="tahun-ini">Tahun ini</option><option value="tahun-lalu">Tahun lalu</option><option value="custom">Pilih tanggal…</option>
        </select>
        {preset === 'custom' && <>
          <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
        </>}
        <select value={compare} onChange={(e) => setCompare(e.target.value as 'none' | 'prev' | 'yoy')}>
          <option value="none">Tanpa pembanding</option><option value="prev">Bandingkan periode sebelumnya</option><option value="yoy">Bandingkan tahun lalu</option>
        </select>
        <label className="check"><input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} /> Akun bersaldo nol</label>
        <span className="grow" />
        <button className="btn" onClick={() => window.print()} disabled={!d}>⎙ Cetak / PDF</button>
        <button className="btn" onClick={exportXlsx} disabled={!d}>⇣ Excel</button>
      </div>
      <Banner kind="err">{err}</Banner>
      {!d ? <Spinner /> : (
        <div className="card flush report">
          <div className="report-title">
            <b>{company}</b>
            <h2>Laporan Laba Rugi</h2>
            <span>{labels[0]}{labels[1] ? ` (pembanding: ${labels[1]})` : ''} · dalam Rupiah</span>
          </div>
          <table className="tbl rep">
            <thead><tr><th></th>{labels.map((l) => <th key={l} className="r">{l}</th>)}</tr></thead>
            <tbody>
              <SectionRows k="pendapatan" />
              <SectionRows k="hpp" />
              <tr className="key"><td>LABA BRUTO</td>{d.labaBruto.map((a, i) => <Amount key={i} v={a} strong />)}</tr>
              <SectionRows k="beban" />
              <tr className="key"><td>LABA USAHA</td>{d.labaUsaha.map((a, i) => <Amount key={i} v={a} strong />)}</tr>
              <SectionRows k="lain" />
              <tr className="key"><td>LABA SEBELUM PAJAK</td>{d.labaSebelumPajak.map((a, i) => <Amount key={i} v={a} strong />)}</tr>
              <SectionRows k="pajak" />
              <tr className="grand"><td>LABA (RUGI) TAHUN BERJALAN</td>{d.labaBersih.map((a, i) => <Amount key={i} v={a} strong />)}</tr>
            </tbody>
          </table>
          <p className="hint pad">ⓘ Disusun berdasarkan {d.kerangka}. Angka dalam kurung = negatif / pengurang. Nilai hanya dari jurnal posted; draft belum dihitung.</p>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- posisi keuangan

function BalanceReport() {
  const { boot } = useSession()
  const [to, setTo] = useState(today())
  const [compare, setCompare] = useState<'none' | 'yearEnd' | 'prevMonth'>('yearEnd')
  const [zero, setZero] = useState(false)
  const [d, setD] = useState<Balance | null>(null)
  const [err, setErr] = useState('')
  const drill = useDrill()

  const dates = useMemo(() => {
    const out = [to]
    if (compare === 'yearEnd') out.push(`${Number(to.slice(0, 4)) - 1}-12-31`)
    if (compare === 'prevMonth') { const y = Number(to.slice(0, 4)), m = Number(to.slice(5, 7)); const p = new Date(y, m - 2, 1); out.push(`${p.getFullYear()}-${pad(p.getMonth() + 1)}-${pad(lastDay(p.getFullYear(), p.getMonth() + 1))}`) }
    return out
  }, [to, compare])

  useEffect(() => {
    setD(null)
    setErr('')
    call<Balance>('report.balance', { dates, includeZero: zero }).then(setD).catch((e) => setErr(errorText(e)))
  }, [dates, zero])

  const labels = dates.map(tglID)
  const company = boot?.company.nama ?? ''

  const Side = ({ title, part }: { title: string; part: Balance['aset'] }) => (
    <>
      <tr className="sec"><td colSpan={1 + dates.length}>{title}</td></tr>
      {part.groups.map((g) => (
        <GroupRows key={g.kode} g={g} />
      ))}
    </>
  )
  const GroupRows = ({ g }: { g: Group }) => (
    <>
      {g.title && <tr className="grp"><td colSpan={1 + dates.length}>{g.title}</td></tr>}
      {g.rows.map((r, i) => (
        <tr key={r.kode || i} className={r.kode ? 'click' : 'computed'} onClick={() => drill(r.kode, '', dates[0])}>
          <td className="indent2">{r.kode && <span className="mono code">{r.kode}</span>} {r.nama}</td>
          {r.amounts.map((a, j) => <Amount key={j} v={a} />)}
        </tr>
      ))}
      {g.title && <tr className="sub"><td className="indent">Jumlah {g.title.toLowerCase()}</td>{g.total.map((a, i) => <Amount key={i} v={a} strong />)}</tr>}
    </>
  )

  const exportXlsx = () => {
    if (!d) return
    const rows: Record<string, unknown>[] = []
    const push = (label: string, amounts: number[], bold = false, kode = '') => rows.push({ kode, label, bold, ...Object.fromEntries(amounts.map((a, i) => [`c${i}`, a])) })
    const side = (t: string, p: Balance['aset']) => {
      push(t, [], true)
      p.groups.forEach((g) => { if (g.title) push('  ' + g.title, [], true); g.rows.forEach((r) => push('    ' + r.nama, r.amounts, false, r.kode)); if (g.title) push('  Jumlah ' + g.title.toLowerCase(), g.total, true) })
    }
    side('ASET', d.aset); push('JUMLAH ASET', d.aset.total, true)
    side('LIABILITAS', d.liabilitas); push('JUMLAH LIABILITAS', d.liabilitas.total, true)
    side('EKUITAS', d.ekuitas); push('JUMLAH EKUITAS', d.ekuitas.total, true)
    push('JUMLAH LIABILITAS DAN EKUITAS', d.totalPasiva, true)
    downloadXlsx(`Posisi-Keuangan-${dates[0]}.xlsx`, [{
      name: 'Posisi Keuangan', title: [company, 'Laporan Posisi Keuangan', 'Per ' + labels.join(' dan '), 'dalam Rupiah'],
      columns: [{ header: 'Kode', key: 'kode', width: 10 }, { header: 'Keterangan', key: 'label', width: 44 }, ...labels.map((l, i) => ({ header: l, key: `c${i}`, width: 18, money: true }))],
      rows, bold: (r) => !!r.bold, note: [`Disusun berdasarkan ${d.kerangka}. Dicetak ${tglID(today())}.`],
    }])
  }

  return (
    <>
      <div className="filters no-print">
        <label className="inline">Per tanggal <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <select value={compare} onChange={(e) => setCompare(e.target.value as 'none' | 'yearEnd' | 'prevMonth')}>
          <option value="yearEnd">Bandingkan akhir tahun lalu</option><option value="prevMonth">Bandingkan akhir bulan lalu</option><option value="none">Tanpa pembanding</option>
        </select>
        <label className="check"><input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} /> Akun bersaldo nol</label>
        <span className="grow" />
        <button className="btn" onClick={() => window.print()} disabled={!d}>⎙ Cetak / PDF</button>
        <button className="btn" onClick={exportXlsx} disabled={!d}>⇣ Excel</button>
      </div>
      <Banner kind="err">{err}</Banner>
      {!d ? <Spinner /> : (
        <div className="card flush report">
          <div className="report-title">
            <b>{company}</b>
            <h2>Laporan Posisi Keuangan</h2>
            <span>Per {labels.join(' dan ')} · dalam Rupiah</span>
            {d.seimbang.every(Boolean) ? <span className="pill g">Seimbang ✓</span> : <span className="pill r">⚠ Tidak seimbang — periksa jurnal</span>}
          </div>
          <table className="tbl rep">
            <thead><tr><th></th>{labels.map((l) => <th key={l} className="r">{l}</th>)}</tr></thead>
            <tbody>
              <Side title="ASET" part={d.aset} />
              <tr className="grand"><td>JUMLAH ASET</td>{d.aset.total.map((a, i) => <Amount key={i} v={a} strong />)}</tr>
              <Side title="LIABILITAS" part={d.liabilitas} />
              <tr className="key"><td>Jumlah liabilitas</td>{d.liabilitas.total.map((a, i) => <Amount key={i} v={a} strong />)}</tr>
              <Side title="EKUITAS" part={d.ekuitas} />
              <tr className="key"><td>Jumlah ekuitas</td>{d.ekuitas.total.map((a, i) => <Amount key={i} v={a} strong />)}</tr>
              <tr className="grand"><td>JUMLAH LIABILITAS DAN EKUITAS</td>{d.totalPasiva.map((a, i) => <Amount key={i} v={a} strong />)}</tr>
            </tbody>
          </table>
          <p className="hint pad">ⓘ Disusun berdasarkan {d.kerangka}. "Laba tahun berjalan" dihitung otomatis dari laporan laba rugi sejak awal tahun buku sampai tanggal laporan.</p>
        </div>
      )}
    </>
  )
}
