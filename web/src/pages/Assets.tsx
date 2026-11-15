import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { AccountPicker, useAccounts } from '../components/AccountPicker'
import { CashSelect, cashShort, useCashAccounts } from '../components/CashPick'
import { Banner, Modal, PageHead, Req, Spinner, fmtTime } from '../components/ui'
import { downloadXlsx } from '../lib/excel'
import { bulanID, parseNum, rp, tglID, today } from '../lib/format'

type Kategori = { kode: string; nama: string; akun_aset: string; akun_akum: string; umur: number }
type Row = { id: string; kode: string; nama: string; kategori: string; lokasi: string; tgl_beli: string; harga: number; residu: number; umur_bln: number; metode: string
  akum: number; nilai_buku: number; susut_bulan: number; sisa_bln: number; disusutkan_sd: string; status: string; tgl_lepas: string; habis: boolean }
type RunHist = { periode: string; jumlah: number; aset: number; jurnal_id: string; no: string; tgl: string }
type List = { per: string; rows: Row[]; total: { harga: number; akum: number; nilai_buku: number; susut_bulan: number; jumlah: number }
  gl: { akun: string; nama: string; buku: number; register: number; selisih: number }[]; kategori: Kategori[]; metode: Record<string, string>; run: { terakhir: string; riwayat: RunHist[] } }
type Preview = { periode: string; tgl: string; total: number; blockers: string[]; lewat: string; terakhir: string; riwayat: RunHist[]
  lines: { aset_id: string; kode: string; nama: string; kategori: string; jumlah: number; bulan: number; dari: string; sampai: string; susulan: boolean }[] }
type Detail = {
  aset: Row & { sumber: string; akun_aset: string; akun_akum: string; akun_beban: string; akun_lawan: string; catatan: string; mulai_susut: string; akum_awal: number; akum_awal_per: string
    cara_lepas: string; harga_lepas: number; dibuat_oleh: string; dibuat_pada: string; alasan_batal: string }
  jadwal: { ym: string; jumlah: number; akum: number; nilai_buku: number; tercatat: boolean }[]
  riwayat: { periode: string; dari: string; sampai: string; jumlah: number; status: string; sumber: string; jurnal_id: string; no: string }[]
  akum: number; disusutkan_sd: string; jurnal: { id: string; no: string } | null; jurnal_lepas: { id: string; no: string } | null; kasbank: string
}

const KAT_DEFAULT: Kategori[] = [
  { kode: 'tanah', nama: 'Tanah', akun_aset: '1-2101', akun_akum: '', umur: 0 },
  { kode: 'bangunan', nama: 'Bangunan', akun_aset: '1-2201', akun_akum: '1-2209', umur: 240 },
  { kode: 'mesin', nama: 'Mesin & peralatan', akun_aset: '1-2301', akun_akum: '1-2309', umur: 96 },
  { kode: 'kendaraan', nama: 'Kendaraan', akun_aset: '1-2401', akun_akum: '1-2409', umur: 96 },
  { kode: 'inventaris', nama: 'Inventaris kantor & komputer', akun_aset: '1-2501', akun_akum: '1-2509', umur: 48 },
]
const METODE: Record<string, string> = { garis_lurus: 'Garis lurus', saldo_menurun: 'Saldo menurun ganda' }
const umurText = (b: number) => (!b ? 'tidak disusutkan' : b % 12 === 0 ? `${b / 12} tahun` : `${Math.floor(b / 12) ? Math.floor(b / 12) + ' th ' : ''}${b % 12} bln`)
const katName = (k: string) => KAT_DEFAULT.find((x) => x.kode === k)?.nama ?? k
const ymNow = () => today().slice(0, 7)

