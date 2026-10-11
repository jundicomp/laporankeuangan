import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { batch, call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { AccountPicker, useAccounts } from '../components/AccountPicker'
import { Banner, Modal, PageHead, Req, Spinner, fmtTime } from '../components/ui'
import { parseNum, rp, tglID, today } from '../lib/format'

type KB = { id: string; nama: string; jenis: string; no_rek: string; akun_id: string; aktif: boolean; saldo: number }
type CashRow = {
  id: string; no: string; tgl: string; jenis: 'masuk' | 'keluar' | 'transfer'; kasbank_id: string; kasbank_tujuan: string; metode: string
  kontak_nama: string; keterangan: string; referensi: string; jumlah: number; status: string; jurnal_id: string; alasan_batal: string
  lines: { akun_id: string; memo: string; jumlah: number }[]; dibuat_oleh: string; dibuat_pada: string
}
type Contact = { id: string; nama: string; kode: string; aktif: boolean }

const JENIS_LABEL = { masuk: 'Pemasukan', keluar: 'Pengeluaran', transfer: 'Transfer' }
const JENIS_KB: Record<string, string> = { kas: 'Kas', bank: 'Bank', kas_kecil: 'Kas kecil' }
const METODE = [['tunai', 'Tunai'], ['transfer', 'Transfer bank'], ['qris', 'QRIS'], ['kartu', 'Kartu debit/kredit'], ['cek/giro', 'Cek / giro'], ['lainnya', 'Lainnya']]

export function CashBankPage() {
  const { can } = useSession()
  const [kbs, setKbs] = useState<KB[] | null>(null)
  const [rows, setRows] = useState<CashRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState({ kasbank_id: '', jenis: '', from: '', to: '', q: '' })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [form, setForm] = useState<'masuk' | 'keluar' | 'transfer' | null>(null)
  const [kbForm, setKbForm] = useState<KB | 'new' | null>(null)
  const [detail, setDetail] = useState<CashRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const [a, b] = await batch([{ action: 'kasbank.list' }, { action: 'cash.list', payload: { ...filter, limit: 50, offset } }])
      if (a.ok) setKbs(a.data as KB[]); else setErr(a.error.message)
      if (b.ok) { const d = b.data as { total: number; rows: CashRow[] }; setRows(d.rows); setTotal(d.total) } else setErr(b.error.message)
    } catch (e) {
      setErr(errorText(e))
    }
    setLoading(false)
  }, [filter, offset])
  useEffect(() => { load() }, [load])

  const kbName = (id: string) => kbs?.find((k) => k.id === id)?.nama ?? '—'
  const active = (kbs ?? []).filter((k) => k.aktif)
  const done = (t: string) => { setForm(null); setKbForm(null); setDetail(null); setFlash(t); load() }

  return (
    <>
      <PageHead title="Kas & Bank" sub="Catat uang masuk, uang keluar, dan pindah dana antar rekening. Setiap transaksi otomatis menjadi jurnal.">
        {can('kas.edit') && (
          <>
            <button className="btn" onClick={() => { setFlash(''); setForm('transfer') }} disabled={active.length < 2}>⇄ Transfer</button>
            <button className="btn" onClick={() => { setFlash(''); setForm('keluar') }}>− Pengeluaran</button>
            <button className="btn primary" onClick={() => { setFlash(''); setForm('masuk') }}>+ Pemasukan</button>
          </>
        )}
      </PageHead>
      {flash && <Banner kind="ok">{flash}</Banner>}
      <Banner kind="err">{err}</Banner>

      <div className="kb-grid">
        {!kbs && <Spinner />}
        {active.map((k) => (
          <button key={k.id} className={`card kb ${filter.kasbank_id === k.id ? 'on' : ''}`} onClick={() => { setOffset(0); setFilter({ ...filter, kasbank_id: filter.kasbank_id === k.id ? '' : k.id }) }}>
            <span className="kb-type">{JENIS_KB[k.jenis] ?? k.jenis}{k.no_rek && ` · ${k.no_rek}`}</span>
            <b>{k.nama}</b>
            <span className={`kb-saldo ${k.saldo < 0 ? 'neg' : ''}`}>Rp {rp(k.saldo)}</span>
          </button>
        ))}
        {kbs && can('kas.edit') && <button className="card kb add" onClick={() => setKbForm('new')}>+ Rekening</button>}
      </div>
      {filter.kasbank_id && (
        <p className="hint">ⓘ Menampilkan transaksi {kbName(filter.kasbank_id)}. <Link to={`/jurnal?tab=buku-besar&akun=${encodeURIComponent(kbs?.find((k) => k.id === filter.kasbank_id)?.akun_id ?? '')}`}>Lihat mutasi & saldo berjalan</Link>
          {can('kas.edit') && <> · <button className="link" onClick={() => setKbForm(kbs!.find((k) => k.id === filter.kasbank_id)!)}>Ubah rekening</button></>}</p>
      )}

      <div className="filters">
        <select value={filter.jenis} onChange={(e) => { setOffset(0); setFilter({ ...filter, jenis: e.target.value }) }}>
          <option value="">Semua jenis</option><option value="masuk">Pemasukan</option><option value="keluar">Pengeluaran</option><option value="transfer">Transfer</option>
        </select>
        <input type="date" value={filter.from} onChange={(e) => { setOffset(0); setFilter({ ...filter, from: e.target.value }) }} title="Dari tanggal" />
        <input type="date" value={filter.to} onChange={(e) => { setOffset(0); setFilter({ ...filter, to: e.target.value }) }} title="Sampai tanggal" />
        <input className="grow" placeholder="Cari nomor, keterangan, kontak…" value={filter.q} onChange={(e) => { setOffset(0); setFilter({ ...filter, q: e.target.value }) }} />
      </div>

      <div className="card flush">
        {loading ? <div className="pad"><Spinner /></div> : (
          <table className="tbl">
            <thead><tr><th>Tanggal</th><th>Nomor</th><th>Keterangan</th><th>Rekening</th><th className="r">Masuk</th><th className="r">Keluar</th><th>Status</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="hint">ⓘ Belum ada transaksi kas & bank pada filter ini.</td></tr>}
              {rows.map((r) => {
                const inflow = r.jenis === 'masuk' || (r.jenis === 'transfer' && filter.kasbank_id === r.kasbank_tujuan)
                return (
                  <tr key={r.id} className={`click ${r.status === 'batal' ? 'off' : ''}`} onClick={() => setDetail(r)}>
                    <td className="nowrap">{tglID(r.tgl)}</td>
                    <td className="nowrap mono">{r.no}</td>
                    <td>{r.keterangan}{r.kontak_nama && <span className="muted"> · {r.kontak_nama}</span>}</td>
                    <td className="nowrap">{r.jenis === 'transfer' ? `${kbName(r.kasbank_id)} → ${kbName(r.kasbank_tujuan)}` : kbName(r.kasbank_id)}</td>
                    <td className="r in">{r.jenis === 'transfer' && !filter.kasbank_id ? rp(r.jumlah) : inflow ? rp(r.jumlah) : ''}</td>
                    <td className="r out">{r.jenis === 'transfer' && !filter.kasbank_id ? rp(r.jumlah) : !inflow ? rp(r.jumlah) : ''}</td>
                    <td>{r.status === 'batal' ? <span className="pill r">Dibatalkan</span> : <span className={`pill ${r.jenis === 'masuk' ? 'g' : r.jenis === 'keluar' ? 'o' : 'b'}`}>{JENIS_LABEL[r.jenis]}</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <div className="pager">
          <span className="muted small">{total ? `${offset + 1}–${Math.min(offset + 50, total)} dari ${total}` : ''}</span>
          <button className="btn" disabled={offset === 0} onClick={() => setOffset(offset - 50)}>‹</button>
          <button className="btn" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)}>›</button>
        </div>
      </div>

      {form && kbs && <CashForm jenis={form} kbs={active} preset={filter.kasbank_id} onClose={() => setForm(null)} onSaved={done} />}
      {kbForm && kbs && <KbForm kb={kbForm === 'new' ? null : kbForm} kbs={kbs} onClose={() => setKbForm(null)} onSaved={done} />}
      {detail && <CashDetail row={detail} kbName={kbName} onClose={() => setDetail(null)} onVoided={done} />}
    </>
  )
}

// ---------------------------------------------------------------- form transaksi

type Line = { akun_id: string; memo: string; jumlah: string }
const blank = (): Line => ({ akun_id: '', memo: '', jumlah: '' })

function CashForm({ jenis, kbs, preset, onClose, onSaved }: { jenis: 'masuk' | 'keluar' | 'transfer'; kbs: KB[]; preset: string; onClose: () => void; onSaved: (t: string) => void }) {
  const accounts = useAccounts()
  const cashAccs = useMemo(() => kbs.map((k) => k.akun_id), [kbs])
  const [tgl, setTgl] = useState(today())
  const [src, setSrc] = useState(preset || (jenis === 'masuk' ? kbs.find((k) => k.jenis === 'bank')?.id : kbs.find((k) => k.jenis === 'kas')?.id) || kbs[0]?.id || '')
  const [dst, setDst] = useState('')
  const [metode, setMetode] = useState(jenis === 'transfer' ? 'transfer' : 'tunai')
  const [kontakTipe, setKontakTipe] = useState(jenis === 'masuk' ? 'pelanggan' : jenis === 'keluar' ? 'supplier' : '')
  const [kontak, setKontak] = useState({ id: '', nama: '' })
  const [contacts, setContacts] = useState<{ pelanggan: Contact[]; supplier: Contact[] }>({ pelanggan: [], supplier: [] })
  const [ket, setKet] = useState('')
  const [ref, setRef] = useState('')
  const [jumlah, setJumlah] = useState('')
  const [lines, setLines] = useState<Line[]>([blank()])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (jenis === 'transfer') return
    batch([{ action: 'master.list', payload: { entity: 'pelanggan', aktif: true } }, { action: 'master.list', payload: { entity: 'supplier', aktif: true } }])
      .then(([a, b]) => setContacts({ pelanggan: a.ok ? a.data as Contact[] : [], supplier: b.ok ? b.data as Contact[] : [] }))
      .catch(() => { /* kontak opsional */ })
  }, [jenis])

  const sum = lines.reduce((s, l) => s + (parseNum(l.jumlah) || 0), 0)
  const total = jenis === 'transfer' ? parseNum(jumlah) || 0 : Math.round(sum * 100) / 100
  const srcKb = kbs.find((k) => k.id === src)
  const dirty = !busy && (!!ket || !!ref || !!jumlah || lines.some((l) => l.akun_id || l.jumlah || l.memo) || !!kontak.nama)

  const blocker = !src ? 'Pilih rekening.'
    : jenis === 'transfer' && !dst ? 'Pilih rekening tujuan.'
    : jenis === 'transfer' && dst === src ? 'Rekening asal dan tujuan tidak boleh sama.'
    : !ket.trim() ? 'Isi kolom Keterangan dulu.'
    : jenis !== 'transfer' && lines.some((l) => (l.akun_id || l.jumlah) && (!l.akun_id || !(parseNum(l.jumlah) > 0))) ? 'Setiap baris rincian butuh akun dan jumlah lebih dari nol.'
    : !(total > 0) ? 'Jumlah masih kosong.'
    : srcKb && srcKb.jenis !== 'bank' && jenis !== 'masuk' && total > srcKb.saldo ? `Saldo ${srcKb.nama} tidak cukup (Rp ${rp(srcKb.saldo)}).`
    : ''

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => {
    const next = ls.map((l, j) => (j === i ? { ...l, ...patch } : l))
    if (i === next.length - 1 && (patch.akun_id || patch.jumlah)) next.push(blank())
    return next
  })

  const save = async () => {
    setErr('')
    if (blocker) return setErr(blocker)
    setBusy(true)
    try {
      const r = await call<{ no: string; jumlah: number }>('cash.save', {
        jenis, tgl, kasbank_id: src, kasbank_tujuan: dst, metode, keterangan: ket, referensi: ref,
        kontak_tipe: kontak.nama ? kontakTipe : '', kontak_id: kontak.id, kontak_nama: kontak.nama, jumlah: total,
        lines: lines.filter((l) => l.akun_id || l.jumlah).map((l) => ({ akun_id: l.akun_id, memo: l.memo, jumlah: parseNum(l.jumlah) })),
      })
      onSaved(`${JENIS_LABEL[jenis]} ${r.no} sebesar Rp ${rp(r.jumlah)} tersimpan dan sudah dijurnal.`)
    } catch (e) {
      setErr(errorText(e))
      setBusy(false)
    }
  }

  const contactList = kontakTipe === 'pelanggan' ? contacts.pelanggan : kontakTipe === 'supplier' ? contacts.supplier : []
  const title = { masuk: 'Pemasukan (uang masuk)', keluar: 'Pengeluaran (uang keluar)', transfer: 'Transfer antar rekening' }[jenis]
  const accName = (k: string) => accounts.find((a) => a.kode === k)?.nama ?? ''

  return (
    <Modal size="lg" title={title} onClose={onClose} dirty={dirty}
      sub={jenis === 'masuk' ? 'Debit rekening, kredit akun pendapatan/lawan.' : jenis === 'keluar' ? 'Debit akun beban/lawan, kredit rekening.' : 'Debit rekening tujuan, kredit rekening asal.'}
      footer={<>
        {blocker ? <span className="warn-text">⚠ {blocker}</span> : <span className="ok-text">✓ Total Rp {rp(total)}</span>}
        <button className="btn" onClick={onClose}>Batal</button>
        <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
      </>}>
      <div className="form-grid">
        <label className="field"><span>Tanggal<Req /></span><input type="date" value={tgl} onChange={(e) => setTgl(e.target.value)} /></label>
        <label className="field"><span>{jenis === 'masuk' ? 'Masuk ke rekening' : jenis === 'keluar' ? 'Keluar dari rekening' : 'Dari rekening'}<Req /></span>
          <select value={src} onChange={(e) => setSrc(e.target.value)}>
            {kbs.map((k) => <option key={k.id} value={k.id}>{k.nama} — saldo Rp {rp(k.saldo)}</option>)}
          </select>
        </label>
        {jenis === 'transfer' ? (
          <>
            <label className="field"><span>Ke rekening<Req /></span>
              <select value={dst} onChange={(e) => setDst(e.target.value)}>
                <option value="">— pilih —</option>
                {kbs.filter((k) => k.id !== src).map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}
              </select>
            </label>
            <label className="field"><span>Jumlah (Rp)<Req /></span>
              <input className="num" inputMode="decimal" value={jumlah} onChange={(e) => setJumlah(e.target.value)} onBlur={(e) => { const n = parseNum(e.target.value); if (n) setJumlah(rp(n)) }} />
            </label>
          </>
        ) : (
          <>
            <label className="field"><span>Metode</span>
              <select value={metode} onChange={(e) => setMetode(e.target.value)}>{METODE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <label className="field span2"><span>{jenis === 'masuk' ? 'Diterima dari' : 'Dibayar ke'}</span>
              <div className="pair">
                <select value={kontakTipe} onChange={(e) => { setKontakTipe(e.target.value); setKontak({ id: '', nama: '' }) }}>
                  <option value="pelanggan">Pelanggan</option><option value="supplier">Supplier</option><option value="lainnya">Lainnya</option>
                </select>
                <input list={`kontak-${kontakTipe}`} value={kontak.nama} placeholder="ketik nama (opsional)"
                  onChange={(e) => { const c = contactList.find((x) => x.nama === e.target.value); setKontak({ id: c?.id ?? '', nama: e.target.value }) }} />
                <datalist id={`kontak-${kontakTipe}`}>{contactList.map((c) => <option key={c.id} value={c.nama}>{c.kode}</option>)}</datalist>
              </div>
            </label>
          </>
        )}
        <label className="field span2"><span>Keterangan<Req /></span><input value={ket} onChange={(e) => setKet(e.target.value)} placeholder={jenis === 'masuk' ? 'mis. Pelunasan jasa desain' : jenis === 'keluar' ? 'mis. Bayar listrik Oktober' : 'mis. Setor kas toko ke bank'} /></label>
        <label className="field"><span>Referensi</span><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="no. nota / bukti transfer" /></label>
      </div>

      {jenis !== 'transfer' && (
        <div className="jf-box">
          <table className="tbl jf-lines">
            <thead><tr><th className="n">#</th><th>{jenis === 'masuk' ? 'Akun pendapatan / lawan' : 'Akun beban / lawan'}<Req /></th><th>Memo</th><th className="r">Jumlah (Rp)<Req /></th><th className="n"></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="n">{i + 1}</td>
                  <td className="acc"><AccountPicker value={l.akun_id} onChange={(k) => setLine(i, { akun_id: k, memo: l.memo || '' })} exclude={cashAccs}
                    placeholder={jenis === 'masuk' ? 'mis. 4-1201 Pendapatan jasa' : 'mis. 6-1501 Listrik'} /></td>
                  <td><input value={l.memo} onChange={(e) => setLine(i, { memo: e.target.value })} placeholder={accName(l.akun_id) ? 'opsional' : ''} /></td>
                  <td className="num"><input inputMode="decimal" value={l.jumlah} onChange={(e) => setLine(i, { jumlah: e.target.value })}
                    onBlur={(e) => { const n = parseNum(e.target.value); if (n) setLine(i, { jumlah: rp(n) }) }} /></td>
                  <td className="n">{lines.length > 1 && <button className="x" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>×</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td></td><td colSpan={2}>Total</td><td className="r tot">{rp(total)}</td><td></td></tr></tfoot>
          </table>
        </div>
      )}
      <p className="hint">ⓘ {jenis === 'transfer' ? 'Transfer tidak memengaruhi laba rugi — hanya memindahkan saldo.' : 'Satu transaksi boleh beberapa baris, mis. belanja ATK + bensin dalam satu nota.'}</p>
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
}

// ---------------------------------------------------------------- detail & batal

function CashDetail({ row, kbName, onClose, onVoided }: { row: CashRow; kbName: (id: string) => string; onClose: () => void; onVoided: (t: string) => void }) {
  const { can } = useSession()
  const accounts = useAccounts()
  const [ask, setAsk] = useState(false)
  const [alasan, setAlasan] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const accName = (k: string) => accounts.find((a) => a.kode === k)?.nama ?? k

  const voidIt = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await call<{ pembalik: string }>('cash.void', { id: row.id, alasan })
      onVoided(`${row.no} dibatalkan. Jurnal pembalik: ${r.pembalik}.`)
    } catch (e) {
      setErr(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal size={ask ? 'sm' : 'md'} title={ask ? `Batalkan ${row.no}?` : `${JENIS_LABEL[row.jenis]} · ${row.no}`} onClose={onClose} dirty={ask && !!alasan.trim() && !busy}
      footer={ask
        ? <><button className="btn" onClick={() => setAsk(false)}>Kembali</button><button className="btn danger" disabled={busy || !alasan.trim()} onClick={voidIt}>{busy ? 'Memproses…' : 'Batalkan transaksi'}</button></>
        : <>
          <Link className="btn" to={`/jurnal?open=${row.jurnal_id}`}>Lihat jurnal</Link>
          {row.status !== 'batal' && can('kas.edit') && <button className="btn warn" onClick={() => setAsk(true)}>Batalkan</button>}
          <button className="btn primary" onClick={onClose}>Tutup</button>
        </>}>
      {ask ? (
        <>
          <label className="field"><span>Alasan pembatalan<Req /></span><input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="tercatat di audit log" /></label>
          <p className="hint">ⓘ Transaksi tidak dihapus: sistem membuat jurnal pembalik bertanggal sama sehingga saldo rekening kembali.</p>
        </>
      ) : (
        <>
          <table className="tbl kv">
            <tbody>
              <tr><td>Tanggal</td><td>{tglID(row.tgl)}</td></tr>
              <tr><td>Rekening</td><td>{row.jenis === 'transfer' ? `${kbName(row.kasbank_id)} → ${kbName(row.kasbank_tujuan)}` : kbName(row.kasbank_id)}</td></tr>
              {row.kontak_nama && <tr><td>{row.jenis === 'masuk' ? 'Diterima dari' : 'Dibayar ke'}</td><td>{row.kontak_nama}</td></tr>}
              <tr><td>Metode</td><td>{METODE.find((m) => m[0] === row.metode)?.[1] ?? row.metode}</td></tr>
              <tr><td>Keterangan</td><td>{row.keterangan}</td></tr>
              {row.referensi && <tr><td>Referensi</td><td>{row.referensi}</td></tr>}
              <tr><td>Jumlah</td><td><b>Rp {rp(row.jumlah)}</b></td></tr>
              <tr><td>Dicatat</td><td>{row.dibuat_oleh} · {fmtTime(row.dibuat_pada)}</td></tr>
            </tbody>
          </table>
          {row.lines.length > 0 && (
            <table className="tbl compact">
              <thead><tr><th>Akun</th><th>Memo</th><th className="r">Jumlah</th></tr></thead>
              <tbody>{row.lines.map((l, i) => <tr key={i}><td><span className="mono">{l.akun_id}</span> {accName(l.akun_id)}</td><td>{l.memo}</td><td className="r">{rp(l.jumlah)}</td></tr>)}</tbody>
            </table>
          )}
          {row.status === 'batal' && <p className="err-text">Dibatalkan: {row.alasan_batal}</p>}
        </>
      )}
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
}

// ---------------------------------------------------------------- rekening

function KbForm({ kb, kbs, onClose, onSaved }: { kb: KB | null; kbs: KB[]; onClose: () => void; onSaved: (t: string) => void }) {
  const used = kbs.filter((k) => k.id !== kb?.id).map((k) => k.akun_id)
  const start = { nama: kb?.nama ?? '', jenis: kb?.jenis ?? 'bank', no_rek: kb?.no_rek ?? '', akun_id: kb?.akun_id ?? '', aktif: kb ? kb.aktif : true }
  const [f, setF] = useState(start)
  const [mode, setMode] = useState<'baru' | 'pilih'>(kb ? 'pilih' : 'baru')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setErr('')
    if (!f.nama.trim()) return setErr('Nama rekening wajib diisi.')
    if (mode === 'pilih' && !f.akun_id) return setErr('Pilih akun COA untuk rekening ini.')
    setBusy(true)
    try {
      await call('kasbank.save', { ...f, id: kb?.id, buatAkun: !kb && mode === 'baru' })
      onSaved(`Rekening ${f.nama} ${kb ? 'disimpan' : 'ditambahkan'}.`)
    } catch (e) {
      setErr(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal size="sm" title={kb ? `Ubah rekening · ${kb.nama}` : 'Rekening kas / bank baru'} onClose={onClose} dirty={!busy && JSON.stringify(f) !== JSON.stringify(start)}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></>}>
      <div className="stack">
        <label className="field"><span>Nama rekening<Req /></span><input value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} placeholder="mis. BCA operasional" /></label>
        <div className="grid2">
          <label className="field"><span>Jenis<Req /></span>
            <select value={f.jenis} onChange={(e) => setF({ ...f, jenis: e.target.value })}><option value="bank">Bank</option><option value="kas">Kas</option><option value="kas_kecil">Kas kecil</option></select>
          </label>
          <label className="field"><span>No. rekening</span><input value={f.no_rek} onChange={(e) => setF({ ...f, no_rek: e.target.value })} /></label>
        </div>
        {!kb && (
          <div className="seg">
            <label className="check"><input type="radio" checked={mode === 'baru'} onChange={() => setMode('baru')} /> Buatkan akun COA baru otomatis (1-11xx)</label>
            <label className="check"><input type="radio" checked={mode === 'pilih'} onChange={() => setMode('pilih')} /> Pakai akun COA yang sudah ada</label>
          </div>
        )}
        {mode === 'pilih' && (
          <label className="field"><span>Akun COA<Req /></span>
            <AccountPicker value={f.akun_id} onChange={(k) => setF({ ...f, akun_id: k })} types={['aset']} exclude={used} />
          </label>
        )}
        {kb && <label className="check"><input type="checkbox" checked={f.aktif} onChange={(e) => setF({ ...f, aktif: e.target.checked })} /> Aktif (hanya bisa dinonaktifkan bila saldonya nol)</label>}
        <Banner kind="err">{err}</Banner>
      </div>
    </Modal>
  )
}
