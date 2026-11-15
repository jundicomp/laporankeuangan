import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { CashSelect, cashShort, useCashAccounts } from '../components/CashPick'
import { usePrintDoc } from '../components/InvoiceDoc'
import { Banner, Modal, PageHead, Req, Spinner } from '../components/ui'
import { downloadXlsx } from '../lib/excel'
import { bulanID, parseNum, rp, tglID, tglPanjang, today } from '../lib/format'

type Emp = { id: string; kode: string; nama: string; nik: string; npwp: string; jabatan: string; divisi: string; ptkp: string; gaji_pokok: number; tunjangan: number
  bank: string; rekening: string; email: string; bpjs_kes: string; bpjs_tk: string; tgl_masuk: string; tgl_keluar: string; aktif: boolean }
type Slip = { karyawan_id: string; kode: string; nama: string; jabatan: string; ptkp: string; gaji_pokok: number; tunjangan: number; lembur: number; bonus: number; thr: number
  potongan_absen: number; kasbon: number; akhir: boolean; catatan: string; bpjs_kes_p: number; bpjs_kes_k: number; jht_p: number; jht_k: number; jp_p: number; jp_k: number
  jkk: number; jkm: number; bruto: number; ter_kategori: string; ter_tarif: number; metode: string; pph21: number; neto: number
  th_bruto: number; th_biaya_jabatan: number; th_iuran: number; th_neto: number; th_ptkp: number; th_pkp: number; th_pph: number; th_dipotong: number }
type Tot = { bruto: number; pph21: number; neto: number; bpjs: number; beban: number }
type Month = { periode: string; status: string; id?: string; no?: string; karyawan?: number; bruto?: number; pph21?: number; neto?: number; bpjs?: number; beban?: number; dibayar?: boolean; tgl_bayar?: string }
type ListRes = { tahun: string; bulan: Month[]; karyawan_aktif: number; bpjs: { kes_batas: number; jp_batas: number; jkk_tarif: number } }
type RunRes = { periode: string; tgl: string; lines: Slip[]; total: Tot; warn: string[]; karyawan: Emp[]
  run: null | { id: string; no: string; status: string; catatan: string; tgl_bayar: string; kasbank: string; jurnal: { id: string; no: string } | null; jurnal_bayar: { id: string; no: string } | null } }
type Annual = { tahun: string; rows: { karyawan_id: string; kode: string; nama: string; ptkp: string; bulan: number; dari: string; sampai: string; gaji: number; tunjangan: number; lembur: number
  bonus_thr: number; premi: number; bruto: number; biaya_jabatan: number; iuran: number; neto: number; ptkp_rp: number; pkp: number; pph_setahun: number; pph21: number; selisih: number; neto_dibayar: number }[] }

const PTKP = ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3']
const STATUS: Record<string, [string, string]> = { belum: ['n', 'Belum dibuat'], draft: ['o', 'Draft'], posted: ['g', 'Diposting'] }
const yearNow = Number(today().slice(0, 4))

export function PayrollPage() {
  const { can } = useSession()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as 'gaji' | 'karyawan' | 'tahunan') || 'gaji'
  const [flash, setFlash] = useState('')
  const [bpjs, setBpjs] = useState(false)
  return (
    <>
      <PageHead title="Payroll" sub="Gaji bulanan, BPJS, PPh 21 (TER & tahunan Desember), slip gaji, dan pembayaran.">
        {can('payroll.edit') && <button className="btn" onClick={() => setBpjs(true)}>Pengaturan BPJS</button>}
      </PageHead>
      {flash && <Banner kind="ok">{flash}</Banner>}
      <div className="tabs">
        <button className={tab === 'gaji' ? 'on' : ''} onClick={() => setSp({})}>Penggajian</button>
        <button className={tab === 'karyawan' ? 'on' : ''} onClick={() => setSp({ tab: 'karyawan' })}>Karyawan</button>
        <button className={tab === 'tahunan' ? 'on' : ''} onClick={() => setSp({ tab: 'tahunan' })}>Rekap tahunan (1721-A1)</button>
      </div>
      {tab === 'gaji' && <RunsTab onFlash={setFlash} />}
      {tab === 'karyawan' && <EmployeesTab onFlash={setFlash} />}
      {tab === 'tahunan' && <AnnualTab />}
      {bpjs && <BpjsSettings onClose={() => setBpjs(false)} onSaved={(t) => { setBpjs(false); setFlash(t) }} />}
    </>
  )
}

// ---------------------------------------------------------------- daftar bulan