export function AssetsPage() {
  const { boot, can } = useSession()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') === 'penyusutan' ? 'penyusutan' : 'daftar'
  const [per, setPer] = useState(today())
  const [q, setQ] = useState('')
  const [d, setD] = useState<List | null>(null)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [form, setForm] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(() => {
    setErr('')
    call<List>('asset.list', { per }).then(setD).catch((e) => setErr(errorText(e)))
  }, [per])
  useEffect(() => { load() }, [load])
  const done = (t: string) => { setForm(false); setOpen(null); setFlash(t); load() }

  const rows = (d?.rows ?? []).filter((r) => !q || `${r.kode} ${r.nama} ${r.lokasi}`.toLowerCase().includes(q.toLowerCase()))
  const groups = useMemo(() => {
    const m: Record<string, Row[]> = {}
    rows.forEach((r) => { (m[r.kategori] ||= []).push(r) })
    return Object.entries(m)
  }, [rows])
  const glOff = (d?.gl ?? []).filter((g) => g.selisih !== 0)

  const exportXlsx = () => {
    if (!d) return
    downloadXlsx(`Aset-tetap-${d.per}.xlsx`, [{
      name: 'Aset tetap', title: [boot?.company.nama ?? '', 'Daftar Aset Tetap', `Per ${tglID(d.per)}`],
      columns: [{ header: 'Kode', key: 'kode', width: 10 }, { header: 'Nama aset', key: 'nama', width: 32 }, { header: 'Kategori', key: 'kat', width: 22 },
        { header: 'Tgl perolehan', key: 'tgl_beli', width: 13 }, { header: 'Harga perolehan', key: 'harga', money: true, width: 16 }, { header: 'Umur', key: 'umur', width: 10 },
        { header: 'Metode', key: 'met', width: 16 }, { header: 'Akumulasi penyusutan', key: 'akum', money: true, width: 18 }, { header: 'Nilai buku', key: 'nilai_buku', money: true, width: 16 },
        { header: 'Penyusutan/bulan', key: 'susut_bulan', money: true, width: 15 }, { header: 'Status', key: 'status', width: 10 }],
      rows: [...d.rows.map((r) => ({ ...r, kat: katName(r.kategori), umur: umurText(r.umur_bln), met: METODE[r.metode] ?? r.metode })),
        { nama: 'TOTAL (aset aktif)', harga: d.total.harga, akum: d.total.akum, nilai_buku: d.total.nilai_buku, susut_bulan: d.total.susut_bulan, bold: true }],
      bold: (r) => !!r.bold,
    }])
  }

  return (
    <>
      <PageHead title="Aset Tetap" sub="Daftar aset, penyusutan bulanan otomatis, dan pelepasan (jual/hapus) sesuai SAK EP.">
        {tab === 'daftar' && <button className="btn" onClick={exportXlsx} disabled={!d}>⤓ Excel</button>}
        {can('aset.edit') && <button className="btn primary" onClick={() => { setFlash(''); setForm(true) }}>+ Catat aset</button>}
      </PageHead>
      {flash && <Banner kind="ok">{flash}</Banner>}
      <Banner kind="err">{err}</Banner>
      <div className="tabs">
        <button className={tab === 'daftar' ? 'on' : ''} onClick={() => setSp({})}>Daftar aset</button>
        <button className={tab === 'penyusutan' ? 'on' : ''} onClick={() => setSp({ tab: 'penyusutan' })}>Proses penyusutan</button>
      </div>

      {tab === 'daftar' ? (
        <>
          <div className="filters">
            <label className="inline">Per tanggal <input type="date" value={per} onChange={(e) => setPer(e.target.value || today())} /></label>
            <input className="grow" placeholder="Cari kode / nama / lokasi…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {d && (
            <div className="kpis">
              <div className="card kpi"><span>Harga perolehan</span><b>Rp {rp(d.total.harga)}</b><small className="muted">{d.total.jumlah} aset aktif</small></div>
              <div className="card kpi"><span>Akumulasi penyusutan</span><b>Rp {rp(d.total.akum)}</b></div>
              <div className="card kpi"><span>Nilai buku</span><b>Rp {rp(d.total.nilai_buku)}</b></div>
              <div className="card kpi"><span>Penyusutan {bulanID(d.per.slice(0, 7), false)}</span><b>Rp {rp(d.total.susut_bulan)}</b></div>
            </div>
          )}
          {d && d.run.terakhir < ymNow() && d.rows.some((r) => r.status === 'aktif' && r.sisa_bln > 0) && (
            <div className="banner info">ⓘ Penyusutan terakhir diproses: {d.run.terakhir ? bulanID(d.run.terakhir) : 'belum pernah'}. <button className="link" onClick={() => setSp({ tab: 'penyusutan' })}>Proses penyusutan →</button></div>
          )}
          {glOff.length > 0 && (
            <div className="banner warn">⚠ Daftar aset belum sama dengan buku besar per {tglID(d!.per)}:
              <ul className="plain-list">{glOff.map((g) => <li key={g.akun}>{g.akun} {g.nama}: buku besar Rp {rp(g.buku)}, daftar aset Rp {rp(g.register)} (selisih Rp {rp(g.selisih)})</li>)}</ul>
              Aset lama yang sudah ada di saldo awal dicatat dengan cara perolehan <b>"Sudah tercatat (saldo awal)"</b>. Pembelian aset lewat Kas & Bank/jurnal manual juga perlu dicatat di sini dengan cara yang sama.
            </div>
          )}
          {d && !glOff.length && d.rows.length > 0 && <p className="ok-text">✓ Daftar aset cocok dengan buku besar per {tglID(d.per)}.</p>}
          <div className="card flush">
            {!d ? <div className="pad"><Spinner /></div> : (
              <div className="scroll-x">
                <table className="tbl">
                  <thead><tr><th>Kode</th><th>Aset</th><th>Perolehan</th><th className="r">Harga</th><th className="r">Akumulasi</th><th className="r">Nilai buku</th><th className="r">Susut/bulan</th><th>Sisa umur</th></tr></thead>
                  <tbody>
                    {rows.length === 0 && <tr><td colSpan={8} className="hint">ⓘ Belum ada aset tetap. Klik <b>+ Catat aset</b> untuk mencatat pembelian aset atau aset lama dari saldo awal.</td></tr>}
                    {groups.map(([k, rs]) => (
                      <GroupRows key={k} name={katName(k)} rows={rs} onOpen={setOpen} />
                    ))}
                  </tbody>
                  {rows.length > 0 && <tfoot><tr><td colSpan={3}>Total aset aktif</td><td className="r tot">{rp(d.total.harga)}</td><td className="r tot">{rp(d.total.akum)}</td><td className="r tot">{rp(d.total.nilai_buku)}</td><td className="r tot">{rp(d.total.susut_bulan)}</td><td /></tr></tfoot>}
                </table>
              </div>
            )}
          </div>
          <p className="hint">ⓘ Klik aset untuk melihat jadwal penyusutan, menjual/menghapus, atau membatalkan pencatatan.</p>
        </>
      ) : <RunTab onDone={(t) => { setFlash(t); load() }} />}

      {form && <AssetForm kategori={d?.kategori ?? KAT_DEFAULT} onClose={() => setForm(false)} onSaved={done} />}
      {open && <AssetDetail id={open} onClose={() => setOpen(null)} onChanged={done} />}
    </>
  )
}

