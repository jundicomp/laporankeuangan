import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, Modal, PageHead, Spinner, fmtTime } from '../components/ui'
import { downloadXlsx } from '../lib/excel'
import { bulanID, parseNum, rp, today } from '../lib/format'
import { RatioReport } from './Ratios'

type Acc = { kode: string; nama: string; tipe: string; saldo_normal: string; grup: string }
type Data = { from: string; to: string; months: string[]; accounts: Acc[]; anggaran: Record<string, number[]>; realisasi: Record<string, number[]>; lalu: Record<string, number[]>
  hari_ini: string; diubah: { oleh: string; pada: string } | null }

const SECTIONS = [
  { tipe: 'pendapatan', title: 'Pendapatan', income: true },
  { tipe: 'hpp', title: 'Beban pokok penjualan', income: false },
  { tipe: 'beban', title: 'Beban usaha', income: false },
  { tipe: 'lain', title: 'Pendapatan (beban) lain-lain', income: true },
  { tipe: 'pajak', title: 'Beban pajak penghasilan', income: false },
]
const Z = () => Array(12).fill(0) as number[]
const sum = (a: number[], from = 0, to = 12) => a.slice(from, to).reduce((t, v) => t + v, 0)
const round2 = (n: number) => Math.round(n * 100) / 100
/** arah tampilan: pendapatan/lain positif = menambah laba; hpp/beban/pajak positif = mengurangi laba */
const dirOf = (a: Acc) => { const inc = SECTIONS.find((s) => s.tipe === a.tipe)?.income; return (a.saldo_normal === 'K') === !!inc ? 1 : -1 }
const year = Number(today().slice(0, 4))

export function BudgetPage() {
  const { can } = useSession()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') === 'rasio' ? 'rasio' : 'realisasi'
  const [tahun, setTahun] = useState(String(year))
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [edit, setEdit] = useState(false)
  const load = useCallback(() => { setErr(''); call<Data>('budget.get', { tahun_mulai: `${tahun}-06-30` }).then(setD).catch((e) => setErr(errorText(e))) }, [tahun])
  useEffect(() => { if (tab === 'realisasi') load() }, [load, tab])
  return (
    <>
      <PageHead title="Anggaran & Analisis" sub="Susun anggaran laba rugi per bulan, pantau realisasinya, dan baca kesehatan keuangan lewat rasio.">
        {tab === 'realisasi' && can('anggaran.edit') && <button className="btn primary" onClick={() => { setFlash(''); setEdit(true) }} disabled={!d}>✎ Susun anggaran {d ? d.from.slice(0, 4) : ''}</button>}
      </PageHead>
      {flash && <Banner kind="ok">{flash}</Banner>}
      <Banner kind="err">{err}</Banner>
      <div className="tabs no-print">
        <button className={tab === 'realisasi' ? 'on' : ''} onClick={() => setSp({})}>Realisasi vs anggaran</button>
        {can('laporan.view') && <button className={tab === 'rasio' ? 'on' : ''} onClick={() => setSp({ tab: 'rasio' })}>Analisis rasio</button>}
      </div>
      {tab === 'rasio' ? <RatioReport /> : <Realisasi d={d} tahun={tahun} setTahun={setTahun} onEdit={() => setEdit(true)} />}
      {edit && d && <BudgetEditor d={d} onClose={() => setEdit(false)} onSaved={(t) => { setEdit(false); setFlash(t); load() }} />}
    </>
  )
}

// ---------------------------------------------------------------- realisasi vs anggaran

type Line = { kode: string; nama: string; bud: number[]; real: number[]; income: boolean }