function RunsTab({ onFlash }: { onFlash: (t: string) => void }) {
  const [tahun, setTahun] = useState(String(yearNow))
  const [d, setD] = useState<ListRes | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(() => { setErr(''); call<ListRes>('payroll.list', { tahun }).then(setD).catch((e) => setErr(errorText(e))) }, [tahun])
  useEffect(() => { load() }, [load])
  const posted = (d?.bulan ?? []).filter((m) => m.status === 'posted')
  const sum = (k: keyof Month) => posted.reduce((t, m) => t + (Number(m[k]) || 0), 0)
  return (
    <>
      <div className="filters">
        <label className="inline">Tahun <select value={tahun} onChange={(e) => setTahun(e.target.value)}>{[yearNow + 1, yearNow, yearNow - 1, yearNow - 2].map((y) => <option key={y}>{y}</option>)}</select></label>
        {d && <span className="hint">ⓘ {d.karyawan_aktif} karyawan aktif. Klik bulan untuk membuat / melihat penggajian.</span>}
      </div>
      <Banner kind="err">{err}</Banner>
      {d && d.karyawan_aktif === 0 && <div className="banner warn">⚠ Belum ada karyawan aktif. Isi dulu di tab <Link to="/payroll?tab=karyawan">Karyawan</Link>.</div>}
      <div className="card flush">
        {!d ? <div className="pad"><Spinner /></div> : (
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th>Bulan</th><th>Status</th><th className="r">Karyawan</th><th className="r">Penghasilan bruto</th><th className="r">BPJS</th><th className="r">PPh 21</th><th className="r">Gaji bersih</th><th>Pembayaran</th></tr></thead>
              <tbody>{d.bulan.map((m) => (
                <tr key={m.periode} className="click" onClick={() => setOpen(m.periode)}>
                  <td className="nowrap">{bulanID(m.periode)}</td>
                  <td><span className={`pill ${STATUS[m.status]?.[0] ?? 'n'}`}>{STATUS[m.status]?.[1] ?? m.status}</span></td>
                  <td className="r">{m.karyawan ?? ''}</td><td className="r">{m.bruto ? rp(m.bruto) : ''}</td><td className="r">{m.bpjs ? rp(m.bpjs) : ''}</td>
                  <td className="r">{m.pph21 !== undefined && m.status !== 'belum' ? rp(m.pph21) : ''}</td><td className="r">{m.neto ? rp(m.neto) : ''}</td>
                  <td>{m.status === 'posted' && (m.dibayar ? <span className="pill g">dibayar {tglID(m.tgl_bayar ?? '')}</span> : <span className="pill o">belum dibayar</span>)}</td>
                </tr>
              ))}</tbody>
              {posted.length > 0 && <tfoot><tr><td colSpan={3}>Total diposting</td><td className="r tot">{rp(sum('bruto'))}</td><td className="r tot">{rp(sum('bpjs'))}</td><td className="r tot">{rp(sum('pph21'))}</td><td className="r tot">{rp(sum('neto'))}</td><td /></tr></tfoot>}
            </table>
          </div>
        )}
      </div>
      <p className="hint">ⓘ Januari–November PPh 21 memakai tarif efektif (TER). Desember dihitung ulang setahun dengan tarif Pasal 17 dikurangi yang sudah dipotong — posting bulan-bulan sebelumnya dulu.</p>
      {open && <RunModal periode={open} onClose={() => setOpen(null)} onChanged={(t) => { setOpen(null); onFlash(t); load() }} />}
    </>
  )
}

// ---------------------------------------------------------------- satu bulan

type In = { karyawan_id: string; gaji_pokok: string; tunjangan: string; lembur: string; bonus: string; thr: string; potongan_absen: string; kasbon: string; akhir: boolean }
const NUMS: (keyof In)[] = ['gaji_pokok', 'tunjangan', 'lembur', 'bonus', 'thr', 'potongan_absen', 'kasbon']
const toIn = (s: Slip): In => ({ karyawan_id: s.karyawan_id, akhir: s.akhir, ...Object.fromEntries(NUMS.map((k) => [k, s[k as keyof Slip] ? rp(s[k as keyof Slip] as number) : ''])) } as In)
const toPayload = (l: In) => ({ karyawan_id: l.karyawan_id, akhir: l.akhir, ...Object.fromEntries(NUMS.map((k) => [k, parseNum(l[k] as string) || 0])) })

type RMode = 'view' | 'pay' | 'void' | 'payVoid'

