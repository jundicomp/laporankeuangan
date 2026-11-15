import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { CashSelect, cashShort, useCashAccounts } from '../components/CashPick'
import { Banner, Modal, PageHead, Req, Spinner } from '../components/ui'
import { bulanID, daysBetween, parseNum, rp, tglID, today } from '../lib/format'

type Item = { terutang: number; disetor: number; jatuh_tempo: string; lapor: string; status: string; keluaran?: number; masukan?: number; omzet?: number
  setor: { id: string; tgl: string; jumlah: number; kompensasi: number; ntpn: string }[] }
type Cal = { tgl: string; jenis: string; nama: string; masa: string; jumlah: number | null; status: string }
type Summary = { tahun: string; settings: { pkp: boolean; final_umkm: boolean; pph25: number; bentuk: string }; jenis: { kode: string; nama: string; akun: string }[]
  masa: { masa: string; items: Record<string, Item> }[]; saldo: { jenis: string; akun: string; saldo: number }[]; kalender: Cal[] }
type Hist = { id: string; jenis: string; nama: string; masa: string; tgl: string; jumlah: number; kompensasi: number; ntpn: string; rekening: string; status: string; alasan_batal: string; jurnal_id: string; no: string }

const ST: Record<string, [string, string]> = {
  disetor: ['g', 'disetor'], belum: ['o', 'belum disetor'], terlambat: ['r', 'terlambat'], nihil: ['b', 'nihil'], berjalan: ['n', 'masa berjalan'], lebih_bayar: ['b', 'lebih bayar'], lapor: ['b', 'lapor'],
}
const SALDO_LABEL: Record<string, string> = { ppn: 'PPN keluaran belum dikompensasi', pph21: 'Utang PPh 21', pph23: 'Utang PPh 23', pph42: 'Utang PPh 4(2)', pph25: 'Pajak dibayar di muka', ppn_masukan: 'PPN masukan belum dikompensasi' }
const yearNow = Number(today().slice(0, 4))