function Realisasi({ d, tahun, setTahun, onEdit }: { d: Data | null; tahun: string; setTahun: (y: string) => void; onEdit: () => void }) {
  const { boot, can } = useSession()
  const nowIdx = d ? Math.max(0, d.months.indexOf(d.hari_ini.slice(0, 7))) : 0
  const defIdx = d ? (d.hari_ini.slice(0, 7) > d.months[11] ? 11 : d.hari_ini.slice(0, 7) < d.months[0] ? 0 : nowIdx) : 0
  const [idx, setIdx] = useState<number | null>(null)
  const [mode, setMode] = useState<'ytd' | 'bulan'>('ytd')
  const m = idx ?? defIdx
  useEffect(() => { setIdx(null) }, [tahun])

  const sections = useMemo(() => {
    if (!d) return []
    return SECTIONS.map((s) => {
      const lines: Line[] = d.accounts.filter((a) => a.tipe === s.tipe).map((a) => {
        const dir = dirOf(a)
        return { kode: a.kode, nama: a.nama, income: s.income, bud: (d.anggaran[a.kode] ?? Z()).map((v) => v * dir), real: (d.realisasi[a.kode] ?? Z()).map((v) => v * dir) }
      }).filter((l) => l.bud.some(Boolean) || l.real.some(Boolean))
      const tot = (k: 'bud' | 'real') => Z().map((_, i) => lines.reduce((t, l) => t + l[k][i], 0))
      return { ...s, lines, bud: tot('bud'), real: tot('real') }
    })
  }, [d])
  if (!d) return <Spinner />
  const sec = (t: string) => sections.find((s) => s.tipe === t)!
  const combo = (parts: [string, number][]) => (k: 'bud' | 'real') => Z().map((_, i) => parts.reduce((t, [tp, sg]) => t + sg * sec(tp)[k][i], 0))
  const lk = combo([['pendapatan', 1], ['hpp', -1]]), lu = combo([['pendapatan', 1], ['hpp', -1], ['beban', -1]]), lb = combo([['pendapatan', 1], ['hpp', -1], ['beban', -1], ['lain', 1], ['pajak', -1]])
  const noBudget = !Object.keys(d.anggaran).length
  const range = (a: number[]) => (mode === 'bulan' ? a[m] : sum(a, 0, m + 1))
  const calc = (bud: number[], real: number[], income: boolean) => {
    const b = range(bud), r = range(real)
    const proy = sum(real, 0, m + 1) + sum(bud, m + 1)
    const good = income ? r >= b : r <= b
    return { b, r, sel: round2(r - b), pct: b ? Math.round((r / b) * 100) : null, proy, setahun: sum(bud), good }
  }
  const Row = ({ label, bud, real, income, cls }: { label: string; bud: number[]; real: number[]; income: boolean; cls?: string }) => {
    const c = calc(bud, real, income)
    const flag = c.b ? (c.good ? 'ok-text' : Math.abs(c.sel) > Math.abs(c.b) * 0.1 ? 'err-text' : 'warn-text') : ''
    return (
      <tr className={cls}>
        <td>{label}</td><td className="r">{rp(c.b, true)}</td><td className="r">{rp(c.r, true)}</td>
        <td className={`r ${flag}`}>{c.b || c.r ? (c.sel > 0 ? '+' : '') + rp(c.sel, true) : ''}</td>
        <td className={`r ${flag}`}>{c.pct === null ? '' : `${c.pct}%`}</td>
        <td className="r">{rp(c.proy, true)}</td><td className="r">{rp(c.setahun, true)}</td>
      </tr>
    )
  }
  const lbBud = lb('bud'), lbReal = lb('real')
  const exportXlsx = () => {
    const rows: Record<string, unknown>[] = []
    const push = (label: string, bud: number[], real: number[], income: boolean, bold = false) => { const c = calc(bud, real, income); rows.push({ label, b: c.b, r: c.r, sel: c.sel, pct: c.pct ?? '', proy: c.proy, setahun: c.setahun, bold }) }
    sections.forEach((s) => { if (!s.lines.length) return; rows.push({ label: s.title, bold: true }); s.lines.forEach((l) => push(`${l.kode} ${l.nama}`, l.bud, l.real, l.income)); push(`Jumlah ${s.title.toLowerCase()}`, s.bud, s.real, s.income, true) })
    push('Laba kotor', lk('bud'), lk('real'), true, true); push('Laba usaha', lu('bud'), lu('real'), true, true); push('Laba bersih', lbBud, lbReal, true, true)
    downloadXlsx(`Realisasi-anggaran-${d.months[m]}.xlsx`, [{
      name: 'Realisasi', title: [boot?.company.nama ?? '', 'Realisasi vs Anggaran', mode === 'bulan' ? bulanID(d.months[m]) : `${bulanID(d.months[0])} s/d ${bulanID(d.months[m])}`],
      columns: [{ header: 'Akun', key: 'label', width: 40 }, { header: 'Anggaran', key: 'b', money: true }, { header: 'Realisasi', key: 'r', money: true }, { header: 'Selisih', key: 'sel', money: true },
        { header: 'Capaian %', key: 'pct', width: 10 }, { header: 'Proyeksi setahun', key: 'proy', money: true }, { header: 'Anggaran setahun', key: 'setahun', money: true }],
      rows, bold: (r) => !!r.bold,
    }])
  }
  const maxAbs = Math.max(1, ...lbBud.map(Math.abs), ...lbReal.map(Math.abs))
  return (
    <>
      <div className="filters no-print">
        <label className="inline">Tahun buku <select value={tahun} onChange={(e) => setTahun(e.target.value)}>{[year + 1, year, year - 1, year - 2].map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className="inline">Sampai <select value={m} onChange={(e) => setIdx(Number(e.target.value))}>{d.months.map((ym, i) => <option key={ym} value={i}>{bulanID(ym)}</option>)}</select></label>
        <div className="segbtn">
          <button className={mode === 'ytd' ? 'on' : ''} onClick={() => setMode('ytd')}>Sejak awal tahun</button>
          <button className={mode === 'bulan' ? 'on' : ''} onClick={() => setMode('bulan')}>Bulan itu saja</button>
        </div>
        <span className="grow" />
        <button className="btn" onClick={exportXlsx}>⤓ Excel</button>
        <button className="btn" onClick={() => window.print()}>⎙ Cetak</button>
      </div>
      {noBudget && <div className="banner warn">⚠ Belum ada anggaran untuk tahun buku {d.from.slice(0, 4)}.{can('anggaran.edit') && <> <button className="link" onClick={onEdit}>Susun anggaran →</button> (bisa disalin dari realisasi tahun lalu).</>}</div>}
      <div className="kpis">
        {[['Pendapatan', sec('pendapatan').bud, sec('pendapatan').real, true], ['Beban (HPP + usaha)', Z().map((_, i) => sec('hpp').bud[i] + sec('beban').bud[i]), Z().map((_, i) => sec('hpp').real[i] + sec('beban').real[i]), false],
          ['Laba bersih', lbBud, lbReal, true]].map(([l, b, r, inc]) => {
          const c = calc(b as number[], r as number[], inc as boolean)
          return <div key={l as string} className="card kpi"><span>{l as string}</span><b>Rp {rp(c.r)}</b>
            <small className={c.b ? (c.good ? 'ok-text' : 'err-text') : 'muted'}>{c.b ? `${c.pct ?? 0}% dari anggaran Rp ${rp(c.b)}` : 'belum ada anggaran'}</small></div>
        })}
      </div>
      <div className="card">
        <div className="row between"><h3>Laba bersih per bulan</h3><span className="legend"><i className="lg-b" /> Anggaran <i className="lg-r" /> Realisasi</span></div>
        <svg viewBox="0 0 720 150" className="budget-chart" role="img" aria-label="Laba bersih anggaran dan realisasi per bulan">
          <line x1="0" x2="720" y1="75" y2="75" stroke="#c5ccd4" />
          {d.months.map((ym, i) => {
            const x = 8 + i * 60, h = (v: number) => (Math.abs(v) / maxAbs) * 62
            const bar = (v: number, dx: number, c: string) => <rect x={x + dx} width="20" y={v >= 0 ? 75 - h(v) : 75} height={Math.max(1, h(v))} fill={c} rx="2" />
            return <g key={ym}>{bar(lbBud[i], 4, '#b9c7d6')}{i <= m && bar(lbReal[i], 26, lbReal[i] >= 0 ? '#0f5c4a' : '#c0392b')}
              <text x={x + 25} y="146" textAnchor="middle" fontSize="11" fill="#3f4856">{bulanID(ym, false).slice(0, 3)}</text></g>
          })}
        </svg>
      </div>
      <div className="card flush">
        <div className="scroll-x">
          <table className="tbl rep budget-tbl">
            <thead><tr><th>{mode === 'bulan' ? bulanID(d.months[m]) : `${bulanID(d.months[0], false)} – ${bulanID(d.months[m], false)}`}</th><th className="r">Anggaran</th><th className="r">Realisasi</th>
              <th className="r">Selisih</th><th className="r">Capaian</th><th className="r" title="Realisasi s/d bulan ini + anggaran bulan-bulan berikutnya">Proyeksi setahun</th><th className="r">Anggaran setahun</th></tr></thead>
            <tbody>
              {sections.map((s) => s.lines.length > 0 && [
                <tr key={s.tipe} className="sub"><td colSpan={7}>{s.title}</td></tr>,
                ...s.lines.map((l) => <Row key={l.kode} label={`${l.kode} ${l.nama}`} bud={l.bud} real={l.real} income={l.income} />),
                <Row key={s.tipe + 't'} label={`Jumlah ${s.title.toLowerCase()}`} bud={s.bud} real={s.real} income={s.income} cls="key" />,
                ...(s.tipe === 'hpp' ? [<Row key="lk" label="Laba kotor" bud={lk('bud')} real={lk('real')} income cls="key" />] : []),
                ...(s.tipe === 'beban' ? [<Row key="lu" label="Laba usaha" bud={lu('bud')} real={lu('real')} income cls="key" />] : []),
              ])}
              <Row label="LABA BERSIH" bud={lbBud} real={lbReal} income cls="key grand" />
            </tbody>
          </table>
        </div>
      </div>
      <p className="hint">ⓘ Hijau = sesuai/lebih baik dari anggaran (pendapatan di atas, beban di bawah anggaran); oranye = meleset ≤ 10%; merah = meleset lebih dari 10%. Proyeksi setahun = realisasi s/d bulan terpilih + anggaran bulan-bulan sisanya.{d.diubah && ` Anggaran terakhir diubah ${d.diubah.oleh} · ${fmtTime(d.diubah.pada)}.`}</p>
    </>
  )
}

// ---------------------------------------------------------------- susun anggaran

function BudgetEditor({ d, onClose, onSaved }: { d: Data; onClose: () => void; onSaved: (t: string) => void }) {
  const init = useMemo(() => {
    const g: Record<string, string[]> = {}
    d.accounts.forEach((a) => { g[a.kode] = (d.anggaran[a.kode] ?? Z()).map((v) => (v ? rp(v) : '')) })
    return g
  }, [d])
  const [grid, setGrid] = useState(init)
  const [all, setAll] = useState(false)
  const [growth, setGrowth] = useState('10')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const used = (k: string) => grid[k].some((v) => v.trim()) || (d.realisasi[k] ?? []).some(Boolean) || (d.lalu[k] ?? []).some(Boolean)
  const shown = d.accounts.filter((a) => all || used(a.kode))
  const setCell = (k: string, i: number, v: string) => { setTouched(true); setGrid((g) => ({ ...g, [k]: g[k].map((x, j) => (j === i ? v : x)) })) }
  const spread = (k: string, total: number) => {
    setTouched(true)
    const per = Math.floor(total / 12 / 1000) * 1000
    const arr = Z().map((_, i) => (i < 11 ? per : total - per * 11))
    setGrid((g) => ({ ...g, [k]: arr.map((v) => (v ? rp(v) : '')) }))
  }
  const fromLast = () => {
    const f = 1 + (parseNum(growth) || 0) / 100
    setTouched(true)
    setGrid((g) => {
      const n = { ...g }
      d.accounts.forEach((a) => { const l = d.lalu[a.kode]; if (l && l.some(Boolean)) n[a.kode] = l.map((v) => { const x = Math.round((v * f) / 1000) * 1000; return x > 0 ? rp(x) : '' }) })
      return n
    })
  }
  const rowTotal = (k: string) => grid[k].reduce((t, v) => t + (parseNum(v) || 0), 0)
  const bad = Object.entries(grid).find(([, a]) => a.some((v) => v.trim() && (isNaN(parseNum(v)) || parseNum(v) < 0)))
  const laba = Z().map((_, i) => d.accounts.reduce((t, a) => {
    const v = parseNum(grid[a.kode][i]) || 0
    const inc = SECTIONS.find((s) => s.tipe === a.tipe)?.income
    return t + (inc ? v * dirOf(a) : -v * dirOf(a))
  }, 0))
  const blocker = bad ? `Angka tidak valid di ${d.accounts.find((a) => a.kode === bad[0])?.nama}.` : ''
  const save = async () => {
    if (blocker) return setErr(blocker)
    setBusy(true); setErr('')
    try {
      const rows = d.accounts.filter((a) => grid[a.kode].some((v) => parseNum(v))).map((a) => ({ akun_id: a.kode, bulan: grid[a.kode].map((v) => parseNum(v) || 0) }))
      const r = await call<{ akun: number }>('budget.save', { tahun_mulai: d.from, rows })
      onSaved(`Anggaran ${d.from.slice(0, 4)} disimpan (${r.akun} akun).`)
    } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  const hasLast = Object.values(d.lalu).some((a) => a.some(Boolean))
  return (
    <Modal size="xl" title={`Susun anggaran ${bulanID(d.months[0], false)} – ${bulanID(d.months[11], false)}`} sub="Isi per bulan, atau ketik total setahun di kolom Total untuk dibagi rata. Angka positif untuk pendapatan maupun beban." onClose={onClose} dirty={touched && !busy}
      footer={<>{blocker ? <span className="warn-text">⚠ {blocker}</span> : <span className={sum(laba) >= 0 ? 'ok-text' : 'warn-text'}>{sum(laba) >= 0 ? '✓' : '⚠'} Anggaran laba bersih setahun Rp {rp(sum(laba))}</span>}
        <button className="btn" onClick={onClose}>Batal</button><button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan anggaran'}</button></>}>
      <div className="filters">
        {hasLast && <>
          <label className="inline">Salin realisasi tahun lalu + <input className="num" style={{ width: 64 }} value={growth} onChange={(e) => setGrowth(e.target.value)} /> %</label>
          <button className="btn" onClick={fromLast}>Terapkan</button>
        </>}
        {!hasLast && <span className="hint">ⓘ Belum ada realisasi tahun lalu untuk disalin — isi manual.</span>}
        <span className="grow" />
        <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Tampilkan semua akun laba rugi</label>
      </div>
      <div className="scroll-x budget-grid">
        <table className="tbl compact">
          <thead><tr><th className="sticky">Akun</th>{d.months.map((ym) => <th key={ym} className="r">{bulanID(ym, false).slice(0, 3)}</th>)}<th className="r">Total</th><th className="r">Tahun lalu</th></tr></thead>
          <tbody>
            {SECTIONS.map((s) => {
              const rows = shown.filter((a) => a.tipe === s.tipe)
              if (!rows.length) return null
              return [
                <tr key={s.tipe} className="sub"><td className="sticky"><b>{s.title}</b></td><td colSpan={14} /></tr>,
                ...rows.map((a) => (
                  <tr key={a.kode}>
                    <td className="sticky"><span className="mono small">{a.kode}</span> {a.nama}</td>
                    {grid[a.kode].map((v, i) => <td key={i} className="num"><input inputMode="decimal" value={v} onChange={(e) => setCell(a.kode, i, e.target.value)} onBlur={(e) => { const n = parseNum(e.target.value); if (n) setCell(a.kode, i, rp(n)) }} /></td>)}
                    <td className="num"><input className="tot-in" inputMode="decimal" defaultValue="" key={rowTotal(a.kode)} placeholder={rp(rowTotal(a.kode), true)}
                      onBlur={(e) => { const n = parseNum(e.target.value); if (n > 0) spread(a.kode, n); e.target.value = '' }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /></td>
                    <td className="r small">{rp(sum(d.lalu[a.kode] ?? Z()), true)}</td>
                  </tr>
                )),
              ]
            })}
            <tr className="key"><td className="sticky">Laba bersih</td>{laba.map((v, i) => <td key={i} className={`r ${v < 0 ? 'neg' : ''}`}>{rp(v, true)}</td>)}<td className="r tot">{rp(sum(laba))}</td><td /></tr>
          </tbody>
        </table>
      </div>
      <p className="hint">ⓘ Kolom Total menampilkan jumlah setahun; ketik angka baru di sana lalu Enter untuk membaginya rata 12 bulan (dibulatkan ribuan). Akun tanpa angka tidak disimpan.</p>
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
}