function RunModal({ periode, onClose, onChanged }: { periode: string; onClose: () => void; onChanged: (t: string) => void }) {
  const { can, boot } = useSession()
  const [d, setD] = useState<RunRes | null>(null)
  const [err, setErr] = useState('')
  const [lines, setLines] = useState<In[]>([])
  const [calc, setCalc] = useState<{ lines: Slip[]; total: Tot; warn: string[] } | null>(null)
  const [calcErr, setCalcErr] = useState('')
  const [tgl, setTgl] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<RMode>('view')
  const [add, setAdd] = useState('')
  const { print, portal } = usePrintDoc()
  const seq = useRef(0)

  useEffect(() => {
    call<RunRes>('payroll.get', { periode }).then((r) => { setD(r); setLines(r.lines.map(toIn)); setCalc({ lines: r.lines, total: r.total, warn: r.warn }); setTgl(r.tgl) }).catch((e) => setErr(errorText(e)))
  }, [periode])
  const editable = !!d && (!d.run || d.run.status === 'draft') && can('payroll.edit')

  // hitung ulang di server setiap isian berubah (jeda 600 ms)
  useEffect(() => {
    if (!touched || !editable) return
    const my = ++seq.current
    const t = setTimeout(() => {
      if (!lines.length) { setCalc({ lines: [], total: { bruto: 0, pph21: 0, neto: 0, bpjs: 0, beban: 0 }, warn: [] }); return }
      call<{ lines: Slip[]; total: Tot; warn: string[] }>('payroll.calc', { periode, lines: lines.map(toPayload) })
        .then((r) => { if (my === seq.current) { setCalc(r); setCalcErr('') } })
        .catch((e) => { if (my === seq.current) setCalcErr(errorText(e)) })
    }, 600)
    return () => clearTimeout(t)
  }, [lines, touched, editable, periode])

  if (!d) return <Modal size="xl" title={`Penggajian ${bulanID(periode)}`} onClose={onClose}>{err ? <Banner kind="err">{err}</Banner> : <Spinner />}</Modal>
  if (mode === 'pay' && d.run) return <PayForm run={d.run} periode={periode} total={d.total.neto} tglRun={d.tgl} onClose={() => setMode('view')} onSaved={onChanged} />
  if ((mode === 'void' || mode === 'payVoid') && d.run) return <VoidRun run={d.run} periode={periode} pay={mode === 'payVoid'} onClose={() => setMode('view')} onSaved={onChanged} />

  const setLine = (i: number, patch: Partial<In>) => { setTouched(true); setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))) }
  const empName = (id: string) => d.karyawan.find((e) => e.id === id)?.nama ?? calc?.lines.find((s) => s.karyawan_id === id)?.nama ?? id
  const notIn = d.karyawan.filter((e) => !lines.some((l) => l.karyawan_id === e.id))
  const shown = calc?.lines ?? []
  const slipOf = (id: string) => shown.find((s) => s.karyawan_id === id)
  const syncing = editable && touched && (!calc || calc.lines.length !== lines.length)
  const blocker = !lines.length ? 'Tambahkan minimal satu karyawan.' : calcErr ? calcErr : !tgl || tgl.slice(0, 7) !== periode ? `Tanggal harus di bulan ${bulanID(periode)}.` : ''

  const save = async (post: boolean) => {
    if (blocker) return setErr(blocker)
    setBusy(true); setErr('')
    try {
      const r = await call<{ status: string; no: string; total: Tot }>('payroll.save', { periode, tgl, lines: lines.map(toPayload), post })
      onChanged(post ? `Penggajian ${bulanID(periode)} diposting (jurnal ${r.no}). Gaji bersih Rp ${rp(r.total.neto)} siap dibayar.` : `Draft penggajian ${bulanID(periode)} disimpan.`)
    } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  const comp = boot?.company ?? {}
  const printSlips = (ss: Slip[]) => print(<>{ss.map((s, i) => <SlipDoc key={s.karyawan_id} s={s} periode={periode} company={comp} emp={d.karyawan.find((e) => e.id === s.karyawan_id)} last={i === ss.length - 1} />)}</>,
    ss.length === 1 ? `Slip gaji ${ss[0].nama} ${periode}` : `Slip gaji ${periode}`)
  const run = d.run
  const t = calc?.total ?? d.total

  return (
    <Modal size="xl" title={`Penggajian ${bulanID(periode)}`} sub={run ? `${run.status === 'posted' ? `Diposting · jurnal ${run.jurnal?.no ?? ''}` : 'Draft'}${run.tgl_bayar ? ` · dibayar ${tglID(run.tgl_bayar)} dari ${run.kasbank}` : ''}` : 'Belum dibuat — angka di bawah usulan dari data karyawan.'}
      onClose={onClose} dirty={editable && touched && !busy}
      footer={editable ? <>
        {blocker ? <span className="warn-text">⚠ {blocker}</span> : syncing ? <span className="hint">ⓘ Menghitung…</span> : <span className="ok-text">✓ {lines.length} karyawan · gaji bersih Rp {rp(t.neto)}</span>}
        {run && run.status === 'draft' && <button className="btn warn" onClick={() => setMode('void')}>Buang draft</button>}
        <button className="btn" onClick={() => save(false)} disabled={busy}>Simpan draft</button>
        <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={() => save(true)} disabled={busy || syncing}>{busy ? 'Menyimpan…' : 'Posting penggajian'}</button>
      </> : <>
        {run?.jurnal && can('jurnal.view') && <Link className="btn" to={`/jurnal?open=${run.jurnal.id}`}>Lihat jurnal</Link>}
        {shown.length > 0 && <button className="btn" onClick={() => printSlips(shown)}>⎙ Cetak semua slip</button>}
        {run?.status === 'posted' && can('payroll.edit') && !run.tgl_bayar && <button className="btn warn" onClick={() => setMode('void')}>Batalkan penggajian</button>}
        {run?.status === 'posted' && can('payroll.edit') && run.tgl_bayar && <button className="btn warn" onClick={() => setMode('payVoid')}>Batalkan pembayaran</button>}
        {run?.status === 'posted' && can('payroll.edit') && !run.tgl_bayar && <button className="btn primary" onClick={() => setMode('pay')}>Bayar gaji Rp {rp(t.neto)}</button>}
        <button className="btn" onClick={onClose}>Tutup</button>
      </>}>
      <div className="stack">
        {editable && (
          <div className="filters">
            <label className="inline">Tanggal jurnal<Req /> <input type="date" value={tgl} onChange={(e) => { setTouched(true); setTgl(e.target.value) }} /></label>
            {notIn.length > 0 && (
              <label className="inline">Tambah karyawan <select value={add} onChange={(e) => { const id = e.target.value; setAdd(''); const emp = d.karyawan.find((x) => x.id === id); if (emp) { setTouched(true); setLines((ls) => [...ls, { karyawan_id: id, gaji_pokok: rp(emp.gaji_pokok), tunjangan: emp.tunjangan ? rp(emp.tunjangan) : '', lembur: '', bonus: '', thr: '', potongan_absen: '', kasbon: '', akhir: false }]) } }}>
                <option value="">— pilih —</option>{notIn.map((e) => <option key={e.id} value={e.id}>{e.nama}</option>)}</select></label>
            )}
          </div>
        )}
        {(calc?.warn ?? []).map((w, i) => <p key={i} className="warn-text">⚠ {w}</p>)}
        <div className="scroll-x">
          <table className="tbl compact pay-tbl">
            <thead><tr><th>Karyawan</th>
              {editable ? <><th className="r">Gaji pokok</th><th className="r">Tunjangan</th><th className="r">Lembur</th><th className="r">Bonus</th><th className="r">THR</th><th className="r">Pot. absen</th><th className="r">Kasbon</th><th title="Berhenti bekerja bulan ini: PPh 21 dihitung setahun">Terakhir</th></>
                : <><th className="r">Gaji + tunjangan</th><th className="r">Lain-lain</th><th className="r">BPJS karyawan</th></>}
              {!editable && <th className="r">Bruto pajak</th>}<th className="r">PPh 21</th><th className="r">Gaji bersih</th><th></th></tr></thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={14} className="hint">ⓘ Tidak ada karyawan aktif untuk bulan ini.</td></tr>}
              {lines.map((l, i) => {
                const s = slipOf(l.karyawan_id)
                return (
                  <tr key={l.karyawan_id}>
                    <td className="nowrap">{empName(l.karyawan_id)}{s && <div className="small">{s.ptkp} · {s.metode === 'tahunan' ? 'hitung setahun' : `TER ${s.ter_kategori} ${String(s.ter_tarif).replace('.', ',')}%`}</div>}</td>
                    {editable ? <>
                      {NUMS.map((k) => <td key={k} className="num"><input inputMode="decimal" value={l[k] as string} onChange={(e) => setLine(i, { [k]: e.target.value })} onBlur={(e) => { const n = parseNum(e.target.value); if (n) setLine(i, { [k]: rp(n) }) }} /></td>)}
                      <td className="c"><input type="checkbox" checked={l.akhir} onChange={(e) => setLine(i, { akhir: e.target.checked })} /></td>
                    </> : s ? <>
                      <td className="r">{rp(s.gaji_pokok + s.tunjangan)}</td><td className="r">{rp(s.lembur + s.bonus + s.thr - s.potongan_absen, true)}</td>
                      <td className="r">{rp(s.bpjs_kes_k + s.jht_k + s.jp_k, true)}</td>
                    </> : <td colSpan={3} />}
                    {!editable && <td className="r">{s ? rp(s.bruto) : ''}</td>}
                    <td className={`r ${s && s.pph21 < 0 ? 'in' : ''}`}>{s ? rp(s.pph21) : ''}{editable && s && <div className="small">bruto {rp(s.bruto)}</div>}</td>
                    <td className="r tot">{s ? rp(s.neto) : ''}</td>
                    <td className="nowrap">{editable ? <button className="x" title="Keluarkan dari penggajian ini" onClick={() => { setTouched(true); setLines((ls) => ls.filter((_, j) => j !== i)) }}>×</button>
                      : s && <button className="link" onClick={() => printSlips([s])}>slip</button>}</td>
                  </tr>
                )
              })}
            </tbody>
            {calc && lines.length > 0 && <tfoot><tr><td colSpan={editable ? 9 : 4}>Total</td>{!editable && <td className="r tot">{rp(t.bruto)}</td>}<td className="r tot">{rp(t.pph21)}</td><td className="r tot">{rp(t.neto)}</td><td /></tr></tfoot>}
          </table>
        </div>
        {calc && lines.length > 0 && (
          <div className="kpis">
            <div className="card kpi"><span>Beban gaji perusahaan</span><b>Rp {rp(t.beban)}</b><small className="muted">gaji, tunjangan, lembur, bonus + BPJS perusahaan</small></div>
            <div className="card kpi"><span>Iuran BPJS disetor</span><b>Rp {rp(t.bpjs)}</b><small className="muted">bagian perusahaan + karyawan</small></div>
            <div className="card kpi"><span>PPh 21 disetor</span><b>Rp {rp(t.pph21)}</b><small className="muted">jatuh tempo tgl 15 bulan berikutnya</small></div>
          </div>
        )}
        {editable && <p className="hint">ⓘ Gaji pokok & tunjangan diambil dari data karyawan; ubah di sini hanya untuk bulan ini. Kasbon dipotong dari gaji bersih dan mengurangi Piutang karyawan (1-1302). Potongan absen mengurangi gaji & penghasilan bruto.</p>}
        <Banner kind="err">{err}</Banner>
      </div>
      {portal}
    </Modal>
  )
}