export function TaxPage() {
  const { can } = useSession()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as 'masa' | 'kalender' | 'riwayat') || 'masa'
  const [tahun, setTahun] = useState(String(yearNow))
  const [d, setD] = useState<Summary | null>(null)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [cell, setCell] = useState<{ jenis: string; masa: string } | null>(null)
  const [setting, setSetting] = useState(false)
  const load = useCallback(() => { setErr(''); call<Summary>('tax.summary', { tahun }).then(setD).catch((e) => setErr(errorText(e))) }, [tahun])
  useEffect(() => { load() }, [load])
  const done = (t: string) => { setCell(null); setSetting(false); setFlash(t); load() }

  return (
    <>
      <PageHead title="Pajak" sub="Rekap PPN & PPh per masa dari buku besar, catat setoran (NTPN), dan pengingat jatuh tempo.">
        {can('pajak.edit') && <button className="btn" onClick={() => setSetting(true)}>Pengaturan pajak</button>}
      </PageHead>
      {flash && <Banner kind="ok">{flash}</Banner>}
      <Banner kind="err">{err}</Banner>
      <div className="tabs">
        <button className={tab === 'masa' ? 'on' : ''} onClick={() => setSp({})}>Per masa</button>
        <button className={tab === 'kalender' ? 'on' : ''} onClick={() => setSp({ tab: 'kalender' })}>Kalender jatuh tempo</button>
        <button className={tab === 'riwayat' ? 'on' : ''} onClick={() => setSp({ tab: 'riwayat' })}>Riwayat setor</button>
      </div>
      {tab === 'masa' && (
        <>
          <div className="filters">
            <label className="inline">Tahun <select value={tahun} onChange={(e) => setTahun(e.target.value)}>{[yearNow, yearNow - 1, yearNow - 2].map((y) => <option key={y}>{y}</option>)}</select></label>
            <span className="hint">ⓘ Klik angka untuk mencatat setoran atau melihat detailnya.</span>
          </div>
          {d && (
            <div className="kpis">
              {d.saldo.filter((s) => s.saldo).map((s) => <div key={s.jenis} className="card kpi"><span>{SALDO_LABEL[s.jenis] ?? s.jenis}</span><b>Rp {rp(s.saldo)}</b><small className="muted">akun {s.akun} saat ini</small></div>)}
              {!d.saldo.some((s) => s.saldo) && <div className="card kpi"><span>Utang pajak</span><b>Rp 0</b><small className="muted">tidak ada saldo terutang</small></div>}
            </div>
          )}
          <div className="card flush">
            {!d ? <div className="pad"><Spinner /></div> : (
              <div className="scroll-x">
                <table className="tbl tax-tbl">
                  <thead><tr><th>Masa</th>{d.jenis.map((j) => <th key={j.kode} className="r">{j.nama}</th>)}</tr></thead>
                  <tbody>{d.masa.map((m) => (
                    <tr key={m.masa}><td className="nowrap">{bulanID(m.masa)}</td>
                      {d.jenis.map((j) => {
                        const it = m.items[j.kode]
                        const quiet = it.status === 'berjalan' && !it.terutang || it.status === 'nihil'
                        return (
                          <td key={j.kode} className={`r ${quiet ? '' : 'click'}`} onClick={() => !quiet && setCell({ jenis: j.kode, masa: m.masa })}>
                            <span className={it.terutang < 0 ? 'in' : ''}>{it.terutang ? rp(it.terutang) : '—'}</span>
                            {!quiet && <div><span className={`pill ${ST[it.status]?.[0] ?? 'n'}`}>{ST[it.status]?.[1] ?? it.status}</span></div>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
          <p className="hint">ⓘ PPN = keluaran (invoice) − masukan (pembelian); minus berarti lebih bayar dan dikompensasi ke masa berikutnya. PPh 21 dari payroll, PPh 23 dari potongan saat bayar supplier.
            Setor tanggal 15 bulan berikutnya; lapor SPT Masa PPh tanggal 20, SPT Masa PPN akhir bulan berikutnya (PMK 81/2024).</p>
        </>
      )}
      {tab === 'kalender' && (d ? <CalendarTab cal={d.kalender} onOpen={(c) => setCell({ jenis: c.jenis, masa: c.masa })} /> : <Spinner />)}
      {tab === 'riwayat' && <HistoryTab tahun={tahun} setTahun={setTahun} />}
      {cell && d && <SetorModal d={d} jenis={cell.jenis} masa={cell.masa} onClose={() => setCell(null)} onSaved={done} />}
      {setting && d && <TaxSettings st={d.settings} onClose={() => setSetting(false)} onSaved={done} />}
    </>
  )
}

function CalendarTab({ cal, onOpen }: { cal: Cal[]; onOpen: (c: Cal) => void }) {
  const t = today()
  return (
    <div className="card flush">
      <table className="tbl">
        <thead><tr><th>Tanggal</th><th>Kewajiban</th><th>Masa</th><th className="r">Jumlah</th><th>Status</th></tr></thead>
        <tbody>
          {cal.length === 0 && <tr><td colSpan={5} className="hint">ⓘ Tidak ada kewajiban terlambat atau jatuh tempo dalam 2 bulan ke depan.</td></tr>}
          {cal.map((c, i) => {
            const days = daysBetween(t, c.tgl)
            const late = c.status === 'terlambat'
            return (
              <tr key={i} className={`${c.jenis !== 'tahunan' && c.nama.startsWith('Setor') && c.status !== 'disetor' && c.status !== 'nihil' ? 'click' : ''} ${late ? 'bad' : ''}`}
                onClick={() => c.jenis !== 'tahunan' && c.nama.startsWith('Setor') && c.status !== 'disetor' && c.status !== 'nihil' && onOpen(c)}>
                <td className="nowrap">{tglID(c.tgl)}<div className={`small ${days < 0 ? 'err-text' : days <= 7 ? 'warn-text' : ''}`}>{days === 0 ? 'hari ini' : days > 0 ? `${days} hari lagi` : `${-days} hari lalu`}</div></td>
                <td>{c.nama}</td><td>{/^\d{4}$/.test(c.masa) ? `Tahun ${c.masa}` : bulanID(c.masa, false)}</td>
                <td className="r">{c.jumlah !== null ? rp(c.jumlah, true) : ''}</td>
                <td><span className={`pill ${ST[c.status]?.[0] ?? 'n'}`}>{c.nama.startsWith('Lapor') && c.status !== 'nihil' ? 'perlu lapor' : ST[c.status]?.[1] ?? c.status}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="hint pad">ⓘ Tanggal yang jatuh di Sabtu/Minggu sudah digeser ke Senin. Hari libur nasional belum dihitung — cek kalender DJP bila mepet.</p>
    </div>
  )
}

function HistoryTab({ tahun, setTahun }: { tahun: string; setTahun: (y: string) => void }) {
  const { can } = useSession()
  const [rows, setRows] = useState<Hist[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setRows(null); call<Hist[]>('tax.history', { tahun }).then(setRows).catch((e) => setErr(errorText(e))) }, [tahun])
  return (
    <>
      <div className="filters"><label className="inline">Tahun <select value={tahun} onChange={(e) => setTahun(e.target.value)}>{[yearNow, yearNow - 1, yearNow - 2].map((y) => <option key={y}>{y}</option>)}</select></label></div>
      <Banner kind="err">{err}</Banner>
      <div className="card flush">
        {!rows ? <div className="pad"><Spinner /></div> : (
          <table className="tbl">
            <thead><tr><th>Tanggal</th><th>Pajak</th><th>Masa</th><th>NTPN</th><th>Jurnal</th><th className="r">Disetor</th><th className="r">Kompensasi</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="hint">ⓘ Belum ada setoran pajak tercatat.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className={r.status === 'batal' ? 'off' : ''}><td className="nowrap">{tglID(r.tgl)}</td><td>{r.nama}</td><td>{bulanID(r.masa, false)}</td><td className="mono small">{r.ntpn || '—'}</td>
                  <td>{can('jurnal.view') ? <Link className="mono" to={`/jurnal?open=${r.jurnal_id}`}>{r.no}</Link> : r.no}</td>
                  <td className="r">{rp(r.jumlah, true)}</td><td className="r">{rp(r.kompensasi, true)}</td>
                  <td>{r.status === 'batal' ? <span className="pill r" title={r.alasan_batal}>batal</span> : r.rekening && <span className="small">{r.rekening}</span>}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function SetorModal({ d, jenis, masa, onClose, onSaved }: { d: Summary; jenis: string; masa: string; onClose: () => void; onSaved: (t: string) => void }) {
  const { can } = useSession()
  const cash = useCashAccounts()
  const j = d.jenis.find((x) => x.kode === jenis)
  const it = d.masa.find((m) => m.masa === masa)?.items[jenis]
  const saldoAkun = d.saldo.find((s) => s.jenis === jenis)?.saldo ?? 0
  const ppn = jenis === 'ppn'
  const [tgl, setTgl] = useState(today())
  const [kb, setKb] = useState('')
  const [jumlah, setJumlah] = useState(it && it.terutang > 0 ? rp(Math.min(it.terutang, ['pph21', 'pph23', 'pph42'].includes(jenis) ? saldoAkun : it.terutang)) : '')
  const [ntpn, setNtpn] = useState('')
  const [voidId, setVoidId] = useState<string | null>(null)
  const [alasan, setAlasan] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (cash && !kb) setKb(cash.find((k) => k.jenis === 'bank')?.id ?? cash[0]?.id ?? '') }, [cash]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!j || !it) return null
  const jml = ppn ? Math.max(0, it.terutang) : parseNum(jumlah) || 0
  const done = it.setor.length > 0
  const blocker = done ? '' : !tgl ? 'Isi tanggal setor.' : tgl < masa + '-01' ? 'Tanggal sebelum masa pajak.' : !ppn && jml <= 0 ? 'Isi jumlah setor.'
    : ntpn && !/^[0-9A-Za-z]{16}$/.test(ntpn) ? 'NTPN 16 huruf/angka.' : jml > 0 && !kb ? 'Pilih rekening.' : jml > 0 ? cashShort(cash, kb, jml) : ''
  const save = async () => {
    if (blocker) return setErr(blocker)
    setBusy(true); setErr('')
    try {
      const r = await call<{ no: string; jumlah: number; kompensasi: number }>('tax.pay', { jenis, masa, tgl, kasbank_id: kb, jumlah: jml, ntpn })
      onSaved(`${j.nama} masa ${bulanID(masa)} tercatat disetor Rp ${rp(r.jumlah)}${r.kompensasi ? ` (kompensasi PPN masukan Rp ${rp(r.kompensasi)})` : ''} — jurnal ${r.no}.`)
    } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  const voidIt = async () => {
    if (!alasan.trim()) return setErr('Isi alasan pembatalan.')
    setBusy(true); setErr('')
    try { await call('tax.payVoid', { id: voidId, alasan }); onSaved(`Catatan setor ${j.nama} masa ${bulanID(masa)} dibatalkan.`) } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  if (voidId) return (
    <Modal size="sm" title="Batalkan catatan setor?" onClose={onClose} dirty={!!alasan.trim() && !busy}
      footer={<>{!alasan.trim() && <span className="warn-text">⚠ Isi alasan.</span>}<button className="btn" onClick={() => setVoidId(null)}>Kembali</button><button className="btn danger" onClick={voidIt} disabled={busy}>{busy ? 'Memproses…' : 'Batalkan'}</button></>}>
      <label className="field"><span>Alasan<Req /></span><input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. salah masa / salah nominal" /></label>
      <p className="hint">ⓘ Jurnal setor dibalik; utang pajak muncul lagi.</p>
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
  const edit = can('pajak.edit') && !done
  return (
    <Modal size="md" title={`${j.nama} · masa ${bulanID(masa)}`} sub={`Setor paling lambat ${tglID(it.jatuh_tempo)}${it.lapor ? ` · lapor ${tglID(it.lapor)}` : ''}`} onClose={onClose} dirty={edit && !busy && !!ntpn}
      footer={edit ? <>{blocker ? <span className="warn-text">⚠ {blocker}</span> : <span className="ok-text">✓ Siap dicatat</span>}<button className="btn" onClick={onClose}>Batal</button>
        <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : jml > 0 ? 'Catat setoran' : 'Catat kompensasi'}</button></>
        : <button className="btn primary" onClick={onClose}>Tutup</button>}>
      <div className="stack">
        <table className="tbl kv"><tbody>
          {ppn && <><tr><td>PPN keluaran</td><td>Rp {rp(it.keluaran ?? 0)}</td></tr><tr><td>PPN masukan</td><td>Rp {rp(it.masukan ?? 0)}</td></tr></>}
          {jenis === 'final' && <tr><td>Omzet bruto masa ini</td><td>Rp {rp(it.omzet ?? 0)} × 0,5%</td></tr>}
          <tr><td>{ppn ? (it.terutang < 0 ? 'Lebih bayar' : 'Kurang bayar') : 'Terutang masa ini'}</td><td><b>Rp {rp(Math.abs(it.terutang))}</b></td></tr>
          {['pph21', 'pph23', 'pph42'].includes(jenis) && <tr><td>Saldo utang {j.nama} saat ini</td><td>Rp {rp(saldoAkun)}</td></tr>}
        </tbody></table>
        {done ? (
          <>
            {it.setor.map((s) => (
              <div key={s.id} className="row between"><span className="ok-text">✓ Disetor {tglID(s.tgl)} Rp {rp(s.jumlah)}{s.kompensasi ? ` + kompensasi Rp ${rp(s.kompensasi)}` : ''}{s.ntpn ? ` · NTPN ${s.ntpn}` : ''}</span>
                {can('pajak.edit') && <button className="link" onClick={() => setVoidId(s.id)}>Batalkan</button>}</div>
            ))}
          </>
        ) : edit ? (
          <>
            {ppn && <p className="hint">ⓘ Dihitung dari saldo PPN keluaran & masukan s/d akhir {bulanID(masa)}: jurnal Dr PPN keluaran, Cr PPN masukan, Cr kas sebesar kurang bayar.{it.terutang <= 0 ? ' Masa ini lebih bayar/nihil — cukup lapor SPT Masa PPN; saldo masukan dikompensasi otomatis saat ada kurang bayar.' : ''}</p>}
            <div className="grid2">
              <label className="field"><span>Tanggal setor<Req /></span><input type="date" value={tgl} onChange={(e) => setTgl(e.target.value)} /></label>
              {ppn ? <label className="field"><span>Jumlah disetor</span><input className="num" value={rp(jml)} readOnly /></label>
                : <label className="field"><span>Jumlah disetor (Rp)<Req /></span><input className="num" inputMode="decimal" value={jumlah} onChange={(e) => setJumlah(e.target.value)} onBlur={(e) => { const n = parseNum(e.target.value); if (n) setJumlah(rp(n)) }} /></label>}
            </div>
            <div className="grid2">
              <label className="field"><span>Dari rekening{jml > 0 && <Req />}</span>{cash ? <CashSelect list={cash} value={kb} onChange={setKb} /> : <Spinner />}</label>
              <label className="field"><span>NTPN</span><input value={ntpn} onChange={(e) => setNtpn(e.target.value.toUpperCase())} placeholder="16 karakter dari bukti setor" maxLength={16} /></label>
            </div>
          </>
        ) : <p className="hint">ⓘ Belum disetor. Peran Anda tidak bisa mencatat setoran pajak.</p>}
        <Banner kind="err">{err}</Banner>
      </div>
    </Modal>
  )
}

function TaxSettings({ st, onClose, onSaved }: { st: Summary['settings']; onClose: () => void; onSaved: (t: string) => void }) {
  const [f, setF] = useState({ pkp: st.pkp, final_umkm: st.final_umkm, pph25: st.pph25 ? rp(st.pph25) : '', bentuk: st.bentuk })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const dirty = f.pkp !== st.pkp || f.final_umkm !== st.final_umkm || (parseNum(f.pph25) || 0) !== st.pph25 || f.bentuk !== st.bentuk
  const save = async () => {
    setBusy(true); setErr('')
    try { await call('tax.settings', { ...f, pph25: parseNum(f.pph25) || 0 }); onSaved('Pengaturan pajak disimpan.') } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  return (
    <Modal size="md" title="Pengaturan pajak" onClose={onClose} dirty={dirty && !busy}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></>}>
      <div className="stack">
        <label className="field"><span>Bentuk usaha</span><select value={f.bentuk} onChange={(e) => setF({ ...f, bentuk: e.target.value })}><option value="badan">Badan (PT/CV/koperasi) — SPT Tahunan akhir April</option><option value="orang_pribadi">Orang pribadi — SPT Tahunan akhir Maret</option></select></label>
        <label className="check"><input type="checkbox" checked={f.pkp} onChange={(e) => setF({ ...f, pkp: e.target.checked })} /> Pengusaha Kena Pajak (memungut PPN)</label>
        <label className="check"><input type="checkbox" checked={f.final_umkm} onChange={(e) => setF({ ...f, final_umkm: e.target.checked })} /> Memakai PPh final UMKM 0,5% dari omzet</label>
        {f.final_umkm && <p className="hint">ⓘ Sejak PP 20/2026 fasilitas ini pada dasarnya untuk orang pribadi, perseroan perorangan, dan koperasi dengan omzet ≤ Rp4,8 miliar/tahun; CV/PT yang baru berdiri tidak lagi bisa memakainya. Orang pribadi tidak kena pajak untuk omzet sampai Rp500 juta setahun — kurangi jumlah setor sendiri bila masih di bawah batas itu. Pastikan dengan konsultan pajak.</p>}
        <label className="field"><span>Angsuran PPh 25 per bulan (Rp)</span><input className="num" inputMode="decimal" value={f.pph25} onChange={(e) => setF({ ...f, pph25: e.target.value })} placeholder="0 = tidak ada" />
          <small className="hint">ⓘ Dari SPT Tahunan tahun lalu. Setorannya dicatat sebagai pajak dibayar di muka (1-1602).</small></label>
        <Banner kind="err">{err}</Banner>
      </div>
    </Modal>
  )
}
