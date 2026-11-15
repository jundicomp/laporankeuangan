import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { call, errorText } from '../api/client'
import { usePrintDoc } from '../components/InvoiceDoc'
import { Banner, PageHead, Spinner } from '../components/ui'
import { downloadXlsx, type SheetSpec } from '../lib/excel'
import { bulanID, rp, tglID, tglPanjang, today } from '../lib/format'
import { fmtRatio } from './Ratios'

type Line = { kode: string; nama: string; amounts: number[] }
type Sec = { title: string; rows: Line[]; total: number[] }
type Income = { sections: Record<'pendapatan' | 'hpp' | 'beban' | 'lain' | 'pajak', Sec>; labaBruto: number[]; labaUsaha: number[]; labaSebelumPajak: number[]; labaBersih: number[] }
type Part = { groups: { kode: string; title: string; rows: Line[]; total: number[] }[]; total: number[] }
type Balance = { dates: string[]; aset: Part; liabilitas: Part; ekuitas: Part; totalPasiva: number[]; seimbang: boolean[] }
type Equity = { columns: { kode: string; nama: string }[]; rows: { key: string; label: string; amounts: number[]; total: number }[] }
type CfRow = { kode: string; nama: string; jumlah: number }
type Cashflow = { laba: number; operasi: { rows: CfRow[]; total: number }; investasi: { rows: CfRow[]; total: number }; pendanaan: { rows: CfRow[]; total: number }; kenaikan: number; kas_awal: number; kas_akhir: number }
type Mut = { kategori: string; awal: number; tambah: number; kurang: number; akhir: number; akum_awal: number; susut: number; akum_kurang: number; akum_akhir: number; nilai_buku: number }
type Calk = { from: string; to: string; lalu: { to: string }; catatan: { no: number; kode: string; judul: string; teks: string; tabel: { rows: { kode: string; nama: string; kini: number; lalu: number }[]; kini: number; lalu: number } | null; mutasi?: Mut[] | null }[] }
type Ratio = { grup: string; kode: string; nama: string; satuan: string; rumus: string; nilai: number | 'tak_hingga' | null; lalu: number | 'tak_hingga' | null; status: string }
type Aging = { buckets: { key: string; label: string }[]; customers: { pihak_id: string; nama: string; total: number; b: Record<string, number> }[]; totals: Record<string, number>; total: number }
type Rek = { id: string; nama: string; jenis: string; no_rek: string; rows: { bulan: string; masuk: number; keluar: number; saldo: number }[]; rata_saldo: number; rata_masuk: number }
type AsetRow = { kode: string; nama: string; kategori: string; tgl_beli: string; harga: number; akum: number; nilai_buku: number; status: string }
type Pajak = { jenis: { kode: string; nama: string }[]; masa: { masa: string; items: Record<string, { terutang: number; disetor: number; status: string }> }[] }
type Data = {
  from: string; to: string; lalu: { from: string; to: string }; kerangka: string
  perusahaan: { nama: string; alamat: string; npwp: string; telepon: string; email: string; logo_url: string }
  ttd: { nama: string; jabatan: string }
  income: Income; balance: Balance; equity: Equity; cashflow: Cashflow; calk: Calk; rasio: { rasio: Ratio[]; dasar: { lr: Record<string, number>; akhir: Record<string, number>; lalu_akhir: Record<string, number>; lalu_lr: Record<string, number> } }
  omzet: { bulan: string; pendapatan: number; hpp: number; beban: number; laba: number }[]; rekening: Rek[]
  piutang: Aging | null; utang: Aging | null; aset: { rows: AsetRow[]; total: { harga: number; akum: number; nilai_buku: number } } | null; pajak: Pajak | null
  kesiapan: { level: 'ok' | 'warn' | 'err' | 'info'; text: string; link: string }[]
}
const SECTIONS: [string, string][] = [
  ['ringkasan', 'Ringkasan & surat pernyataan'], ['posisi', 'Laporan posisi keuangan'], ['labarugi', 'Laporan laba rugi'], ['ekuitas', 'Laporan perubahan ekuitas'],
  ['aruskas', 'Laporan arus kas'], ['calk', 'Catatan atas laporan keuangan'], ['rasio', 'Analisis rasio'], ['omzet', 'Lampiran: omzet & laba 24 bulan'],
  ['rekening', 'Lampiran: saldo & mutasi rekening 12 bulan'], ['piutang', 'Lampiran: umur piutang'], ['utang', 'Lampiran: umur utang'], ['aset', 'Lampiran: daftar aset tetap'], ['pajak', 'Lampiran: kepatuhan pajak'],
]
const OPT_KEY = 'neraca.bankable'
type Opt = { to: string; from: string; bank: string; nama: string; jabatan: string; on: Record<string, boolean> }
function loadOpt(): Opt {
  const def: Opt = { to: today(), from: '', bank: '', nama: '', jabatan: '', on: Object.fromEntries(SECTIONS.map(([k]) => [k, true])) }
  try { const s = JSON.parse(localStorage.getItem(OPT_KEY) || 'null'); return s ? { ...def, ...s, to: def.to, on: { ...def.on, ...s.on } } : def } catch { return def }
}
const pct = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / Math.abs(b)) * 100)}%` : '—')
const LV: Record<string, [string, string]> = { ok: ['ok-text', '✓'], warn: ['warn-text', '⚠'], err: ['err-text', '✕'], info: ['hint', 'ⓘ'] }

export function BankablePage() {
  const [opt, setOpt] = useState<Opt>(loadOpt)
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { print, portal } = usePrintDoc()
  const set = (p: Partial<Opt>) => setOpt((o) => { const n = { ...o, ...p }; try { localStorage.setItem(OPT_KEY, JSON.stringify({ ...n, to: undefined })) } catch { /* abaikan */ } return n })
  const load = async () => {
    setBusy(true); setErr('')
    try {
      const r = await call<Data>('bankable.get', { to: opt.to, from: opt.from || undefined })
      setD(r)
      if (!opt.nama && r.ttd.nama) set({ nama: r.ttd.nama, jabatan: opt.jabatan || r.ttd.jabatan })
    } catch (e) { setErr(errorText(e)) }
    setBusy(false)
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const on = (k: string) => opt.on[k] && (!d || ({ piutang: !!d.piutang, utang: !!d.utang, aset: !!d.aset, pajak: !!d.pajak } as Record<string, boolean>)[k] !== false)
  const doc = d ? <BankDoc d={d} opt={opt} on={on} /> : null
  const issues = d?.kesiapan.filter((k) => k.level === 'err' || k.level === 'warn').length ?? 0
  return (
    <>
      <PageHead title="Paket Bankable" sub="Laporan keuangan lengkap siap diserahkan ke bank: sampul, pernyataan manajemen, 5 laporan SAK EP, rasio, dan lampiran yang biasa diminta analis kredit.">
        <button className="btn" onClick={() => d && exportXlsx(d, on)} disabled={!d}>⤓ Excel</button>
        <button className="btn primary" onClick={() => d && print(doc, `Laporan keuangan ${d.perusahaan.nama} ${d.to}`)} disabled={!d}>⎙ Cetak / Simpan PDF</button>
      </PageHead>
      <Banner kind="err">{err}</Banner>
      <div className="card bk-opt no-print">
        <div className="grid3">
          <label className="field"><span>Laporan per tanggal</span><input type="date" value={opt.to} onChange={(e) => set({ to: e.target.value || today() })} /></label>
          <label className="field"><span>Mulai periode</span><input type="date" value={opt.from} onChange={(e) => set({ from: e.target.value })} /><small className="hint">ⓘ Kosong = awal tahun buku.</small></label>
          <label className="field"><span>Ditujukan kepada</span><input value={opt.bank} onChange={(e) => set({ bank: e.target.value })} placeholder="mis. PT Bank Rakyat Indonesia (Persero) Tbk" /></label>
        </div>
        <div className="grid3">
          <label className="field"><span>Penandatangan</span><input value={opt.nama} onChange={(e) => set({ nama: e.target.value })} placeholder="nama pemilik / direktur" /></label>
          <label className="field"><span>Jabatan</span><input value={opt.jabatan} onChange={(e) => set({ jabatan: e.target.value })} placeholder="Direktur" /></label>
          <div className="field"><span>&nbsp;</span><button className="btn" onClick={load} disabled={busy}>{busy ? 'Menyusun…' : '↻ Susun ulang'}</button></div>
        </div>
        <div className="bk-checks">
          {SECTIONS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={!!opt.on[k]} onChange={(e) => set({ on: { ...opt.on, [k]: e.target.checked } })} /> {l}</label>)}
        </div>
      </div>
      {!d ? (busy && <Spinner label="Menyusun paket laporan…" />) : (
        <>
          <div className={`card bk-ready no-print ${issues ? 'warn' : 'ok'}`}>
            <h3>{issues ? `⚠ ${issues} hal sebaiknya dibereskan dulu` : '✓ Siap diserahkan ke bank'}</h3>
            <ul className="plain-list">{d.kesiapan.map((k, i) => (
              <li key={i} className={LV[k.level][0]}>{LV[k.level][1]} {k.text} {k.link && k.level !== 'ok' && <Link to={k.link}>Buka →</Link>}</li>
            ))}</ul>
          </div>
          <div className="bk-preview">{doc}</div>
        </>
      )}
      {portal}
    </>
  )
}

// ---------------------------------------------------------------- dokumen

function Page({ title, sub, children, first }: { title?: string; sub?: string; children: ReactNode; first?: boolean }) {
  return (
    <section className={`bk-page ${first ? 'first' : ''}`}>
      {title && <div className="bk-head"><h2>{title}</h2>{sub && <span>{sub}</span>}</div>}
      {children}
    </section>
  )
}
const N = ({ v, b }: { v: number; b?: boolean }) => <td className={`r ${v < 0 ? 'neg' : ''} ${b ? 'tot' : ''}`}>{v ? rp(v) : '—'}</td>

function BankDoc({ d, opt, on }: { d: Data; opt: Opt; on: (k: string) => boolean }) {
  const y0 = tglID(d.to), y1 = tglID(d.lalu.to)
  const per = `${tglPanjang(d.from)} s/d ${tglPanjang(d.to)}`
  const R = (k: string) => d.rasio.rasio.find((r) => r.kode === k)!
  const L = d.rasio.dasar
  const maxO = Math.max(1, ...d.omzet.map((o) => Math.max(Math.abs(o.pendapatan), Math.abs(o.laba))))
  const sumO = (a: typeof d.omzet) => a.reduce((t, o) => t + o.pendapatan, 0)
  const sign = <div className="bk-sign"><div>{d.perusahaan.alamat ? d.perusahaan.alamat.split(',').slice(-1)[0].trim() : ''}, {tglPanjang(today())}</div><div className="bk-sign-space" /><b>{opt.nama || '(nama penandatangan)'}</b><div>{opt.jabatan || 'Direktur'}</div></div>
  const cmpHead = <thead><tr><th></th><th className="r">{y0}</th><th className="r">{y1}</th></tr></thead>
  return (
    <div className="bk-doc">
      <section className="bk-page first bk-cover">
        {d.perusahaan.logo_url && <img src={d.perusahaan.logo_url} alt="" className="bk-logo" />}
        <h1>{d.perusahaan.nama}</h1>
        <div className="bk-cover-title">LAPORAN KEUANGAN</div>
        <div>Untuk periode {per}</div>
        <div className="small">dengan angka pembanding {tglPanjang(d.lalu.from)} s/d {tglPanjang(d.lalu.to)}</div>
        <div className="bk-cover-meta">Disusun berdasarkan {d.kerangka}{opt.bank && <><br />Disampaikan kepada: <b>{opt.bank}</b></>}</div>
        <div className="bk-cover-co">{d.perusahaan.alamat}<br />{d.perusahaan.npwp && <>NPWP {d.perusahaan.npwp}<br /></>}{[d.perusahaan.telepon, d.perusahaan.email].filter(Boolean).join(' · ')}</div>
        <ol className="bk-toc">{SECTIONS.filter(([k]) => on(k)).map(([k, l]) => <li key={k}>{l.replace('Lampiran: ', 'Lampiran — ')}</li>)}</ol>
      </section>

      {on('ringkasan') && (
        <>
          <Page title="Surat Pernyataan Tanggung Jawab Manajemen" sub={`atas laporan keuangan untuk periode ${per}`}>
            <p>Kami yang bertanda tangan di bawah ini menyatakan bahwa:</p>
            <ol className="bk-list">
              <li>Kami bertanggung jawab atas penyusunan dan penyajian laporan keuangan {d.perusahaan.nama}.</li>
              <li>Laporan keuangan telah disusun dan disajikan sesuai dengan {d.kerangka}.</li>
              <li>Semua informasi dalam laporan keuangan telah dimuat secara lengkap dan benar, dan tidak mengandung informasi atau fakta material yang tidak benar maupun menghilangkan informasi atau fakta material.</li>
              <li>Kami bertanggung jawab atas sistem pengendalian internal perusahaan.</li>
            </ol>
            <p>Demikian pernyataan ini dibuat dengan sebenarnya{opt.bank ? ` untuk keperluan pengajuan kepada ${opt.bank}` : ''}.</p>
            {sign}
          </Page>
          <Page title="Ringkasan Keuangan" sub={per}>
            <table className="tbl rep bk-tbl">
              <thead><tr><th></th><th className="r">{y0}</th><th className="r">{y1}</th><th className="r">Perubahan</th></tr></thead>
              <tbody>
                {[['Pendapatan', L.lr.pendapatan, L.lalu_lr.pendapatan], ['Laba kotor', L.lr.laba_kotor, L.lalu_lr.laba_kotor], ['EBITDA', L.lr.ebitda, L.lalu_lr.ebitda], ['Laba bersih', L.lr.laba_bersih, L.lalu_lr.laba_bersih],
                  ['Total aset', L.akhir.aset, L.lalu_akhir.aset], ['Kas & bank', L.akhir.kas, L.lalu_akhir.kas], ['Total liabilitas', L.akhir.liabilitas, L.lalu_akhir.liabilitas], ['Utang bank', L.akhir.utang_bank, L.lalu_akhir.utang_bank], ['Ekuitas', L.akhir.ekuitas, L.lalu_akhir.ekuitas]].map(([l, a, b]) => (
                  <tr key={l as string}><td>{l}</td><N v={a as number} /><N v={b as number} /><td className="r">{pct(a as number, b as number)}</td></tr>
                ))}
              </tbody>
            </table>
            <h4>Rasio utama</h4>
            <table className="tbl rep bk-tbl"><tbody>
              {['current', 'der', 'debt_ebitda', 'icr', 'npm', 'dso'].map((k) => { const r = R(k); return <tr key={k}><td>{r.nama}</td><td className="r tot">{fmtRatio(r.nilai, r.satuan)}</td><td className="r">{fmtRatio(r.lalu, r.satuan)}</td></tr> })}
            </tbody></table>
            <h4>Pendapatan & laba bersih 24 bulan terakhir</h4>
            <svg viewBox="0 0 720 170" className="bk-chart">
              <line x1="0" x2="720" y1="110" y2="110" stroke="#c5ccd4" />
              {d.omzet.map((o, i) => {
                const x = 4 + i * 29.8, h = (v: number) => (Math.abs(v) / maxO) * 100
                return <g key={o.bulan}><rect x={x} width="13" y={110 - h(o.pendapatan)} height={Math.max(1, h(o.pendapatan))} fill="#0f5c4a" rx="1.5" />
                  <rect x={x + 13} width="11" y={o.laba >= 0 ? 110 - h(o.laba) : 110} height={Math.max(1, h(o.laba))} fill={o.laba >= 0 ? '#2f6fb3' : '#c0392b'} rx="1.5" />
                  {i % 3 === 0 && <text x={x + 12} y="126" textAnchor="middle" fontSize="9" fill="#3f4856">{bulanID(o.bulan, false).replace(' 20', " '")}</text>}</g>
              })}
              <text x="0" y="150" fontSize="10" fill="#0f5c4a">■ pendapatan</text><text x="80" y="150" fontSize="10" fill="#2f6fb3">■ laba bersih</text>
              <text x="720" y="150" fontSize="10" textAnchor="end" fill="#3f4856">12 bulan terakhir Rp {rp(sumO(d.omzet.slice(12)))} · 12 bulan sebelumnya Rp {rp(sumO(d.omzet.slice(0, 12)))} ({pct(sumO(d.omzet.slice(12)), sumO(d.omzet.slice(0, 12)))})</text>
            </svg>
          </Page>
        </>
      )}

      {on('posisi') && (
        <Page title="Laporan Posisi Keuangan" sub={`per ${tglPanjang(d.to)} dan ${tglPanjang(d.lalu.to)}`}>
          <table className="tbl rep bk-tbl">{cmpHead}<tbody>
            {([['ASET', d.balance.aset, 'Jumlah aset'], ['LIABILITAS', d.balance.liabilitas, 'Jumlah liabilitas'], ['EKUITAS', d.balance.ekuitas, 'Jumlah ekuitas']] as [string, Part, string][]).map(([t, p, tl]) => [
              <tr key={t} className="sub"><td colSpan={3}>{t}</td></tr>,
              ...p.groups.flatMap((g) => [
                ...(g.title ? [<tr key={t + g.kode} className="grp"><td colSpan={3}>{g.title}</td></tr>] : []),
                ...g.rows.map((r) => <tr key={t + g.kode + r.nama}><td className="ind">{r.nama}</td><N v={r.amounts[0]} /><N v={r.amounts[1]} /></tr>),
                ...(g.title ? [<tr key={t + g.kode + 't'}><td>Jumlah {g.title.toLowerCase()}</td><N v={g.total[0]} b /><N v={g.total[1]} b /></tr>] : []),
              ]),
              <tr key={t + 'T'} className="key"><td>{tl}</td><N v={p.total[0]} b /><N v={p.total[1]} b /></tr>,
            ])}
            <tr className="key grand"><td>JUMLAH LIABILITAS DAN EKUITAS</td><N v={d.balance.totalPasiva[0]} b /><N v={d.balance.totalPasiva[1]} b /></tr>
          </tbody></table>
        </Page>
      )}

      {on('labarugi') && (
        <Page title="Laporan Laba Rugi" sub={`${per} dan ${tglID(d.lalu.from)} – ${y1}`}>
          <table className="tbl rep bk-tbl"><thead><tr><th></th><th className="r">{tglID(d.from)} – {y0}</th><th className="r">{tglID(d.lalu.from)} – {y1}</th></tr></thead><tbody>
            {(['pendapatan', 'hpp'] as const).map((k) => <IncSec key={k} s={d.income.sections[k]} />)}
            <tr className="key"><td>Laba kotor</td><N v={d.income.labaBruto[0]} b /><N v={d.income.labaBruto[1]} b /></tr>
            <IncSec s={d.income.sections.beban} />
            <tr className="key"><td>Laba usaha</td><N v={d.income.labaUsaha[0]} b /><N v={d.income.labaUsaha[1]} b /></tr>
            <IncSec s={d.income.sections.lain} />
            <tr className="key"><td>Laba sebelum pajak</td><N v={d.income.labaSebelumPajak[0]} b /><N v={d.income.labaSebelumPajak[1]} b /></tr>
            <IncSec s={d.income.sections.pajak} />
            <tr className="key grand"><td>LABA BERSIH</td><N v={d.income.labaBersih[0]} b /><N v={d.income.labaBersih[1]} b /></tr>
          </tbody></table>
        </Page>
      )}

      {on('ekuitas') && (
        <Page title="Laporan Perubahan Ekuitas" sub={per}>
          <table className="tbl rep bk-tbl"><thead><tr><th></th>{d.equity.columns.map((c) => <th key={c.kode} className="r">{c.nama}</th>)}<th className="r">Jumlah</th></tr></thead><tbody>
            {d.equity.rows.map((r) => <tr key={r.key} className={r.key === 'akhir' || r.key === 'awal' ? 'key' : ''}><td>{r.label}</td>{r.amounts.map((a, i) => <N key={i} v={a} />)}<N v={r.total} b /></tr>)}
          </tbody></table>
        </Page>
      )}

      {on('aruskas') && (
        <Page title="Laporan Arus Kas" sub={`${per} · metode tidak langsung`}>
          <table className="tbl rep bk-tbl"><tbody>
            <tr className="sub"><td colSpan={2}>Arus kas dari aktivitas operasi</td></tr>
            <tr><td className="ind">Laba bersih</td><N v={d.cashflow.laba} /></tr>
            {d.cashflow.operasi.rows.map((r, i) => <tr key={'o' + i}><td className="ind">{r.nama}</td><N v={r.jumlah} /></tr>)}
            <tr className="key"><td>Kas bersih dari aktivitas operasi</td><N v={d.cashflow.operasi.total} b /></tr>
            <tr className="sub"><td colSpan={2}>Arus kas dari aktivitas investasi</td></tr>
            {d.cashflow.investasi.rows.map((r, i) => <tr key={'i' + i}><td className="ind">{r.nama}</td><N v={r.jumlah} /></tr>)}
            <tr className="key"><td>Kas bersih dari aktivitas investasi</td><N v={d.cashflow.investasi.total} b /></tr>
            <tr className="sub"><td colSpan={2}>Arus kas dari aktivitas pendanaan</td></tr>
            {d.cashflow.pendanaan.rows.map((r, i) => <tr key={'p' + i}><td className="ind">{r.nama}</td><N v={r.jumlah} /></tr>)}
            <tr className="key"><td>Kas bersih dari aktivitas pendanaan</td><N v={d.cashflow.pendanaan.total} b /></tr>
            <tr className="key"><td>Kenaikan (penurunan) kas</td><N v={d.cashflow.kenaikan} b /></tr>
            <tr><td>Kas & setara kas awal periode</td><N v={d.cashflow.kas_awal} /></tr>
            <tr className="key grand"><td>KAS & SETARA KAS AKHIR PERIODE</td><N v={d.cashflow.kas_akhir} b /></tr>
          </tbody></table>
        </Page>
      )}

      {on('calk') && (
        <Page title="Catatan atas Laporan Keuangan" sub={`tahun buku ${tglPanjang(d.calk.from)} – ${tglPanjang(d.calk.to)}`}>
          {d.calk.catatan.map((c) => (
            <div key={c.kode} className="bk-note">
              <h4>{c.no}. {c.judul}</h4>
              {c.teks && c.teks.split('\n').map((t, i) => <p key={i}>{t}</p>)}
              {c.tabel && <table className="tbl rep bk-tbl small-tbl"><thead><tr><th></th><th className="r">Tahun ini</th><th className="r">Tahun lalu</th></tr></thead><tbody>
                {c.tabel.rows.map((r) => <tr key={r.kode}><td>{r.nama}</td><N v={r.kini} /><N v={r.lalu} /></tr>)}
                <tr className="key"><td>Jumlah</td><N v={c.tabel.kini} b /><N v={c.tabel.lalu} b /></tr></tbody></table>}
              {c.mutasi && c.mutasi.length > 1 && <table className="tbl rep bk-tbl small-tbl"><thead><tr><th>Mutasi</th><th className="r">Awal</th><th className="r">Tambah</th><th className="r">Kurang</th><th className="r">Akhir</th><th className="r">Akum. akhir</th><th className="r">Nilai buku</th></tr></thead><tbody>
                {c.mutasi.map((m, i) => <tr key={m.kategori} className={i === c.mutasi!.length - 1 ? 'key' : ''}><td>{m.kategori}</td><N v={m.awal} /><N v={m.tambah} /><N v={m.kurang} /><N v={m.akhir} /><N v={m.akum_akhir} /><N v={m.nilai_buku} b /></tr>)}</tbody></table>}
            </div>
          ))}
        </Page>
      )}

      {on('rasio') && (
        <Page title="Analisis Rasio Keuangan" sub={`${per}, dibanding periode yang sama tahun lalu`}>
          <table className="tbl rep bk-tbl"><thead><tr><th>Rasio</th><th className="r">{y0}</th><th className="r">{y1}</th><th>Penilaian</th></tr></thead><tbody>
            {d.rasio.rasio.map((r, i) => [
              ...(i === 0 || d.rasio.rasio[i - 1].grup !== r.grup ? [<tr key={r.grup} className="sub"><td colSpan={4}>{r.grup}</td></tr>] : []),
              <tr key={r.kode}><td>{r.nama}<div className="small">{r.rumus}</div></td><td className="r tot">{fmtRatio(r.nilai, r.satuan)}</td><td className="r">{fmtRatio(r.lalu, r.satuan)}</td>
                <td>{({ baik: 'Sehat', waspada: 'Perlu perhatian', buruk: 'Lemah', netral: '—', na: '—' } as Record<string, string>)[r.status]}</td></tr>,
            ])}
          </tbody></table>
        </Page>
      )}

      {on('omzet') && (
        <Page title="Lampiran — Omzet & Laba per Bulan" sub="24 bulan terakhir">
          <table className="tbl rep bk-tbl small-tbl"><thead><tr><th>Bulan</th><th className="r">Pendapatan</th><th className="r">Beban pokok</th><th className="r">Beban usaha</th><th className="r">Laba bersih</th></tr></thead><tbody>
            {d.omzet.map((o) => <tr key={o.bulan}><td>{bulanID(o.bulan)}</td><N v={o.pendapatan} /><N v={o.hpp} /><N v={o.beban} /><N v={o.laba} /></tr>)}
            <tr className="key"><td>Jumlah 12 bulan terakhir</td><N v={sumO(d.omzet.slice(12))} b /><N v={d.omzet.slice(12).reduce((t, o) => t + o.hpp, 0)} b /><N v={d.omzet.slice(12).reduce((t, o) => t + o.beban, 0)} b /><N v={d.omzet.slice(12).reduce((t, o) => t + o.laba, 0)} b /></tr>
            <tr><td>Rata-rata per bulan (12 bulan terakhir)</td><N v={Math.round(sumO(d.omzet.slice(12)) / 12)} /><td /><td /><N v={Math.round(d.omzet.slice(12).reduce((t, o) => t + o.laba, 0) / 12)} /></tr>
          </tbody></table>
        </Page>
      )}

      {on('rekening') && d.rekening.length > 0 && (
        <Page title="Lampiran — Saldo & Mutasi Rekening" sub="12 bulan terakhir, menurut pembukuan">
          {d.rekening.map((k) => (
            <div key={k.id} className="bk-note">
              <h4>{k.nama}{k.no_rek && ` · ${k.no_rek}`}</h4>
              <table className="tbl rep bk-tbl small-tbl"><thead><tr><th>Bulan</th><th className="r">Mutasi masuk</th><th className="r">Mutasi keluar</th><th className="r">Saldo akhir</th></tr></thead><tbody>
                {k.rows.map((r) => <tr key={r.bulan}><td>{bulanID(r.bulan)}</td><N v={r.masuk} /><N v={r.keluar} /><N v={r.saldo} /></tr>)}
                <tr className="key"><td>Rata-rata per bulan</td><N v={k.rata_masuk} b /><td /><N v={k.rata_saldo} b /></tr>
              </tbody></table>
            </div>
          ))}
        </Page>
      )}

      {on('piutang') && d.piutang && <AgingPage title="Lampiran — Umur Piutang Usaha" a={d.piutang} per={d.to} />}
      {on('utang') && d.utang && <AgingPage title="Lampiran — Umur Utang Usaha" a={d.utang} per={d.to} />}

      {on('aset') && d.aset && (
        <Page title="Lampiran — Daftar Aset Tetap" sub={`per ${tglPanjang(d.to)}`}>
          <table className="tbl rep bk-tbl small-tbl"><thead><tr><th>Kode</th><th>Aset</th><th>Perolehan</th><th className="r">Harga</th><th className="r">Akumulasi</th><th className="r">Nilai buku</th></tr></thead><tbody>
            {d.aset.rows.filter((r) => r.status === 'aktif').map((r) => <tr key={r.kode}><td className="mono">{r.kode}</td><td>{r.nama}</td><td>{tglID(r.tgl_beli)}</td><N v={r.harga} /><N v={r.akum} /><N v={r.nilai_buku} /></tr>)}
            <tr className="key"><td colSpan={3}>Jumlah</td><N v={d.aset.total.harga} b /><N v={d.aset.total.akum} b /><N v={d.aset.total.nilai_buku} b /></tr>
          </tbody></table>
        </Page>
      )}

      {on('pajak') && d.pajak && (
        <Page title="Lampiran — Kepatuhan Pajak" sub={`tahun ${d.to.slice(0, 4)} s/d ${bulanID(d.to.slice(0, 7))}`}>
          <table className="tbl rep bk-tbl small-tbl"><thead><tr><th>Masa</th>{d.pajak.jenis.map((j) => <th key={j.kode} className="r">{j.nama}</th>)}</tr></thead><tbody>
            {d.pajak.masa.map((m) => <tr key={m.masa}><td>{bulanID(m.masa, false)}</td>{d.pajak!.jenis.map((j) => {
              const it = m.items[j.kode]
              return <td key={j.kode} className="r">{it.terutang ? rp(it.terutang) : '—'}<div className="small">{({ disetor: 'disetor', nihil: 'nihil', belum: 'belum disetor', terlambat: 'terlambat', berjalan: 'berjalan', lebih_bayar: 'lebih bayar' } as Record<string, string>)[it.status] ?? it.status}</div></td>
            })}</tr>)}
          </tbody></table>
        </Page>
      )}
    </div>
  )
}

function IncSec({ s }: { s: Sec }) {
  if (!s.rows.length) return null
  return (
    <>
      <tr className="grp"><td colSpan={3}>{s.title}</td></tr>
      {s.rows.map((r) => <tr key={r.kode}><td className="ind">{r.nama}</td><N v={r.amounts[0]} /><N v={r.amounts[1]} /></tr>)}
      <tr><td>Jumlah {s.title.toLowerCase()}</td><N v={s.total[0]} b /><N v={s.total[1]} b /></tr>
    </>
  )
}

function AgingPage({ title, a, per }: { title: string; a: Aging; per: string }) {
  return (
    <Page title={title} sub={`per ${tglPanjang(per)}`}>
      <table className="tbl rep bk-tbl small-tbl"><thead><tr><th>Nama</th>{a.buckets.map((b) => <th key={b.key} className="r">{b.label}</th>)}<th className="r">Jumlah</th></tr></thead><tbody>
        {a.customers.length === 0 && <tr><td colSpan={a.buckets.length + 2}>Tidak ada saldo.</td></tr>}
        {a.customers.map((c) => <tr key={c.pihak_id}><td>{c.nama}</td>{a.buckets.map((b) => <N key={b.key} v={c.b[b.key] || 0} />)}<N v={c.total} b /></tr>)}
        <tr className="key"><td>Jumlah</td>{a.buckets.map((b) => <N key={b.key} v={a.totals[b.key] || 0} b />)}<N v={a.total} b /></tr>
        {a.total > 0 && <tr><td>Porsi</td>{a.buckets.map((b) => <td key={b.key} className="r small">{Math.round(((a.totals[b.key] || 0) / a.total) * 100)}%</td>)}<td className="r small">100%</td></tr>}
      </tbody></table>
    </Page>
  )
}

// ---------------------------------------------------------------- Excel

function exportXlsx(d: Data, on: (k: string) => boolean) {
  const t = (name: string) => [d.perusahaan.nama, name, `${tglID(d.from)} – ${tglID(d.to)} (pembanding ${tglID(d.lalu.from)} – ${tglID(d.lalu.to)})`]
  const two = [{ header: 'Pos', key: 'l', width: 46 }, { header: tglID(d.to), key: 'a', money: true, width: 18 }, { header: tglID(d.lalu.to), key: 'b', money: true, width: 18 }]
  const sheets: SheetSpec[] = []
  const bold = (r: Record<string, unknown>) => !!r.bold
  if (on('posisi')) {
    const rows: Record<string, unknown>[] = []
    ;([['ASET', d.balance.aset], ['LIABILITAS', d.balance.liabilitas], ['EKUITAS', d.balance.ekuitas]] as [string, Part][]).forEach(([n, p]) => {
      rows.push({ l: n, bold: true }); p.groups.forEach((g) => { if (g.title) rows.push({ l: '  ' + g.title, bold: true }); g.rows.forEach((r) => rows.push({ l: '    ' + r.nama, a: r.amounts[0], b: r.amounts[1] })) })
      rows.push({ l: 'Jumlah ' + n.toLowerCase(), a: p.total[0], b: p.total[1], bold: true })
    })
    rows.push({ l: 'JUMLAH LIABILITAS DAN EKUITAS', a: d.balance.totalPasiva[0], b: d.balance.totalPasiva[1], bold: true })
    sheets.push({ name: 'Posisi keuangan', title: t('Laporan Posisi Keuangan'), columns: two, rows, bold })
  }
  if (on('labarugi')) {
    const rows: Record<string, unknown>[] = []
    const sec = (s: Sec) => { if (!s.rows.length) return; rows.push({ l: s.title, bold: true }); s.rows.forEach((r) => rows.push({ l: '  ' + r.nama, a: r.amounts[0], b: r.amounts[1] })); rows.push({ l: 'Jumlah ' + s.title.toLowerCase(), a: s.total[0], b: s.total[1], bold: true }) }
    sec(d.income.sections.pendapatan); sec(d.income.sections.hpp); rows.push({ l: 'Laba kotor', a: d.income.labaBruto[0], b: d.income.labaBruto[1], bold: true })
    sec(d.income.sections.beban); rows.push({ l: 'Laba usaha', a: d.income.labaUsaha[0], b: d.income.labaUsaha[1], bold: true })
    sec(d.income.sections.lain); sec(d.income.sections.pajak); rows.push({ l: 'LABA BERSIH', a: d.income.labaBersih[0], b: d.income.labaBersih[1], bold: true })
    sheets.push({ name: 'Laba rugi', title: t('Laporan Laba Rugi'), columns: two, rows, bold })
  }
  if (on('aruskas')) {
    const c = d.cashflow, rows: Record<string, unknown>[] = [{ l: 'Laba bersih', a: c.laba }]
    ;([['Operasi', c.operasi], ['Investasi', c.investasi], ['Pendanaan', c.pendanaan]] as const).forEach(([n, s]) => { if (n !== 'Operasi') rows.push({ l: 'Aktivitas ' + n.toLowerCase(), bold: true }); s.rows.forEach((r) => rows.push({ l: '  ' + r.nama, a: r.jumlah })); rows.push({ l: 'Kas bersih aktivitas ' + n.toLowerCase(), a: s.total, bold: true }) })
    rows.push({ l: 'Kenaikan (penurunan) kas', a: c.kenaikan, bold: true }, { l: 'Kas awal', a: c.kas_awal }, { l: 'Kas akhir', a: c.kas_akhir, bold: true })
    sheets.push({ name: 'Arus kas', title: t('Laporan Arus Kas'), columns: two.slice(0, 2), rows, bold })
  }
  if (on('rasio')) sheets.push({ name: 'Rasio', title: t('Analisis Rasio'), columns: [{ header: 'Kelompok', key: 'grup', width: 14 }, { header: 'Rasio', key: 'nama', width: 36 }, { header: tglID(d.to), key: 'a', width: 16 }, { header: tglID(d.lalu.to), key: 'b', width: 16 }, { header: 'Rumus', key: 'rumus', width: 44 }],
    rows: d.rasio.rasio.map((r) => ({ ...r, a: fmtRatio(r.nilai, r.satuan), b: fmtRatio(r.lalu, r.satuan) })) })
  if (on('omzet')) sheets.push({ name: 'Omzet 24 bulan', title: t('Omzet & Laba per Bulan'), columns: [{ header: 'Bulan', key: 'bl', width: 16 }, { header: 'Pendapatan', key: 'pendapatan', money: true }, { header: 'Beban pokok', key: 'hpp', money: true }, { header: 'Beban usaha', key: 'beban', money: true }, { header: 'Laba bersih', key: 'laba', money: true }],
    rows: d.omzet.map((o) => ({ ...o, bl: bulanID(o.bulan) })) })
  if (on('rekening')) sheets.push({ name: 'Rekening', title: t('Saldo & Mutasi Rekening 12 Bulan'), columns: [{ header: 'Rekening', key: 'nama', width: 26 }, { header: 'Bulan', key: 'bl', width: 16 }, { header: 'Masuk', key: 'masuk', money: true }, { header: 'Keluar', key: 'keluar', money: true }, { header: 'Saldo akhir', key: 'saldo', money: true }],
    rows: d.rekening.flatMap((k) => k.rows.map((r) => ({ ...r, nama: k.nama, bl: bulanID(r.bulan) }))) })
  const aging = (n: string, a: Aging | null) => a && sheets.push({ name: n, title: t(n), columns: [{ header: 'Nama', key: 'nama', width: 30 }, ...a.buckets.map((b) => ({ header: b.label, key: b.key, money: true })), { header: 'Jumlah', key: 'total', money: true }],
    rows: [...a.customers.map((c) => ({ nama: c.nama, ...c.b, total: c.total })), { nama: 'Jumlah', ...a.totals, total: a.total, bold: true }], bold })
  if (on('piutang')) aging('Umur piutang', d.piutang)
  if (on('utang')) aging('Umur utang', d.utang)
  if (on('aset') && d.aset) sheets.push({ name: 'Aset tetap', title: t('Daftar Aset Tetap'), columns: [{ header: 'Kode', key: 'kode', width: 10 }, { header: 'Aset', key: 'nama', width: 32 }, { header: 'Perolehan', key: 'tgl_beli', width: 12 }, { header: 'Harga', key: 'harga', money: true }, { header: 'Akumulasi', key: 'akum', money: true }, { header: 'Nilai buku', key: 'nilai_buku', money: true }],
    rows: d.aset.rows.filter((r) => r.status === 'aktif') })
  downloadXlsx(`Paket-bankable-${d.perusahaan.nama}-${d.to}.xlsx`, sheets)
}