function SlipDoc({ s, periode, company, emp, last }: { s: Slip; periode: string; company: Record<string, string>; emp?: Emp; last: boolean }) {
  const row = (l: string, v: number) => (v ? <tr><td>{l}</td><td className="r">{rp(v)}</td></tr> : null)
  const terima = s.gaji_pokok + s.tunjangan + s.lembur + s.bonus + s.thr
  const potong = s.potongan_absen + s.bpjs_kes_k + s.jht_k + s.jp_k + s.pph21 + s.kasbon
  return (
    <div className="inv-doc slip" style={last ? undefined : { pageBreakAfter: 'always' }}>
      <div className="row between">
        <div><b className="inv-co-name">{company.nama}</b><div className="small">{company.alamat}</div></div>
        <div className="r"><b>SLIP GAJI</b><div>{bulanID(periode)}</div></div>
      </div>
      <table className="slip-kv"><tbody>
        <tr><td>Nama</td><td>{s.nama} ({s.kode})</td><td>Jabatan</td><td>{s.jabatan || '—'}</td></tr>
        <tr><td>Status PTKP</td><td>{s.ptkp}</td><td>Rekening</td><td>{emp ? `${emp.bank} ${emp.rekening}`.trim() || '—' : '—'}</td></tr>
      </tbody></table>
      <div className="grid2 top">
        <table className="slip-tbl"><thead><tr><th colSpan={2}>Penerimaan</th></tr></thead><tbody>
          {row('Gaji pokok', s.gaji_pokok)}{row('Tunjangan', s.tunjangan)}{row('Lembur', s.lembur)}{row('Bonus / insentif', s.bonus)}{row('THR', s.thr)}
          <tr className="sum"><td>Jumlah penerimaan</td><td className="r">{rp(terima)}</td></tr></tbody></table>
        <table className="slip-tbl"><thead><tr><th colSpan={2}>Potongan</th></tr></thead><tbody>
          {row('Potongan absensi', s.potongan_absen)}{row('BPJS Kesehatan 1%', s.bpjs_kes_k)}{row('JHT 2%', s.jht_k)}{row('Jaminan pensiun 1%', s.jp_k)}
          {s.pph21 !== 0 && <tr><td>PPh 21{s.pph21 < 0 ? ' (kelebihan dikembalikan)' : ''}</td><td className="r">{rp(s.pph21)}</td></tr>}{row('Kasbon', s.kasbon)}
          <tr className="sum"><td>Jumlah potongan</td><td className="r">{rp(potong)}</td></tr></tbody></table>
      </div>
      <div className="slip-net">Gaji bersih diterima <b>Rp {rp(s.neto)}</b></div>
      <p className="small">Ditanggung perusahaan (tidak dipotong): BPJS Kesehatan 4% Rp {rp(s.bpjs_kes_p)} · JHT 3,7% Rp {rp(s.jht_p)} · JP 2% Rp {rp(s.jp_p)} · JKK Rp {rp(s.jkk)} · JKM Rp {rp(s.jkm)}.
        {' '}PPh 21 {s.metode === 'tahunan' ? `dihitung setahun: PKP Rp ${rp(s.th_pkp)}, PPh setahun Rp ${rp(s.th_pph)}, sudah dipotong Rp ${rp(s.th_dipotong)}.` : `TER kategori ${s.ter_kategori} ${String(s.ter_tarif).replace('.', ',')}% × bruto Rp ${rp(s.bruto)}.`}</p>
      <div className="inv-foot"><span className="small">Dicetak {tglPanjang(today())}</span>
        <div className="inv-sign"><div>Diterima oleh,</div><div className="inv-sign-space" /><b>{s.nama}</b></div></div>
    </div>
  )
}