function GroupRows({ name, rows, onOpen }: { name: string; rows: Row[]; onOpen: (id: string) => void }) {
  const aktif = rows.filter((r) => r.status === 'aktif')
  return (
    <>
      <tr className="sub"><td colSpan={3}>{name}</td><td className="r">{rp(aktif.reduce((t, r) => t + r.harga, 0))}</td><td className="r">{rp(aktif.reduce((t, r) => t + r.akum, 0))}</td>
        <td className="r">{rp(aktif.reduce((t, r) => t + r.nilai_buku, 0))}</td><td className="r">{rp(aktif.reduce((t, r) => t + r.susut_bulan, 0), true)}</td><td /></tr>
      {rows.map((r) => (
        <tr key={r.id} className={`click ${r.status !== 'aktif' ? 'off' : ''}`} onClick={() => onOpen(r.id)}>
          <td className="mono nowrap">{r.kode}</td>
          <td>{r.nama}{r.lokasi && <div className="small">{r.lokasi}</div>}
            {r.status === 'dilepas' && <span className="pill n">dilepas {tglID(r.tgl_lepas)}</span>}{r.habis && <span className="pill b">habis disusutkan</span>}</td>
          <td className="nowrap">{tglID(r.tgl_beli)}</td>
          <td className="r">{rp(r.harga)}</td><td className="r">{rp(r.akum, true)}</td><td className="r">{rp(r.nilai_buku)}</td><td className="r">{rp(r.susut_bulan, true)}</td>
          <td className="nowrap">{r.status !== 'aktif' ? '—' : r.umur_bln ? umurText(r.sisa_bln) : <span className="small">tidak disusutkan</span>}</td>
        </tr>
      ))}
    </>
  )
}

// ---------------------------------------------------------------- proses penyusutan

