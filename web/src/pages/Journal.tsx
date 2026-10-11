import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { AccountPicker, useAccounts, type Account } from '../components/AccountPicker'
import { Banner, Modal, PageHead, Req, Spinner, fmtTime } from '../components/ui'
import { monthStart, rp, tglID, today } from '../lib/format'

type Head = {
  id: string; no: string; tgl: string; jenis: string; keterangan: string; referensi: string; status: string; total: number
  dibuat_oleh: string; dibuat_pada: string; diposting_oleh: string; diposting_pada: string; balik_otomatis: boolean
  jurnal_asal: string; alasan_batal: string; dibatalkan_oleh: string; ref_dok: string
}
type Detail = Head & { lines: { baris: number; akun_id: string; akun_nama: string; memo: string; debit: number; kredit: number }[] }

const STATUS: Record<string, [string, string]> = {
  draft: ['Draft', 'n'], menunggu: ['Menunggu approval', 'o'], posted: ['Posted', 'g'], batal: ['Dibatalkan', 'r'],
}
const JENIS: Record<string, string> = { JU: 'b', JP: 'o', SA: 'g', JR: 'n', JT: 'r' }

export function JournalPage() {
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') || 'daftar'
  const setTab = (t: string, extra: Record<string, string> = {}) => setSp({ tab: t, ...extra })
  const { can } = useSession()
  return (
    <>
      <PageHead title="Jurnal & Buku Besar" sub="Semua transaksi tercatat sebagai jurnal double-entry. Debit harus sama dengan kredit.">
        {can('jurnal.edit') && <Link className="btn primary" to="/jurnal/baru">+ Jurnal</Link>}
      </PageHead>
      <div className="tabs">
        {[['daftar', 'Daftar jurnal'], ['buku-besar', 'Buku besar'], ['neraca-saldo', 'Neraca saldo'], ['akun', 'Chart of accounts']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'daftar' && <JournalList />}
      {tab === 'buku-besar' && <LedgerTab initial={sp.get('akun') ?? ''} />}
      {tab === 'neraca-saldo' && <TrialTab onOpen={(k) => setTab('buku-besar', { akun: k })} />}
      {tab === 'akun' && <CoaTab />}
    </>
  )
}

// ---------------------------------------------------------------- daftar jurnal

function JournalList() {
  const [sp, setSp] = useSearchParams()
  const [rows, setRows] = useState<Head[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [f, setF] = useState({ from: '', to: '', status: '', jenis: '', q: '' })
  const [offset, setOffset] = useState(0)
  const openId = sp.get('open')
  const flash = sp.get('msg')

  // muat ulang daftar setiap ada pesan sukses baru (mis. setelah posting dari modal form)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await call<{ total: number; rows: Head[] }>('journal.list', { ...f, limit: 50, offset })
      setRows(d.rows)
      setTotal(d.total)
    } catch (e) {
      setErr(errorText(e))
    }
    setLoading(false)
  }, [f, offset, sp.get('t')]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const open = (id: string | null) => {
    const next = new URLSearchParams(sp)
    next.delete('msg')
    if (id) next.set('open', id)
    else next.delete('open')
    setSp(next)
  }

  return (
    <>
      {flash && <Banner kind="ok">{flash}</Banner>}
      <div className="filters">
        <input type="date" value={f.from} onChange={(e) => { setOffset(0); setF({ ...f, from: e.target.value }) }} title="Dari tanggal" />
        <input type="date" value={f.to} onChange={(e) => { setOffset(0); setF({ ...f, to: e.target.value }) }} title="Sampai tanggal" />
        <select value={f.status} onChange={(e) => { setOffset(0); setF({ ...f, status: e.target.value }) }}>
          <option value="">Semua status</option>
          {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={f.jenis} onChange={(e) => { setOffset(0); setF({ ...f, jenis: e.target.value }) }}>
          <option value="">Semua jenis</option>
          <option value="JU">JU · Umum</option><option value="JP">JP · Penyesuaian</option><option value="SA">SA · Saldo awal</option>
          <option value="JR">JR · Pembalik</option><option value="JT">JT · Penutup</option>
        </select>
        <input className="grow" placeholder="Cari nomor, keterangan, referensi…" value={f.q} onChange={(e) => { setOffset(0); setF({ ...f, q: e.target.value }) }} />
      </div>
      <Banner kind="err">{err}</Banner>
      <div className={openId ? 'split' : ''}>
        <div className="card flush">
          {loading ? <div className="pad"><Spinner /></div> : (
            <table className="tbl">
              <thead><tr><th>Tanggal</th><th>Nomor</th><th>Keterangan</th><th className="r">Total</th><th>Status</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} className="hint">ⓘ Belum ada jurnal. Mulai dengan jurnal saldo awal (jenis SA).</td></tr>}
                {rows.map((h) => (
                  <tr key={h.id} className={`click ${openId === h.id ? 'sel' : ''}`} onClick={() => open(h.id)}>
                    <td className="nowrap">{tglID(h.tgl)}</td>
                    <td className="nowrap"><span className={`pill ${JENIS[h.jenis] ?? 'n'}`}>{h.jenis}</span> <span className="mono">{h.no || '—'}</span></td>
                    <td>{h.keterangan}{h.referensi && <span className="muted"> · {h.referensi}</span>}</td>
                    <td className="r nowrap">{rp(h.total)}</td>
                    <td><span className={`pill ${STATUS[h.status]?.[1]}`}>{STATUS[h.status]?.[0] ?? h.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="pager">
            <span className="muted small">{total ? `${offset + 1}–${Math.min(offset + 50, total)} dari ${total}` : ''}</span>
            <button className="btn" disabled={offset === 0} onClick={() => setOffset(offset - 50)}>‹</button>
            <button className="btn" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)}>›</button>
          </div>
        </div>
        {openId && <JournalDetail id={openId} onClose={() => open(null)} onChanged={load} />}
      </div>
    </>
  )
}

function JournalDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { boot, can } = useSession()
  const nav = useNavigate()
  const [j, setJ] = useState<Detail | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [ask, setAsk] = useState<'void' | 'reject' | null>(null)
  const [alasan, setAlasan] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setErr('')
    call<Detail>('journal.get', { id }).then(setJ).catch((e) => setErr(errorText(e)))
  }, [id])
  useEffect(() => { setJ(null); setMsg(''); load() }, [load])

  const act = async (action: string, payload: Record<string, unknown>, ok: string) => {
    setBusy(true)
    setErr('')
    try {
      const r = await call<{ pembalik?: string }>(action, { id, ...payload })
      setMsg(ok + (r?.pembalik ? ` Jurnal pembalik: ${r.pembalik}.` : ''))
      setAsk(null)
      setAlasan('')
      load()
      onChanged()
    } catch (e) {
      setErr(errorText(e))
    }
    setBusy(false)
  }

  if (!j) return <div className="card panel">{err ? <Banner kind="err">{err}</Banner> : <Spinner />}</div>
  const mine = j.dibuat_oleh === boot?.user.username
  const td = j.lines.reduce((s, l) => s + l.debit, 0)
  const tk = j.lines.reduce((s, l) => s + l.kredit, 0)

  return (
    <div className="card panel stack">
      <div className="panel-head">
        <div>
          <h3>{j.no || 'Draft jurnal'}</h3>
          <span className="muted small">{tglID(j.tgl)} · {boot?.journalTypes?.[j.jenis] ?? j.jenis}</span>
        </div>
        <button className="x" onClick={onClose} aria-label="Tutup">×</button>
      </div>
      <div><b>{j.keterangan}</b>{j.referensi && <div className="muted small">Ref: {j.referensi}</div>}</div>
      <table className="tbl compact">
        <thead><tr><th>Akun</th><th className="r">Debit</th><th className="r">Kredit</th></tr></thead>
        <tbody>
          {j.lines.map((l) => (
            <tr key={l.baris}>
              <td className={l.kredit ? 'indent' : ''}>
                <Link to={`/jurnal?tab=buku-besar&akun=${encodeURIComponent(l.akun_id)}`} className="plain"><span className="mono">{l.akun_id}</span> {l.akun_nama}</Link>
                {l.memo && <div className="muted small">{l.memo}</div>}
              </td>
              <td className="r">{rp(l.debit, true)}</td>
              <td className="r">{rp(l.kredit, true)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td>Total</td><td className="r tot">{rp(td)}</td><td className="r tot">{rp(tk)}</td></tr></tfoot>
      </table>
      <div className="meta small muted">
        <div>Dibuat: {j.dibuat_oleh} · {fmtTime(j.dibuat_pada)}</div>
        {j.diposting_oleh && <div>Diposting: {j.diposting_oleh} · {fmtTime(j.diposting_pada)}</div>}
        {j.balik_otomatis && <div>Dengan jurnal pembalik otomatis</div>}
        {j.jurnal_asal && <div>Membalik jurnal: <Link to={`/jurnal?open=${j.jurnal_asal}`}>lihat asal</Link></div>}
        {j.status === 'batal' && <div className="err-text">Dibatalkan {j.dibatalkan_oleh}: {j.alasan_batal}</div>}
        {j.status === 'draft' && j.alasan_batal && <div className="err-text">{j.alasan_batal}</div>}
      </div>
      {msg && <Banner kind="ok">{msg}</Banner>}
      <Banner kind="err">{err}</Banner>

      <div className="row">
        {j.status === 'draft' && can('jurnal.edit') && <button className="btn primary" onClick={() => nav(`/jurnal/${j.id}`)}>Edit / posting</button>}
        {j.status === 'menunggu' && can('jurnal.approve') && !mine && (
          <>
            <button className="btn primary" disabled={busy} onClick={() => act('journal.approve', {}, 'Jurnal disetujui dan diposting.')}>Setujui</button>
            <button className="btn" onClick={() => { setErr(''); setAsk('reject') }}>Tolak</button>
          </>
        )}
        {j.status === 'menunggu' && mine && <span className="hint">ⓘ Menunggu disetujui pengguna lain.</span>}
        {(j.status === 'draft' || j.status === 'menunggu' || (j.status === 'posted' && j.jenis !== 'JT')) && can('jurnal.edit') && (
          <button className="btn warn" onClick={() => { setErr(''); setAsk('void') }}>{j.status === 'posted' ? 'Batalkan' : 'Buang draft'}</button>
        )}
      </div>
      {ask && (
        <Modal
          size="sm"
          title={ask === 'void' ? (j.status === 'posted' ? `Batalkan ${j.no}?` : 'Buang draft ini?') : `Tolak jurnal ini?`}
          onClose={() => { setAsk(null); setAlasan('') }}
          dirty={!!alasan.trim()}
          footer={
            <>
              <button className="btn" onClick={() => { setAsk(null); setAlasan('') }}>Kembali</button>
              <button className="btn danger" disabled={busy || !alasan.trim()} onClick={() => ask === 'void'
                ? act('journal.void', { alasan }, j.status === 'posted' ? 'Jurnal dibatalkan.' : 'Draft dibuang.')
                : act('journal.reject', { alasan }, 'Jurnal dikembalikan ke draft.')}>
                {busy ? 'Memproses…' : ask === 'void' ? (j.status === 'posted' ? 'Batalkan jurnal' : 'Buang draft') : 'Tolak'}
              </button>
            </>
          }
        >
          <label className="field"><span>{ask === 'void' ? 'Alasan pembatalan' : 'Alasan penolakan'}<Req /></span>
            <input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="tercatat di audit log" />
          </label>
          {ask === 'void' && j.status === 'posted' && <p className="hint">ⓘ Jurnal tidak dihapus: sistem membuat jurnal pembalik (JR) dengan tanggal yang sama sehingga saldo kembali, dan jejaknya tetap terlihat.</p>}
          <Banner kind="err">{err}</Banner>
        </Modal>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- buku besar

type LedgerData = {
  akun: { kode: string; nama: string; saldo_normal: string }
  saldo_awal: number; total_debit: number; total_kredit: number; saldo_akhir: number
  rows: { tgl: string; no: string; jurnal_id: string; jenis: string; keterangan: string; debit: number; kredit: number; saldo: number }[]
}

function LedgerTab({ initial }: { initial: string }) {
  const [akun, setAkun] = useState(initial)
  const [from, setFrom] = useState(monthStart().slice(0, 5) + '01-01')
  const [to, setTo] = useState(today())
  const [d, setD] = useState<LedgerData | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!akun) return
    setLoading(true)
    setErr('')
    call<LedgerData>('ledger.account', { akun_id: akun, from, to })
      .then(setD).catch((e) => setErr(errorText(e))).finally(() => setLoading(false))
  }, [akun, from, to])

  return (
    <>
      <div className="filters">
        <div className="grow"><AccountPicker value={akun} onChange={setAkun} placeholder="Pilih akun…" includeInactive /></div>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <Banner kind="err">{err}</Banner>
      {!akun && <div className="card empty"><p className="hint">ⓘ Pilih akun untuk melihat mutasi dan saldonya.</p></div>}
      {akun && (loading || !d ? <Spinner /> : (
        <div className="card flush">
          <div className="report-head">
            <b>Buku Besar · {d.akun.kode} {d.akun.nama}</b>
            <span className="muted small">{tglID(from)} – {tglID(to)} · saldo normal {d.akun.saldo_normal === 'D' ? 'debit' : 'kredit'}</span>
          </div>
          <table className="tbl">
            <thead><tr><th>Tanggal</th><th>Nomor</th><th>Keterangan</th><th className="r">Debit</th><th className="r">Kredit</th><th className="r">Saldo</th></tr></thead>
            <tbody>
              <tr className="sub"><td colSpan={5}>Saldo awal</td><td className="r">{rp(d.saldo_awal)}</td></tr>
              {d.rows.length === 0 && <tr><td colSpan={6} className="muted">Tidak ada mutasi pada periode ini.</td></tr>}
              {d.rows.map((r, i) => (
                <tr key={i}>
                  <td className="nowrap">{tglID(r.tgl)}</td>
                  <td className="nowrap"><Link to={`/jurnal?open=${r.jurnal_id}`} className="mono">{r.no}</Link></td>
                  <td>{r.keterangan}</td>
                  <td className="r">{rp(r.debit, true)}</td>
                  <td className="r">{rp(r.kredit, true)}</td>
                  <td className="r">{rp(r.saldo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="tot-row"><td colSpan={3}>Saldo akhir</td><td className="r">{rp(d.total_debit)}</td><td className="r">{rp(d.total_kredit)}</td><td className="r">{rp(d.saldo_akhir)}</td></tr></tfoot>
          </table>
        </div>
      ))}
    </>
  )
}

// ---------------------------------------------------------------- neraca saldo

type Trial = { rows: { kode: string; nama: string; tipe: string; debit: number; kredit: number }[]; total_debit: number; total_kredit: number; seimbang: boolean }

function TrialTab({ onOpen }: { onOpen: (kode: string) => void }) {
  const { boot } = useSession()
  const [to, setTo] = useState(today())
  const [zero, setZero] = useState(false)
  const [d, setD] = useState<Trial | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setD(null)
    call<Trial>('ledger.trial', { to, includeZero: zero }).then(setD).catch((e) => setErr(errorText(e)))
  }, [to, zero])

  return (
    <>
      <div className="filters">
        <label className="inline">Per tanggal <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} /> Tampilkan akun bersaldo nol</label>
      </div>
      <Banner kind="err">{err}</Banner>
      {!d ? <Spinner /> : (
        <div className="card flush">
          <div className="report-head">
            <b>{boot?.company.nama} · Neraca Saldo</b>
            <span className="muted small">Per {tglID(to)} · dalam Rupiah</span>
            <span className={`pill ${d.seimbang ? 'g' : 'r'}`}>{d.seimbang ? 'Seimbang ✓' : 'Tidak seimbang!'}</span>
          </div>
          <table className="tbl">
            <thead><tr><th>Kode</th><th>Akun</th><th className="r">Debit</th><th className="r">Kredit</th></tr></thead>
            <tbody>
              {d.rows.length === 0 && <tr><td colSpan={4} className="hint">ⓘ Belum ada saldo. Posting jurnal saldo awal dulu.</td></tr>}
              {d.rows.map((r) => (
                <tr key={r.kode} className="click" onClick={() => onOpen(r.kode)}>
                  <td className="mono">{r.kode}</td><td>{r.nama}</td>
                  <td className="r">{rp(r.debit, true)}</td><td className="r">{rp(r.kredit, true)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="tot-row"><td colSpan={2}>Jumlah</td><td className="r">{rp(d.total_debit)}</td><td className="r">{rp(d.total_kredit)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- chart of accounts

const TIPE = ['aset', 'liabilitas', 'ekuitas', 'pendapatan', 'hpp', 'beban', 'lain', 'pajak']
const TIPE_LABEL: Record<string, string> = { aset: 'Aset', liabilitas: 'Liabilitas', ekuitas: 'Ekuitas', pendapatan: 'Pendapatan', hpp: 'Beban pokok', beban: 'Beban usaha', lain: 'Lain-lain', pajak: 'Pajak penghasilan' }

function CoaTab() {
  const accounts = useAccounts()
  const { can } = useSession()
  const [edit, setEdit] = useState<Partial<Account> & { isNew?: boolean } | null>(null)
  const [flash, setFlash] = useState('')
  const [q, setQ] = useState('')

  const depth = useMemo(() => {
    const by: Record<string, Account> = Object.fromEntries(accounts.map((a) => [a.kode, a]))
    const dep = (a: Account, n = 0): number => (a.parent && by[a.parent] && n < 6 ? dep(by[a.parent], n + 1) : n)
    return Object.fromEntries(accounts.map((a) => [a.kode, dep(a)]))
  }, [accounts])
  const shown = accounts.filter((a) => !q || (a.kode + ' ' + a.nama).toLowerCase().includes(q.toLowerCase()))
  const editable = can('jurnal.edit')

  return (
    <>
      {flash && <Banner kind="ok">{flash}</Banner>}
      <div className="card flush">
        <div className="filters pad">
          <input className="grow" placeholder="Cari akun…" value={q} onChange={(e) => setQ(e.target.value)} />
          {editable && <button className="btn" onClick={() => { setFlash(''); setEdit({ isNew: true, tipe: 'beban', saldo_normal: 'D', is_header: false, aktif: true, parent: '' }) }}>+ Akun</button>}
        </div>
        <table className="tbl coa">
          <thead><tr><th>Kode</th><th>Nama akun</th><th>Tipe</th><th>Normal</th><th></th></tr></thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.kode} className={`${editable ? 'click' : ''} ${a.is_header ? 'hdr' : ''} ${!a.aktif ? 'off' : ''} ${edit?.kode === a.kode && !edit?.isNew ? 'sel' : ''}`} onClick={() => editable && setEdit({ ...a })}>
                <td className="mono">{a.kode}</td>
                <td style={{ paddingLeft: 14 + (depth[a.kode] ?? 0) * 16 }}>{a.nama}</td>
                <td className="muted">{TIPE_LABEL[a.tipe] ?? a.tipe}</td>
                <td>{a.saldo_normal}</td>
                <td>{!a.aktif && <span className="pill n">Nonaktif</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <CoaForm key={edit.isNew ? 'new' : edit.kode} acc={edit} headers={accounts.filter((a) => a.is_header)} onClose={() => setEdit(null)} onSaved={(t) => { setFlash(t); setEdit(null) }} />}
    </>
  )
}

function CoaForm({ acc, headers, onClose, onSaved }: { acc: Partial<Account> & { isNew?: boolean }; headers: Account[]; onClose: () => void; onSaved: (text: string) => void }) {
  const { reload } = useSession()
  const [f, setF] = useState({ ...acc })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(f) !== JSON.stringify(acc)

  const save = async () => {
    setErr('')
    if (!f.kode?.trim() || !f.nama?.trim()) { setErr('Kode dan nama akun wajib diisi.'); return }
    setBusy(true)
    try {
      await call('coa.save', f)
      await reload()
      onSaved(acc.isNew ? `Akun ${f.kode} · ${f.nama} ditambahkan.` : `Akun ${f.kode} disimpan.`)
    } catch (e) {
      setErr(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      size="sm"
      title={acc.isNew ? 'Akun baru' : `Edit akun ${acc.kode}`}
      onClose={onClose}
      dirty={dirty && !busy}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></>}
    >
      <div className="stack">
        <label className="field"><span>Kode<Req /></span><input value={f.kode ?? ''} onChange={(e) => setF({ ...f, kode: e.target.value })} disabled={!f.isNew} placeholder="mis. 6-1902" /></label>
        <label className="field"><span>Nama akun<Req /></span><input value={f.nama ?? ''} onChange={(e) => setF({ ...f, nama: e.target.value })} /></label>
        <label className="field"><span>Induk (header)</span>
          <select value={f.parent ?? ''} onChange={(e) => {
            const p = headers.find((h) => h.kode === e.target.value)
            setF({ ...f, parent: e.target.value, ...(p && f.isNew ? { tipe: p.tipe, saldo_normal: p.saldo_normal } : {}) })
          }}>
            <option value="">— tanpa induk —</option>
            {headers.map((h) => <option key={h.kode} value={h.kode}>{h.kode} · {h.nama}</option>)}
          </select>
        </label>
        <div className="grid2">
          <label className="field"><span>Tipe<Req /></span>
            <select value={f.tipe} onChange={(e) => setF({ ...f, tipe: e.target.value })}>{TIPE.map((t) => <option key={t} value={t}>{TIPE_LABEL[t]}</option>)}</select>
          </label>
          <label className="field"><span>Saldo normal<Req /></span>
            <select value={f.saldo_normal} onChange={(e) => setF({ ...f, saldo_normal: e.target.value })}><option value="D">Debit</option><option value="K">Kredit</option></select>
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={!!f.is_header} onChange={(e) => setF({ ...f, is_header: e.target.checked })} /> Akun header (pengelompok, tidak bisa dipakai di jurnal)</label>
        {!f.isNew && <label className="check"><input type="checkbox" checked={f.aktif !== false} onChange={(e) => setF({ ...f, aktif: e.target.checked })} /> Aktif</label>}
        <p className="hint">ⓘ Akun yang sudah dipakai jurnal tidak bisa dihapus atau diubah saldo normalnya; nonaktifkan bila saldonya sudah nol.</p>
        <Banner kind="err">{err}</Banner>
      </div>
    </Modal>
  )
}