function PayForm({ run, periode, total, tglRun, onClose, onSaved }: { run: NonNullable<RunRes['run']>; periode: string; total: number; tglRun: string; onClose: () => void; onSaved: (t: string) => void }) {
  const cash = useCashAccounts()
  const [tgl, setTgl] = useState(today() < periode + '-01' ? tglRun : today())
  const [kb, setKb] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (cash && !kb) setKb(cash.find((k) => k.jenis === 'bank')?.id ?? cash[0]?.id ?? '') }, [cash]) // eslint-disable-line react-hooks/exhaustive-deps
  const blocker = !tgl ? 'Isi tanggal.' : tgl < periode + '-01' ? `Tidak boleh sebelum ${bulanID(periode)}.` : !kb ? 'Pilih rekening.' : cashShort(cash, kb, total)
  const go = async () => {
    if (blocker) return setErr(blocker)
    setBusy(true); setErr('')
    try { const r = await call<{ no: string }>('payroll.pay', { id: run.id, tgl, kasbank_id: kb }); onSaved(`Gaji ${bulanID(periode)} Rp ${rp(total)} dibayar (jurnal ${r.no}).`) } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  return (
    <Modal size="md" title={`Bayar gaji ${bulanID(periode)}`} sub={`Total gaji bersih Rp ${rp(total)} — dicatat sekali untuk semua karyawan.`} onClose={onClose}
      footer={<>{blocker ? <span className="warn-text">⚠ {blocker}</span> : <span className="ok-text">✓ Siap dibayar</span>}<button className="btn" onClick={onClose}>Kembali</button>
        <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={go} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan pembayaran'}</button></>}>
      <div className="grid2">
        <label className="field"><span>Tanggal bayar<Req /></span><input type="date" value={tgl} onChange={(e) => setTgl(e.target.value)} /></label>
        <label className="field"><span>Dari rekening<Req /></span>{cash ? <CashSelect list={cash} value={kb} onChange={setKb} /> : <Spinner />}</label>
      </div>
      <p className="hint">ⓘ Jurnal: Dr 2-1302 Utang gaji, Cr rekening. Iuran BPJS dan PPh 21 disetor terpisah (menu Pajak / Kas & Bank).</p>
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
}

function VoidRun({ run, periode, pay, onClose, onSaved }: { run: NonNullable<RunRes['run']>; periode: string; pay: boolean; onClose: () => void; onSaved: (t: string) => void }) {
  const [alasan, setAlasan] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const draft = run.status === 'draft'
  const go = async () => {
    if (!alasan.trim()) return setErr('Isi alasan.')
    setBusy(true); setErr('')
    try {
      await call(pay ? 'payroll.payVoid' : 'payroll.void', { id: run.id, alasan })
      onSaved(pay ? `Pembayaran gaji ${bulanID(periode)} dibatalkan.` : draft ? `Draft gaji ${bulanID(periode)} dibuang.` : `Penggajian ${bulanID(periode)} dibatalkan (jurnal pembalik dibuat).`)
    } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  return (
    <Modal size="sm" title={pay ? 'Batalkan pembayaran gaji?' : draft ? 'Buang draft penggajian?' : `Batalkan penggajian ${bulanID(periode)}?`} onClose={onClose} dirty={!!alasan.trim() && !busy}
      footer={<>{!alasan.trim() && <span className="warn-text">⚠ Isi alasan.</span>}<button className="btn" onClick={onClose}>Kembali</button><button className="btn danger" onClick={go} disabled={busy}>{busy ? 'Memproses…' : 'Ya, batalkan'}</button></>}>
      <label className="field"><span>Alasan<Req /></span><input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="tercatat di audit log" /></label>
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
}

// ---------------------------------------------------------------- karyawan

function EmployeesTab({ onFlash }: { onFlash: (t: string) => void }) {
  const { can } = useSession()
  const [rows, setRows] = useState<Emp[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [off, setOff] = useState(false)
  const [edit, setEdit] = useState<Emp | 'new' | null>(null)
  const load = useCallback(() => { call<Emp[]>('employee.list', {}).then(setRows).catch((e) => setErr(errorText(e))) }, [])
  useEffect(() => { load() }, [load])
  const shown = (rows ?? []).filter((e) => (off || e.aktif) && (!q || `${e.kode} ${e.nama} ${e.jabatan}`.toLowerCase().includes(q.toLowerCase())))
  return (
    <>
      <div className="filters">
        <input className="grow" placeholder="Cari nama / jabatan…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} /> Tampilkan nonaktif</label>
        {can('payroll.edit') && <button className="btn primary" onClick={() => setEdit('new')}>+ Karyawan</button>}
      </div>
      <Banner kind="err">{err}</Banner>
      <div className="card flush">
        {!rows ? <div className="pad"><Spinner /></div> : (
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th>Kode</th><th>Nama</th><th>Jabatan</th><th>PTKP</th><th className="r">Gaji pokok</th><th className="r">Tunjangan</th><th>BPJS</th></tr></thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={7} className="hint">ⓘ Belum ada karyawan.</td></tr>}
                {shown.map((e) => (
                  <tr key={e.id} className={`${can('payroll.edit') ? 'click' : ''} ${e.aktif ? '' : 'off'}`} onClick={() => can('payroll.edit') && setEdit(e)}>
                    <td className="mono">{e.kode}</td><td>{e.nama}{!e.aktif && <span className="pill n">nonaktif</span>}</td><td>{e.jabatan}{e.divisi && <div className="small">{e.divisi}</div>}</td>
                    <td>{e.ptkp}</td><td className="r">{rp(e.gaji_pokok)}</td><td className="r">{rp(e.tunjangan, true)}</td>
                    <td className="small">{[e.bpjs_kes === 'ya' && 'Kesehatan', e.bpjs_tk === 'ya' && 'Ketenagakerjaan'].filter(Boolean).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <EmployeeForm emp={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={(t) => { setEdit(null); onFlash(t); load() }} />}
    </>
  )
}

function EmployeeForm({ emp, onClose, onSaved }: { emp: Emp | null; onClose: () => void; onSaved: (t: string) => void }) {
  const init = { kode: emp?.kode ?? '', nama: emp?.nama ?? '', nik: emp?.nik ?? '', npwp: emp?.npwp ?? '', jabatan: emp?.jabatan ?? '', divisi: emp?.divisi ?? '', ptkp: emp?.ptkp ?? 'TK/0',
    gaji_pokok: emp ? rp(emp.gaji_pokok) : '', tunjangan: emp?.tunjangan ? rp(emp.tunjangan) : '', bank: emp?.bank ?? '', rekening: emp?.rekening ?? '', email: emp?.email ?? '',
    bpjs_kes: emp?.bpjs_kes ?? 'ya', bpjs_tk: emp?.bpjs_tk ?? 'ya', tgl_masuk: emp?.tgl_masuk ?? '', tgl_keluar: emp?.tgl_keluar ?? '', aktif: emp?.aktif ?? true }
  const [f, setF] = useState(init)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }))
  const dirty = JSON.stringify(f) !== JSON.stringify(init)
  const nik = f.nik.replace(/\D/g, '')
  const blocker = !f.nama.trim() ? 'Isi nama.' : !(parseNum(f.gaji_pokok) > 0) ? 'Isi gaji pokok.' : nik && nik.length !== 16 ? 'NIK harus 16 digit.' : ''
  const save = async () => {
    if (blocker) return setErr(blocker)
    setBusy(true); setErr('')
    try {
      const r = await call<{ kode: string }>('employee.save', { ...f, id: emp?.id, gaji_pokok: parseNum(f.gaji_pokok), tunjangan: parseNum(f.tunjangan) || 0 })
      onSaved(`Karyawan ${r.kode} ${f.nama} disimpan.`)
    } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  const money = (k: 'gaji_pokok' | 'tunjangan') => ({ className: 'num', inputMode: 'decimal' as const, value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: e.target.value }), onBlur: (e: React.FocusEvent<HTMLInputElement>) => { const n = parseNum(e.target.value); if (n) set({ [k]: rp(n) }) } })
  return (
    <Modal size="lg" title={emp ? `Ubah ${emp.kode} · ${emp.nama}` : 'Karyawan baru'} onClose={onClose} dirty={dirty && !busy}
      footer={<>{blocker ? <span className="warn-text">⚠ {blocker}</span> : <span className="ok-text">✓ Siap disimpan</span>}<button className="btn" onClick={onClose}>Batal</button>
        <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></>}>
      <div className="stack">
        <div className="grid3">
          <label className="field"><span>Nama lengkap<Req /></span><input value={f.nama} onChange={(e) => set({ nama: e.target.value })} /></label>
          <label className="field"><span>Jabatan</span><input value={f.jabatan} onChange={(e) => set({ jabatan: e.target.value })} /></label>
          <label className="field"><span>Kode</span><input value={f.kode} onChange={(e) => set({ kode: e.target.value })} placeholder="otomatis K-0001" /></label>
        </div>
        <div className="grid3">
          <label className="field"><span>Status PTKP<Req /></span><select value={f.ptkp} onChange={(e) => set({ ptkp: e.target.value })}>{PTKP.map((p) => <option key={p}>{p}</option>)}</select>
            <small className="hint">ⓘ TK = tidak kawin, K = kawin; angka = jumlah tanggungan (maks 3).</small></label>
          <label className="field"><span>Gaji pokok / bulan (Rp)<Req /></span><input {...money('gaji_pokok')} /></label>
          <label className="field"><span>Tunjangan tetap / bulan (Rp)</span><input {...money('tunjangan')} placeholder="0" /></label>
        </div>
        <div className="grid3">
          <label className="field"><span>NIK (KTP)</span><input inputMode="numeric" value={f.nik} onChange={(e) => set({ nik: e.target.value })} placeholder="16 digit — juga NPWP" /></label>
          <label className="field"><span>Divisi</span><input value={f.divisi} onChange={(e) => set({ divisi: e.target.value })} /></label>
          <label className="field"><span>Email</span><input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></label>
        </div>
        <div className="grid3">
          <label className="field"><span>Bank</span><input value={f.bank} onChange={(e) => set({ bank: e.target.value })} placeholder="BCA, Mandiri…" /></label>
          <label className="field"><span>No. rekening</span><input value={f.rekening} onChange={(e) => set({ rekening: e.target.value })} /></label>
          <label className="field"><span>Tanggal masuk</span><input type="date" value={f.tgl_masuk} onChange={(e) => set({ tgl_masuk: e.target.value })} /></label>
        </div>
        <div className="grid3">
          <label className="field"><span>BPJS Kesehatan</span><select value={f.bpjs_kes} onChange={(e) => set({ bpjs_kes: e.target.value })}><option value="ya">Ikut (4% perusahaan, 1% karyawan)</option><option value="tidak">Tidak</option></select></label>
          <label className="field"><span>BPJS Ketenagakerjaan</span><select value={f.bpjs_tk} onChange={(e) => set({ bpjs_tk: e.target.value })}><option value="ya">Ikut (JHT, JP, JKK, JKM)</option><option value="tidak">Tidak</option></select></label>
          <label className="field"><span>Tanggal keluar</span><input type="date" value={f.tgl_keluar} onChange={(e) => set({ tgl_keluar: e.target.value })} />
            <small className="hint">ⓘ Bulan keluar otomatis dihitung PPh 21 setahun.</small></label>
        </div>
        {emp && <label className="check"><input type="checkbox" checked={f.aktif} onChange={(e) => set({ aktif: e.target.checked })} /> Aktif (ikut penggajian bulanan)</label>}
        <Banner kind="err">{err}</Banner>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- tahunan

function AnnualTab() {
  const { boot } = useSession()
  const [tahun, setTahun] = useState(String(yearNow))
  const [d, setD] = useState<Annual | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setD(null); call<Annual>('payroll.annual', { tahun }).then(setD).catch((e) => setErr(errorText(e))) }, [tahun])
  const exportXlsx = () => d && downloadXlsx(`Rekap-PPh21-${d.tahun}.xlsx`, [{
    name: 'Rekap PPh 21', title: [boot?.company.nama ?? '', `Rekap Penghasilan & PPh 21 Tahun ${d.tahun}`, 'Bahan bukti potong 1721-A1'],
    columns: [{ header: 'Kode', key: 'kode', width: 9 }, { header: 'Nama', key: 'nama', width: 26 }, { header: 'PTKP', key: 'ptkp', width: 7 }, { header: 'Masa', key: 'masa', width: 12 },
      { header: 'Gaji', key: 'gaji', money: true }, { header: 'Tunjangan', key: 'tunjangan', money: true }, { header: 'Lembur', key: 'lembur', money: true }, { header: 'Bonus/THR', key: 'bonus_thr', money: true },
      { header: 'Premi asuransi', key: 'premi', money: true }, { header: 'Bruto', key: 'bruto', money: true }, { header: 'Biaya jabatan', key: 'biaya_jabatan', money: true },
      { header: 'Iuran pensiun/JHT', key: 'iuran', money: true }, { header: 'Neto', key: 'neto', money: true }, { header: 'PTKP (Rp)', key: 'ptkp_rp', money: true }, { header: 'PKP', key: 'pkp', money: true },
      { header: 'PPh 21 setahun', key: 'pph_setahun', money: true }, { header: 'Sudah dipotong', key: 'pph21', money: true }, { header: 'Selisih', key: 'selisih', money: true }],
    rows: d.rows.map((r) => ({ ...r, masa: `${r.dari.slice(5)}–${r.sampai.slice(5)}` })),
  }])
  return (
    <>
      <div className="filters">
        <label className="inline">Tahun <select value={tahun} onChange={(e) => setTahun(e.target.value)}>{[yearNow, yearNow - 1, yearNow - 2].map((y) => <option key={y}>{y}</option>)}</select></label>
        <span className="grow" /><button className="btn" onClick={exportXlsx} disabled={!d?.rows.length}>⤓ Excel</button>
      </div>
      <Banner kind="err">{err}</Banner>
      <div className="card flush">
        {!d ? <div className="pad"><Spinner /></div> : (
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th>Karyawan</th><th>Masa</th><th className="r">Bruto</th><th className="r">Biaya jabatan</th><th className="r">Iuran JHT/JP</th><th className="r">Neto</th><th className="r">PKP</th><th className="r">PPh setahun</th><th className="r">Dipotong</th><th className="r">Selisih</th></tr></thead>
              <tbody>
                {d.rows.length === 0 && <tr><td colSpan={10} className="hint">ⓘ Belum ada penggajian yang diposting tahun ini.</td></tr>}
                {d.rows.map((r) => (
                  <tr key={r.karyawan_id}><td>{r.nama}<div className="small">{r.kode} · {r.ptkp}</div></td><td className="nowrap">{bulanID(r.dari, false)} – {bulanID(r.sampai, false)}</td>
                    <td className="r">{rp(r.bruto)}</td><td className="r">{rp(r.biaya_jabatan)}</td><td className="r">{rp(r.iuran)}</td><td className="r">{rp(r.neto)}</td><td className="r">{rp(r.pkp)}</td>
                    <td className="r">{rp(r.pph_setahun)}</td><td className="r">{rp(r.pph21)}</td><td className={`r ${r.selisih ? 'neg' : ''}`}>{rp(r.selisih, true)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="hint">ⓘ Selisih nol bila penggajian Desember (atau bulan terakhir karyawan keluar) sudah diposting. Angka ini bahan bukti potong 1721-A1 di Coretax.</p>
    </>
  )
}

function BpjsSettings({ onClose, onSaved }: { onClose: () => void; onSaved: (t: string) => void }) {
  const [d, setD] = useState<ListRes['bpjs'] | null>(null)
  const [f, setF] = useState({ kes: '', jp: '', jkk: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { call<ListRes>('payroll.list', {}).then((r) => { setD(r.bpjs); setF({ kes: rp(r.bpjs.kes_batas), jp: rp(r.bpjs.jp_batas), jkk: String(r.bpjs.jkk_tarif).replace('.', ',') }) }).catch((e) => setErr(errorText(e))) }, [])
  const save = async () => {
    setBusy(true); setErr('')
    try { await call('payroll.settings', { bpjs_kes_batas: parseNum(f.kes), bpjs_jp_batas: parseNum(f.jp), bpjs_jkk_tarif: parseNum(f.jkk) }); onSaved('Pengaturan BPJS disimpan. Berlaku untuk penggajian yang dihitung sesudah ini.') }
    catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  const dirty = !!d && (parseNum(f.kes) !== d.kes_batas || parseNum(f.jp) !== d.jp_batas || parseNum(f.jkk) !== d.jkk_tarif)
  return (
    <Modal size="md" title="Pengaturan BPJS" sub="Tarif iuran mengikuti ketentuan (Kes 4%+1%, JHT 3,7%+2%, JP 2%+1%, JKM 0,3%). Batas upah berubah tiap tahun — sesuaikan di sini." onClose={onClose} dirty={dirty && !busy}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn primary" onClick={save} disabled={busy || !d}>{busy ? 'Menyimpan…' : 'Simpan'}</button></>}>
      {!d ? <Spinner /> : (
        <div className="stack">
          <label className="field"><span>Batas upah BPJS Kesehatan (Rp)<Req /></span><input className="num" value={f.kes} onChange={(e) => setF({ ...f, kes: e.target.value })} /></label>
          <label className="field"><span>Batas upah Jaminan Pensiun (Rp)<Req /></span><input className="num" value={f.jp} onChange={(e) => setF({ ...f, jp: e.target.value })} />
            <small className="hint">ⓘ Diumumkan BPJS Ketenagakerjaan tiap awal tahun.</small></label>
          <label className="field"><span>Tarif JKK (%)<Req /></span><input className="num" value={f.jkk} onChange={(e) => setF({ ...f, jkk: e.target.value })} />
            <small className="hint">ⓘ Sesuai tingkat risiko usaha: 0,24% sangat rendah · 0,54% rendah · 0,89% sedang · 1,27% tinggi · 1,74% sangat tinggi.</small></label>
        </div>
      )}
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
}