function RunTab({ onDone }: { onDone: (t: string) => void }) {
  const { can } = useSession()
  const [periode, setPeriode] = useState('')
  const [pv, setPv] = useState<Preview | null>(null)
  const [err, setErr] = useState('')
  const [ask, setAsk] = useState<'run' | RunHist | null>(null)
  const load = useCallback((p: string) => {
    setPv(null); setErr('')
    call<Preview>('asset.runPreview', p ? { periode: p } : {}).then((r) => { setPv(r); if (!p) setPeriode(r.periode) }).catch((e) => setErr(errorText(e)))
  }, [])
  useEffect(() => { load('') }, [load])
  const after = (t: string) => { setAsk(null); onDone(t); load('') }

  return (
    <>
      <Banner kind="err">{err}</Banner>
      <div className="card">
        <div className="row between">
          <h3>Penyusutan bulan</h3>
          <label className="inline">Bulan <input type="month" value={periode} max={ymNow()} onChange={(e) => { setPeriode(e.target.value); if (e.target.value) load(e.target.value) }} /></label>
        </div>
        {!pv ? <Spinner /> : (
          <>
            <p className="hint">ⓘ Jurnal penyesuaian bertanggal {tglID(pv.tgl)}: Dr Beban penyusutan, Cr Akumulasi penyusutan. {pv.terakhir ? `Terakhir diproses ${bulanID(pv.terakhir)}.` : 'Belum pernah diproses.'}</p>
            {pv.lewat && <p className="warn-text">⚠ Bulan {pv.lewat} belum diproses — penyusutannya ikut digabung ke {bulanID(pv.periode)} (susulan). Lebih rapi diproses bulan per bulan.</p>}
            {pv.lines.length > 0 && (
              <table className="tbl compact">
                <thead><tr><th>Kode</th><th>Aset</th><th>Bulan</th><th className="r">Penyusutan</th></tr></thead>
                <tbody>{pv.lines.map((l) => (
                  <tr key={l.aset_id}><td className="mono">{l.kode}</td><td>{l.nama}</td>
                    <td className="nowrap">{l.bulan > 1 ? `${bulanID(l.dari, false)} – ${bulanID(l.sampai, false)} (${l.bulan} bln)` : bulanID(l.dari, false)}{l.susulan && <span className="pill o">susulan</span>}</td>
                    <td className="r">{rp(l.jumlah)}</td></tr>
                ))}</tbody>
                <tfoot><tr><td colSpan={3}>Total</td><td className="r tot">{rp(pv.total)}</td></tr></tfoot>
              </table>
            )}
            <div className="row end">
              {pv.blockers.length > 0 ? <span className="warn-text">⚠ {pv.blockers[0]}</span> : <span className="ok-text">✓ {pv.lines.length} aset siap diproses</span>}
              {can('aset.edit') && <button className={`btn primary ${pv.blockers.length ? 'soft' : ''}`} onClick={() => (pv.blockers.length ? setErr(pv.blockers[0]) : setAsk('run'))}>Proses penyusutan {bulanID(pv.periode, false)}</button>}
            </div>
          </>
        )}
      </div>
      <h3>Riwayat proses</h3>
      <div className="card flush">
        {!pv ? <div className="pad"><Spinner /></div> : (
          <table className="tbl">
            <thead><tr><th>Bulan</th><th>Jurnal</th><th className="r">Aset</th><th className="r">Jumlah</th><th></th></tr></thead>
            <tbody>
              {pv.riwayat.length === 0 && <tr><td colSpan={5} className="hint">ⓘ Belum ada proses penyusutan.</td></tr>}
              {pv.riwayat.map((r, i) => (
                <tr key={r.periode}><td>{bulanID(r.periode)}</td>
                  <td>{can('jurnal.view') ? <Link className="mono" to={`/jurnal?open=${r.jurnal_id}`}>{r.no}</Link> : <span className="mono">{r.no}</span>}</td>
                  <td className="r">{r.aset}</td><td className="r">{rp(r.jumlah)}</td>
                  <td className="r">{i === 0 && can('aset.edit') && <button className="link" onClick={() => setAsk(r)}>Batalkan</button>}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {ask === 'run' && pv && <RunConfirm pv={pv} onClose={() => setAsk(null)} onDone={after} />}
      {ask && ask !== 'run' && <RunVoid run={ask} onClose={() => setAsk(null)} onDone={after} />}
    </>
  )
}

function RunConfirm({ pv, onClose, onDone }: { pv: Preview; onClose: () => void; onDone: (t: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    setBusy(true); setErr('')
    try {
      const r = await call<{ no: string; total: number; aset: number }>('asset.run', { periode: pv.periode })
      onDone(`Penyusutan ${bulanID(pv.periode)} diproses: ${r.aset} aset, Rp ${rp(r.total)} (jurnal ${r.no}).`)
    } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  return (
    <Modal size="sm" title={`Proses penyusutan ${bulanID(pv.periode)}?`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn primary" onClick={go} disabled={busy}>{busy ? 'Memproses…' : 'Proses & posting jurnal'}</button></>}>
      <p>{pv.lines.length} aset, total <b>Rp {rp(pv.total)}</b>, diposting sebagai jurnal penyesuaian tanggal {tglID(pv.tgl)}.</p>
      <p className="hint">ⓘ Kalau ada yang salah, proses terakhir bisa dibatalkan (dibuat jurnal pembalik).</p>
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
}

function RunVoid({ run, onClose, onDone }: { run: RunHist; onClose: () => void; onDone: (t: string) => void }) {
  const [alasan, setAlasan] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    setBusy(true); setErr('')
    try {
      const r = await call<{ pembalik: string }>('asset.runVoid', { periode: run.periode, alasan })
      onDone(`Penyusutan ${bulanID(run.periode)} dibatalkan (jurnal pembalik ${r.pembalik}).`)
    } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  return (
    <Modal size="sm" title={`Batalkan penyusutan ${bulanID(run.periode)}?`} onClose={onClose} dirty={!!alasan.trim() && !busy}
      footer={<>{!alasan.trim() && <span className="warn-text">⚠ Isi alasan.</span>}<button className="btn" onClick={onClose}>Kembali</button>
        <button className="btn danger" onClick={() => (alasan.trim() ? go() : setErr('Isi alasan pembatalan.'))} disabled={busy}>{busy ? 'Memproses…' : 'Batalkan'}</button></>}>
      <label className="field"><span>Alasan<Req /></span><input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="tercatat di audit log" /></label>
      <p className="hint">ⓘ Jurnal {run.no} dibalik. Setelah itu bulan ini bisa diproses ulang.</p>
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
}

// ---------------------------------------------------------------- catat aset

function AssetForm({ kategori, onClose, onSaved }: { kategori: Kategori[]; onClose: () => void; onSaved: (t: string) => void }) {
  const accounts = useAccounts()
  const cash = useCashAccounts()
  const [f, setF] = useState({ nama: '', kode: '', kategori: '', lokasi: '', catatan: '', tgl_beli: today(), harga: '', umur: '', residu: '', metode: 'garis_lurus',
    mulai: '', sumber: 'kas', kasbank_id: '', akun_lawan: '2-1101', akum_awal: '', akum_awal_per: '', akun_aset: '', akun_akum: '', akun_beban: '6-1401' })
  const [akunOpen, setAkunOpen] = useState(false)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (patch: Partial<typeof f>) => { setTouched(true); setF((x) => ({ ...x, ...patch })) }
  const kat = kategori.find((k) => k.kode === f.kategori)
  const pickKat = (k: string) => {
    const c = kategori.find((x) => x.kode === k)
    set({ kategori: k, umur: c ? String(c.umur) : '', akun_aset: c?.akun_aset ?? '', akun_akum: c?.akun_akum ?? '', metode: c?.umur ? f.metode : 'garis_lurus' })
  }
  useEffect(() => { if (cash && !f.kasbank_id) setF((x) => ({ ...x, kasbank_id: cash.find((k) => k.jenis === 'bank')?.id ?? cash[0]?.id ?? '' })) }, [cash]) // eslint-disable-line react-hooks/exhaustive-deps
  const harga = parseNum(f.harga) || 0
  const residu = parseNum(f.residu) || 0
  const umur = f.kategori === 'tanah' ? 0 : Number(f.umur) || 0
  const akumAwal = parseNum(f.akum_awal) || 0
  const perBulan = umur ? (f.metode === 'saldo_menurun' ? harga * Math.min(1, 2 / (umur / 12)) / 12 : (harga - residu - (f.sumber === 'tercatat' ? akumAwal : 0)) / Math.max(1, umur - (f.sumber === 'tercatat' && f.akum_awal_per && akumAwal ? monthsBetween(f.mulai || f.tgl_beli.slice(0, 7), f.akum_awal_per) : 0))) : 0
  const accName = (k: string) => accounts.find((a) => a.kode === k)?.nama ?? ''

  const blocker = !f.nama.trim() ? 'Isi nama aset.' : !f.kategori ? 'Pilih kategori.' : !f.tgl_beli ? 'Isi tanggal perolehan.' : harga <= 0 ? 'Isi harga perolehan.'
    : f.kategori !== 'tanah' && (!(umur > 0) || !Number.isInteger(umur)) ? 'Isi umur manfaat (bulan).'
    : residu < 0 || residu >= harga ? 'Nilai sisa harus lebih kecil dari harga.'
    : f.metode === 'saldo_menurun' && umur % 12 ? 'Saldo menurun memakai umur kelipatan 12 bulan.'
    : f.sumber === 'kas' && !f.kasbank_id ? 'Pilih rekening pembayar.'
    : f.sumber === 'kas' ? cashShort(cash, f.kasbank_id, harga)
    : f.sumber === 'akun' && !f.akun_lawan ? 'Pilih akun lawan.'
    : f.sumber === 'tercatat' && akumAwal > 0 && !f.akum_awal_per ? 'Isi bulan terakhir yang sudah termasuk di akumulasi awal.'
    : f.sumber === 'tercatat' && akumAwal > harga - residu ? 'Akumulasi awal melebihi harga dikurangi nilai sisa.'
    : ''

  const save = async () => {
    setErr('')
    if (blocker) return setErr(blocker)
    setBusy(true)
    try {
      const r = await call<{ kode: string; no: string }>('asset.save', {
        nama: f.nama, kode: f.kode, kategori: f.kategori, lokasi: f.lokasi, catatan: f.catatan, tgl_beli: f.tgl_beli, harga, umur_bln: umur, residu, metode: f.metode,
        mulai_susut: f.mulai, sumber: f.sumber, kasbank_id: f.kasbank_id, akun_lawan: f.akun_lawan, akum_awal: akumAwal, akum_awal_per: f.akum_awal_per,
        akun_aset: f.akun_aset, akun_akum: f.akun_akum, akun_beban: f.akun_beban,
      })
      onSaved(`Aset ${r.kode} ${f.nama} tercatat${r.no ? ` (jurnal ${r.no})` : ' tanpa jurnal (sudah ada di saldo awal)'}.`)
    } catch (e) { setErr(errorText(e)); setBusy(false) }
  }

  return (
    <Modal size="lg" title="Catat aset tetap" sub="Harga perolehan termasuk ongkos kirim/pasang sampai aset siap dipakai. Penyusutan dimulai bulan perolehan." onClose={onClose} dirty={touched && !busy}
      footer={<>
        {blocker ? <span className="warn-text">⚠ {blocker}</span> : umur ? <span className="ok-text">✓ Penyusutan ± Rp {rp(Math.round(perBulan))}/bulan</span> : <span className="ok-text">✓ Siap disimpan</span>}
        <button className="btn" onClick={onClose}>Batal</button>
        <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan aset'}</button>
      </>}>
      <div className="stack">
        <div className="grid2">
          <label className="field"><span>Nama aset<Req /></span><input value={f.nama} onChange={(e) => set({ nama: e.target.value })} placeholder="mis. Mesin cetak Epson L1800" /></label>
          <label className="field"><span>Kategori<Req /></span>
            <select value={f.kategori} onChange={(e) => pickKat(e.target.value)}>
              <option value="">— pilih kategori —</option>
              {kategori.map((k) => <option key={k.kode} value={k.kode}>{k.nama}</option>)}
            </select>
            {kat && <small className="hint">ⓘ Umur bawaan {umurText(kat.umur)}{kat.umur ? ' (kelompok harta pajak)' : ''}. Boleh diubah sesuai taksiran manajemen.</small>}
          </label>
        </div>
        <div className="grid3">
          <label className="field"><span>Tanggal perolehan<Req /></span><input type="date" value={f.tgl_beli} onChange={(e) => set({ tgl_beli: e.target.value })} /></label>
          <label className="field"><span>Harga perolehan (Rp)<Req /></span>
            <input className="num" inputMode="decimal" value={f.harga} onChange={(e) => set({ harga: e.target.value })} onBlur={(e) => { const n = parseNum(e.target.value); if (n) set({ harga: rp(n) }) }} /></label>
          <label className="field"><span>Kode aset</span><input value={f.kode} onChange={(e) => set({ kode: e.target.value })} placeholder="otomatis AT-0001" /></label>
        </div>
        {f.kategori !== 'tanah' && (
          <div className="grid3">
            <label className="field"><span>Umur manfaat (bulan)<Req /></span><input inputMode="numeric" value={f.umur} onChange={(e) => set({ umur: e.target.value.replace(/\D/g, '') })} />
              {umur > 0 && <small className="hint">ⓘ {umurText(umur)}</small>}</label>
            <label className="field"><span>Nilai sisa (Rp)</span><input className="num" inputMode="decimal" value={f.residu} onChange={(e) => set({ residu: e.target.value })} placeholder="0" /></label>
            <label className="field"><span>Metode</span><select value={f.metode} onChange={(e) => set({ metode: e.target.value })}>{Object.entries(METODE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          </div>
        )}
        {f.kategori === 'tanah' && <p className="hint">ⓘ Tanah tidak disusutkan.</p>}
        <div className="grid2">
          <label className="field"><span>Lokasi / pemakai</span><input value={f.lokasi} onChange={(e) => set({ lokasi: e.target.value })} placeholder="mis. Workshop, ruang desain" /></label>
          <label className="field"><span>Catatan</span><input value={f.catatan} onChange={(e) => set({ catatan: e.target.value })} placeholder="no. seri, no. polisi…" /></label>
        </div>

        <div className="field"><span>Cara perolehan<Req /></span>
          <div className="segbtn">
            {[['kas', 'Dibayar dari kas/bank'], ['akun', 'Utang / akun lain'], ['tercatat', 'Sudah tercatat (saldo awal)']].map(([k, l]) => (
              <button key={k} type="button" className={f.sumber === k ? 'on' : ''} onClick={() => set({ sumber: k })}>{l}</button>
            ))}
          </div>
        </div>
        {f.sumber === 'kas' && (
          <label className="field"><span>Dibayar dari<Req /></span>{cash ? <CashSelect list={cash} value={f.kasbank_id} onChange={(v) => set({ kasbank_id: v })} /> : <Spinner />}
            <small className="hint">ⓘ Jurnal: Dr {f.akun_aset || 'akun aset'}, Cr rekening ini. Tercatat juga di Kas & Bank.</small></label>
        )}
        {f.sumber === 'akun' && (
          <label className="field"><span>Akun lawan<Req /></span><AccountPicker value={f.akun_lawan} onChange={(v) => set({ akun_lawan: v })} types={['liabilitas', 'ekuitas', 'aset']} />
            <small className="hint">ⓘ 2-1101 Utang usaha (beli kredit), 2-2101 Utang bank (kredit/leasing), 3-1101 Modal (setoran aset pemilik). Jurnal: Dr akun aset, Cr akun ini.</small></label>
        )}
        {f.sumber === 'tercatat' && (
          <div className="pot-box stack">
            <p className="hint">ⓘ Untuk aset yang nilainya sudah masuk saldo awal atau sudah dijurnal manual. Tidak membuat jurnal baru.</p>
            <div className="grid2">
              <label className="field"><span>Akumulasi penyusutan s/d saat itu (Rp)</span><input className="num" inputMode="decimal" value={f.akum_awal} onChange={(e) => set({ akum_awal: e.target.value })} placeholder="0" /></label>
              <label className="field"><span>Sudah termasuk s/d bulan{akumAwal > 0 && <Req />}</span><input type="month" value={f.akum_awal_per} onChange={(e) => set({ akum_awal_per: e.target.value })} />
                <small className="hint">ⓘ Biasanya bulan sebelum mulai memakai aplikasi. Penyusutan berikutnya mulai bulan sesudahnya.</small></label>
            </div>
          </div>
        )}
        <button type="button" className="link left" onClick={() => setAkunOpen(!akunOpen)}>{akunOpen ? '▾' : '▸'} Akun & mulai penyusutan</button>
        {akunOpen && (
          <div className="grid2">
            <label className="field"><span>Akun aset</span><AccountPicker value={f.akun_aset} onChange={(v) => set({ akun_aset: v })} types={['aset']} /><small>{accName(f.akun_aset)}</small></label>
            {umur > 0 && <label className="field"><span>Akun akumulasi penyusutan</span><AccountPicker value={f.akun_akum} onChange={(v) => set({ akun_akum: v })} types={['aset']} /></label>}
            {umur > 0 && <label className="field"><span>Akun beban penyusutan</span><AccountPicker value={f.akun_beban} onChange={(v) => set({ akun_beban: v })} types={['beban', 'hpp']} /></label>}
            {umur > 0 && <label className="field"><span>Mulai disusutkan</span><input type="month" value={f.mulai || f.tgl_beli.slice(0, 7)} onChange={(e) => set({ mulai: e.target.value })} /></label>}
          </div>
        )}
        <Banner kind="err">{err}</Banner>
      </div>
    </Modal>
  )
}

function monthsBetween(a: string, b: string) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1
}

// ---------------------------------------------------------------- detail aset

type Mode = 'view' | 'edit' | 'dispose' | 'void' | 'voidDispose'

function AssetDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (t: string) => void }) {
  const { can } = useSession()
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState('')
  const [mode, setMode] = useState<Mode>('view')
  useEffect(() => { call<Detail>('asset.get', { id }).then(setD).catch((e) => setErr(errorText(e))) }, [id])
  if (!d) return <Modal title="Aset" onClose={onClose}>{err ? <Banner kind="err">{err}</Banner> : <Spinner />}</Modal>
  const a = d.aset
  if (mode === 'edit') return <EditInfo a={a} onClose={() => setMode('view')} onSaved={onChanged} />
  if (mode === 'dispose') return <DisposeForm d={d} onClose={() => setMode('view')} onSaved={onChanged} />
  if (mode === 'void' || mode === 'voidDispose') return <VoidAsset a={a} dispose={mode === 'voidDispose'} onClose={() => setMode('view')} onSaved={onChanged} />
  const edit = can('aset.edit')
  return (
    <Modal size="xl" title={`${a.kode} · ${a.nama}`} sub={`${katName(a.kategori)} · ${a.status === 'batal' ? 'dibatalkan' : a.status === 'dilepas' ? `dilepas ${tglID(a.tgl_lepas)}` : 'aktif'}`} onClose={onClose}
      footer={<>
        {d.jurnal && can('jurnal.view') && <Link className="btn" to={`/jurnal?open=${d.jurnal.id}`}>Jurnal perolehan</Link>}
        {d.jurnal_lepas && can('jurnal.view') && <Link className="btn" to={`/jurnal?open=${d.jurnal_lepas.id}`}>Jurnal pelepasan</Link>}
        {edit && a.status !== 'batal' && <button className="btn" onClick={() => setMode('edit')}>Ubah nama/lokasi</button>}
        {edit && a.status === 'aktif' && <button className="btn" onClick={() => setMode('dispose')}>Jual / hapus</button>}
        {edit && a.status === 'aktif' && !d.riwayat.some((r) => r.status === 'aktif') && <button className="btn warn" onClick={() => setMode('void')}>Batalkan pencatatan</button>}
        {edit && a.status === 'dilepas' && <button className="btn warn" onClick={() => setMode('voidDispose')}>Batalkan pelepasan</button>}
        <button className="btn primary" onClick={onClose}>Tutup</button>
      </>}>
      <div className="grid2 top">
        <table className="tbl kv"><tbody>
          <tr><td>Tanggal perolehan</td><td>{tglID(a.tgl_beli)}</td></tr>
          <tr><td>Harga perolehan</td><td>Rp {rp(a.harga)}</td></tr>
          <tr><td>Umur · metode</td><td>{umurText(a.umur_bln)}{a.umur_bln ? ` · ${METODE[a.metode] ?? a.metode}` : ''}{a.residu ? ` · nilai sisa Rp ${rp(a.residu)}` : ''}</td></tr>
          <tr><td>Cara perolehan</td><td>{a.sumber === 'kas' ? `Dibayar dari ${d.kasbank}` : a.sumber === 'akun' ? `Akun lawan ${a.akun_lawan}` : 'Sudah tercatat (saldo awal)'}</td></tr>
          {a.akum_awal > 0 && <tr><td>Akumulasi awal</td><td>Rp {rp(a.akum_awal)} s/d {bulanID(a.akum_awal_per)}</td></tr>}
          <tr><td>Akun</td><td className="small">{a.akun_aset}{a.akun_akum && ` · akumulasi ${a.akun_akum} · beban ${a.akun_beban}`}</td></tr>
          {a.lokasi && <tr><td>Lokasi</td><td>{a.lokasi}</td></tr>}
          {a.catatan && <tr><td>Catatan</td><td>{a.catatan}</td></tr>}
          <tr><td>Dicatat</td><td className="small">{a.dibuat_oleh} · {fmtTime(a.dibuat_pada)}</td></tr>
        </tbody></table>
        <div className="stack">
          <div className="kpis">
            <div className="card kpi"><span>Akumulasi tercatat</span><b>Rp {rp(a.status === 'dilepas' ? 0 : d.akum)}</b></div>
            <div className="card kpi"><span>Nilai buku</span><b>Rp {rp(a.status === 'dilepas' ? 0 : a.harga - d.akum)}</b></div>
          </div>
          {a.status === 'dilepas' && <p className="hint">ⓘ {a.cara_lepas === 'jual' ? `Dijual Rp ${rp(a.harga_lepas)}` : 'Dihapus (tanpa hasil penjualan)'} pada {tglID(a.tgl_lepas)}.</p>}
          {a.status === 'batal' && <p className="err-text">Dibatalkan: {a.alasan_batal}</p>}
          {d.disusutkan_sd && <p className="small">Penyusutan tercatat s/d {bulanID(d.disusutkan_sd)}.</p>}
        </div>
      </div>
      {d.jadwal.length > 0 && (
        <>
          <h4>Jadwal penyusutan</h4>
          <div className="scroll-x sched">
            <table className="tbl compact">
              <thead><tr><th>Bulan</th><th className="r">Penyusutan</th><th className="r">Akumulasi</th><th className="r">Nilai buku</th><th></th></tr></thead>
              <tbody>{d.jadwal.map((j) => (
                <tr key={j.ym} className={j.tercatat ? '' : 'off'}><td>{bulanID(j.ym, false)}</td><td className="r">{rp(j.jumlah)}</td><td className="r">{rp(j.akum)}</td><td className="r">{rp(j.nilai_buku)}</td>
                  <td>{j.tercatat ? <span className="pill g">tercatat</span> : ''}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {d.riwayat.length > 0 && (
        <>
          <h4>Riwayat jurnal penyusutan</h4>
          <table className="tbl compact">
            <thead><tr><th>Diproses</th><th>Mencakup</th><th>Jurnal</th><th className="r">Jumlah</th><th></th></tr></thead>
            <tbody>{d.riwayat.map((r, i) => (
              <tr key={i} className={r.status === 'batal' ? 'off' : ''}><td>{bulanID(r.periode, false)}</td><td>{r.dari === r.sampai ? bulanID(r.dari, false) : `${bulanID(r.dari, false)} – ${bulanID(r.sampai, false)}`}</td>
                <td className="mono">{r.no}</td><td className="r">{rp(r.jumlah)}</td><td>{r.status === 'batal' ? <span className="pill r">batal</span> : r.sumber === 'lepas' ? <span className="pill n">saat pelepasan</span> : ''}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}
    </Modal>
  )
}

function EditInfo({ a, onClose, onSaved }: { a: Detail['aset']; onClose: () => void; onSaved: (t: string) => void }) {
  const [nama, setNama] = useState(a.nama)
  const [lokasi, setLokasi] = useState(a.lokasi)
  const [catatan, setCatatan] = useState(a.catatan)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const dirty = nama !== a.nama || lokasi !== a.lokasi || catatan !== a.catatan
  const save = async () => {
    if (!nama.trim()) return setErr('Isi nama aset.')
    setBusy(true); setErr('')
    try { await call('asset.save', { id: a.id, nama, lokasi, catatan }); onSaved(`Data aset ${a.kode} diperbarui.`) } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  return (
    <Modal size="md" title={`Ubah ${a.kode}`} sub="Angka perolehan & penyusutan tidak bisa diubah di sini — batalkan pencatatan lalu catat ulang bila salah." onClose={onClose} dirty={dirty && !busy}
      footer={<>{!nama.trim() && <span className="warn-text">⚠ Isi nama aset.</span>}<button className="btn" onClick={onClose}>Kembali</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></>}>
      <div className="stack">
        <label className="field"><span>Nama aset<Req /></span><input value={nama} onChange={(e) => setNama(e.target.value)} /></label>
        <label className="field"><span>Lokasi / pemakai</span><input value={lokasi} onChange={(e) => setLokasi(e.target.value)} /></label>
        <label className="field"><span>Catatan</span><input value={catatan} onChange={(e) => setCatatan(e.target.value)} /></label>
        <Banner kind="err">{err}</Banner>
      </div>
    </Modal>
  )
}

function DisposeForm({ d, onClose, onSaved }: { d: Detail; onClose: () => void; onSaved: (t: string) => void }) {
  const a = d.aset
  const cash = useCashAccounts()
  const [cara, setCara] = useState<'jual' | 'hapus'>('jual')
  const [tgl, setTgl] = useState(today())
  const [harga, setHarga] = useState('')
  const [via, setVia] = useState<'kas' | 'akun'>('kas')
  const [kb, setKb] = useState('')
  const [akun, setAkun] = useState('1-1301')
  const [ket, setKet] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (cash && !kb) setKb(cash.find((k) => k.jenis === 'bank')?.id ?? cash[0]?.id ?? '') }, [cash]) // eslint-disable-line react-hooks/exhaustive-deps
  const jual = cara === 'jual' ? parseNum(harga) || 0 : 0
  const ym = tgl.slice(0, 7)
  const blocker = !tgl ? 'Isi tanggal.' : tgl < a.tgl_beli ? 'Tanggal sebelum perolehan.'
    : d.disusutkan_sd && d.disusutkan_sd >= ym ? `Penyusutan sudah diproses s/d ${bulanID(d.disusutkan_sd)}; pilih tanggal sesudahnya.`
    : cara === 'jual' && jual <= 0 ? 'Isi harga jual.' : cara === 'jual' && via === 'kas' && !kb ? 'Pilih rekening penerima.' : cara === 'jual' && via === 'akun' && !akun ? 'Pilih akun penerimaan.' : ''
  const save = async () => {
    if (blocker) return setErr(blocker)
    setBusy(true); setErr('')
    try {
      const r = await call<{ no: string; nilai_buku: number; laba_rugi: number; susulan: number }>('asset.dispose', {
        id: a.id, tgl, cara, harga_jual: jual, kasbank_id: cara === 'jual' && via === 'kas' ? kb : '', akun_terima: cara === 'jual' && via === 'akun' ? akun : '', keterangan: ket })
      onSaved(`${a.kode} ${cara === 'jual' ? 'dijual' : 'dihapus'} (jurnal ${r.no}). Nilai buku Rp ${rp(r.nilai_buku)}, ${r.laba_rugi >= 0 ? 'laba' : 'rugi'} Rp ${rp(Math.abs(r.laba_rugi))}${r.susulan ? `, termasuk penyusutan susulan Rp ${rp(r.susulan)}` : ''}.`)
    } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  return (
    <Modal size="md" title={`Jual / hapus ${a.kode}`} sub={`${a.nama} · nilai buku saat ini Rp ${rp(a.harga - d.akum)}`} onClose={onClose} dirty={!busy && (!!harga || !!ket)}
      footer={<>{blocker ? <span className="warn-text">⚠ {blocker}</span> : <span className="ok-text">✓ Siap diposting</span>}<button className="btn" onClick={onClose}>Kembali</button>
        <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={save} disabled={busy}>{busy ? 'Memproses…' : cara === 'jual' ? 'Posting penjualan' : 'Posting penghapusan'}</button></>}>
      <div className="stack">
        <div className="segbtn">
          <button type="button" className={cara === 'jual' ? 'on' : ''} onClick={() => setCara('jual')}>Dijual</button>
          <button type="button" className={cara === 'hapus' ? 'on' : ''} onClick={() => setCara('hapus')}>Dihapus / rusak / hilang</button>
        </div>
        <div className="grid2">
          <label className="field"><span>Tanggal<Req /></span><input type="date" value={tgl} onChange={(e) => setTgl(e.target.value)} /></label>
          {cara === 'jual' && <label className="field"><span>Harga jual (Rp)<Req /></span><input className="num" inputMode="decimal" value={harga} onChange={(e) => setHarga(e.target.value)} onBlur={(e) => { const n = parseNum(e.target.value); if (n) setHarga(rp(n)) }} /></label>}
        </div>
        {cara === 'jual' && (
          <>
            <div className="segbtn">
              <button type="button" className={via === 'kas' ? 'on' : ''} onClick={() => setVia('kas')}>Diterima tunai/transfer</button>
              <button type="button" className={via === 'akun' ? 'on' : ''} onClick={() => setVia('akun')}>Belum dibayar (piutang)</button>
            </div>
            {via === 'kas' ? <label className="field"><span>Masuk ke<Req /></span>{cash ? <CashSelect list={cash} value={kb} onChange={setKb} /> : <Spinner />}</label>
              : <label className="field"><span>Akun piutang<Req /></span><AccountPicker value={akun} onChange={setAkun} types={['aset']} /></label>}
          </>
        )}
        <label className="field"><span>Keterangan</span><input value={ket} onChange={(e) => setKet(e.target.value)} placeholder={cara === 'jual' ? 'mis. dijual ke Bpk. Ahmad' : 'mis. rusak berat, tidak bisa diperbaiki'} /></label>
        <p className="hint">ⓘ Penyusutan bulan-bulan sebelum tanggal ini yang belum diproses ikut dicatat. Selisih harga jual dengan nilai buku masuk 7-1103 Laba / 7-2103 Rugi penjualan aset.</p>
        <Banner kind="err">{err}</Banner>
      </div>
    </Modal>
  )
}

function VoidAsset({ a, dispose, onClose, onSaved }: { a: Detail['aset']; dispose: boolean; onClose: () => void; onSaved: (t: string) => void }) {
  const [alasan, setAlasan] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    if (!alasan.trim()) return setErr('Isi alasan pembatalan.')
    setBusy(true); setErr('')
    try {
      const r = await call<{ pembalik: string }>(dispose ? 'asset.disposeVoid' : 'asset.void', { id: a.id, alasan })
      onSaved(dispose ? `Pelepasan ${a.kode} dibatalkan — aset aktif kembali${r.pembalik ? ` (pembalik ${r.pembalik})` : ''}.` : `Pencatatan ${a.kode} dibatalkan${r.pembalik ? ` (pembalik ${r.pembalik})` : ''}.`)
    } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  return (
    <Modal size="sm" title={dispose ? `Batalkan pelepasan ${a.kode}?` : `Batalkan pencatatan ${a.kode}?`} onClose={onClose} dirty={!!alasan.trim() && !busy}
      footer={<>{!alasan.trim() && <span className="warn-text">⚠ Isi alasan.</span>}<button className="btn" onClick={onClose}>Kembali</button><button className="btn danger" onClick={go} disabled={busy}>{busy ? 'Memproses…' : 'Batalkan'}</button></>}>
      <label className="field"><span>Alasan<Req /></span><input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="tercatat di audit log" /></label>
      <p className="hint">ⓘ {dispose ? 'Jurnal penjualan/penghapusan dibalik dan aset kembali disusutkan.' : 'Jurnal perolehan dibalik. Hanya bisa bila penyusutannya belum pernah diproses.'}</p>
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
}
