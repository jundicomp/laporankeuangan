import { useEffect, useState } from 'react'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, Modal, Spinner } from '../components/ui'
import { downloadXlsx } from '../lib/excel'
import { rp, tglID, today } from '../lib/format'

// ---------------------------------------------------------------- tipe

type WsRow = { kode: string; nama: string; pl: boolean; ns_d: number; ns_k: number; aj_d: number; aj_k: number; nsd_d: number; nsd_k: number; lr_d: number; lr_k: number; pk_d: number; pk_k: number }
type Worksheet = { from: string; to: string; rows: WsRow[]; total: Record<string, number>; laba: number; akhir: { lr_d: number; lr_k: number; pk_d: number; pk_k: number }; seimbang: boolean }
type CfRow = { kode: string; nama: string; jumlah: number }
type Cashflow = {
  from: string; to: string; laba: number
  operasi: { rows: CfRow[]; total: number }; investasi: { rows: CfRow[]; total: number }; pendanaan: { rows: CfRow[]; total: number }
  kenaikan: number; kas_awal: number; kas_akhir: number; selisih: number; kas: { kode: string; nama: string; awal: number; akhir: number }[]
}
type Equity = { from: string; to: string; columns: { kode: string; nama: string }[]; rows: { key: string; label: string; amounts: number[]; total: number }[]; seimbang: boolean }
type Mutasi = { kategori: string; awal: number; tambah: number; kurang: number; akhir: number; akum_awal: number; susut: number; akum_kurang: number; akum_akhir: number; nilai_buku: number }
type CalkNote = { no: number; kode: string; judul: string; teks: string; mutasi?: Mutasi[] | null; tabel: { rows: { kode: string; nama: string; kini: number; lalu: number }[]; kini: number; lalu: number } | null; diubah: { oleh: string; pada: string } | null }
type Calk = { from: string; to: string; lalu: { from: string; to: string }; perusahaan: { nama: string; alamat: string; npwp: string }; kerangka: string; catatan: CalkNote[] }

// ---------------------------------------------------------------- periode bersama

const year = new Date().getFullYear()
function usePeriod() {
  const [p, setP] = useState({ from: `${year}-01-01`, to: today() })
  return [p, setP] as const
}
function PeriodBar({ p, setP, children }: { p: { from: string; to: string }; setP: (v: { from: string; to: string }) => void; children?: React.ReactNode }) {
  return (
    <div className="filters no-print">
      <select value="" onChange={(e) => {
        const v = e.target.value
        if (v === 'ytd') setP({ from: `${year}-01-01`, to: today() })
        if (v === 'lalu') setP({ from: `${year - 1}-01-01`, to: `${year - 1}-12-31` })
        if (v === 'lalu2') setP({ from: `${year - 2}-01-01`, to: `${year - 2}-12-31` })
      }}>
        <option value="">Pilih cepat…</option>
        <option value="ytd">Tahun ini s/d hari ini</option>
        <option value="lalu">Tahun {year - 1}</option>
        <option value="lalu2">Tahun {year - 2}</option>
      </select>
      <label className="inline">Dari <input type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} /></label>
      <label className="inline">Sampai <input type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} /></label>
      <span className="grow" />
      {children}
    </div>
  )
}
const Num = ({ v, strong }: { v: number; strong?: boolean }) => <td className={`r ${v < 0 ? 'neg' : ''} ${strong ? 'tot' : ''}`}>{v ? rp(v, true) : ''}</td>
const Title = ({ name, sub, ok }: { name: string; sub: string; ok?: boolean | null }) => {
  const { boot } = useSession()
  return (
    <div className="report-title">
      <b>{boot?.company.nama}</b><h2>{name}</h2><span>{sub}</span>
      {ok === true && <span className="pill g">Seimbang ✓</span>}
      {ok === false && <span className="pill r">⚠ Tidak seimbang — periksa jurnal</span>}
    </div>
  )
}

// ---------------------------------------------------------------- neraca lajur

const WS_COLS: [string, string][] = [['ns', 'Neraca saldo'], ['aj', 'Penyesuaian'], ['nsd', 'NS disesuaikan'], ['lr', 'Laba rugi'], ['pk', 'Posisi keuangan']]

export function WorksheetReport() {
  const [p, setP] = usePeriod()
  const [d, setD] = useState<Worksheet | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setD(null); setErr('')
    call<Worksheet>('report.worksheet', p).then(setD).catch((e) => setErr(errorText(e)))
  }, [p])
  const exportXlsx = () => {
    if (!d) return
    const cols = WS_COLS.flatMap(([k, l]) => [{ header: `${l} D`, key: `${k}_d`, money: true, width: 15 }, { header: `${l} K`, key: `${k}_k`, money: true, width: 15 }])
    downloadXlsx(`Neraca-Lajur-${d.to}.xlsx`, [{
      name: 'Neraca Lajur', title: ['Neraca Lajur (Worksheet)', `${tglID(d.from)} – ${tglID(d.to)}`, 'dalam Rupiah'],
      columns: [{ header: 'Kode', key: 'kode', width: 10 }, { header: 'Akun', key: 'nama', width: 34 }, ...cols],
      rows: [...d.rows, { nama: 'Jumlah', ...d.total, bold: true }, { nama: d.laba >= 0 ? 'Laba bersih' : 'Rugi bersih', lr_d: Math.max(d.laba, 0), lr_k: Math.max(-d.laba, 0), pk_d: Math.max(-d.laba, 0), pk_k: Math.max(d.laba, 0) },
        { nama: 'Seimbang', ...d.total, ...d.akhir, bold: true }] as Record<string, unknown>[],
      bold: (r) => !!r.bold,
    }])
  }
  return (
    <>
      <PeriodBar p={p} setP={setP}>
        <button className="btn" onClick={() => window.print()} disabled={!d}>⎙ Cetak / PDF</button>
        <button className="btn" onClick={exportXlsx} disabled={!d}>⇣ Excel</button>
      </PeriodBar>
      <Banner kind="err">{err}</Banner>
      {!d ? (!err && <Spinner />) : (
        <div className="card flush report wide-report">
          <Title name="Neraca Lajur (Worksheet)" sub={`${tglID(d.from)} – ${tglID(d.to)} · dalam Rupiah`} ok={d.seimbang} />
          <div className="scroll-x">
            <table className="tbl rep ws">
              <thead>
                <tr><th rowSpan={2}>Akun</th>{WS_COLS.map(([k, l]) => <th key={k} colSpan={2} className="c">{l}</th>)}</tr>
                <tr>{WS_COLS.map(([k]) => [<th key={k + 'd'} className="r">Debit</th>, <th key={k + 'k'} className="r">Kredit</th>])}</tr>
              </thead>
              <tbody>
                {d.rows.map((r, i) => (
                  <tr key={r.kode || i} className={r.kode ? '' : 'computed'}>
                    <td className="nowrap">{r.kode && <span className="mono code">{r.kode}</span>} {r.nama}</td>
                    {WS_COLS.map(([k]) => [<Num key={k + 'd'} v={r[`${k}_d` as keyof WsRow] as number} />, <Num key={k + 'k'} v={r[`${k}_k` as keyof WsRow] as number} />])}
                  </tr>
                ))}
                <tr className="key"><td>Jumlah</td>{WS_COLS.map(([k]) => [<Num key={k + 'd'} v={d.total[`${k}_d`]} strong />, <Num key={k + 'k'} v={d.total[`${k}_k`]} strong />])}</tr>
                <tr className="computed"><td>{d.laba >= 0 ? 'Laba bersih' : 'Rugi bersih'}</td><td colSpan={6} />
                  <Num v={Math.max(d.laba, 0)} /><Num v={Math.max(-d.laba, 0)} /><Num v={Math.max(-d.laba, 0)} /><Num v={Math.max(d.laba, 0)} /></tr>
                <tr className="grand"><td>Seimbang</td><td colSpan={6} /><Num v={d.akhir.lr_d} strong /><Num v={d.akhir.lr_k} strong /><Num v={d.akhir.pk_d} strong /><Num v={d.akhir.pk_k} strong /></tr>
              </tbody>
            </table>
          </div>
          <p className="hint pad">ⓘ Akun laba rugi memakai mutasi periode; akun posisi keuangan memakai saldo kumulatif. Kolom penyesuaian berisi jurnal penyesuaian (JP) dalam periode. Jurnal penutup tidak ikut dihitung.</p>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- arus kas

export function CashflowReport() {
  const [p, setP] = usePeriod()
  const [d, setD] = useState<Cashflow | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setD(null); setErr('')
    call<Cashflow>('report.cashflow', p).then(setD).catch((e) => setErr(errorText(e)))
  }, [p])
  const Section = ({ title, s, first }: { title: string; s: Cashflow['operasi']; first?: boolean }) => (
    <>
      <tr className="sec"><td colSpan={2}>{title}</td></tr>
      {first && <tr><td className="indent2">Laba (rugi) bersih</td><Num v={d!.laba} /></tr>}
      {first && s.rows.length > 0 && <tr className="grp"><td className="indent">Penyesuaian:</td><td /></tr>}
      {s.rows.map((r) => <tr key={r.kode + r.nama}><td className="indent2">{r.nama}</td><Num v={r.jumlah} /></tr>)}
      {!first && s.rows.length === 0 && <tr><td className="indent2 hint">Tidak ada</td><td /></tr>}
      <tr className="key"><td>Kas bersih dari aktivitas {title.toLowerCase().replace('arus kas dari aktivitas ', '')}</td><Num v={s.total} strong /></tr>
    </>
  )
  const exportXlsx = () => {
    if (!d) return
    const rows: Record<string, unknown>[] = []
    const sec = (t: string, s: Cashflow['operasi'], first?: boolean) => {
      rows.push({ nama: t, bold: true })
      if (first) rows.push({ nama: '  Laba (rugi) bersih', jumlah: d.laba })
      s.rows.forEach((r) => rows.push({ nama: '  ' + r.nama, jumlah: r.jumlah }))
      rows.push({ nama: 'Kas bersih ' + t.toLowerCase(), jumlah: s.total, bold: true })
    }
    sec('Arus kas dari aktivitas operasi', d.operasi, true); sec('Arus kas dari aktivitas investasi', d.investasi); sec('Arus kas dari aktivitas pendanaan', d.pendanaan)
    rows.push({ nama: 'Kenaikan (penurunan) bersih kas', jumlah: d.kenaikan, bold: true }, { nama: 'Kas dan setara kas awal periode', jumlah: d.kas_awal }, { nama: 'Kas dan setara kas akhir periode', jumlah: d.kas_akhir, bold: true })
    downloadXlsx(`Arus-Kas-${d.to}.xlsx`, [{ name: 'Arus Kas', title: ['Laporan Arus Kas (metode tidak langsung)', `${tglID(d.from)} – ${tglID(d.to)}`, 'dalam Rupiah'],
      columns: [{ header: 'Keterangan', key: 'nama', width: 52 }, { header: 'Jumlah', key: 'jumlah', money: true, width: 18 }], rows, bold: (r) => !!r.bold }])
  }
  return (
    <>
      <PeriodBar p={p} setP={setP}>
        <button className="btn" onClick={() => window.print()} disabled={!d}>⎙ Cetak / PDF</button>
        <button className="btn" onClick={exportXlsx} disabled={!d}>⇣ Excel</button>
      </PeriodBar>
      <Banner kind="err">{err}</Banner>
      {!d ? (!err && <Spinner />) : (
        <div className="card flush report">
          <Title name="Laporan Arus Kas" sub={`${tglID(d.from)} – ${tglID(d.to)} · metode tidak langsung · dalam Rupiah`} ok={d.selisih === 0} />
          <table className="tbl rep">
            <tbody>
              <Section title="Arus kas dari aktivitas operasi" s={d.operasi} first />
              <Section title="Arus kas dari aktivitas investasi" s={d.investasi} />
              <Section title="Arus kas dari aktivitas pendanaan" s={d.pendanaan} />
              <tr className="grand"><td>Kenaikan (penurunan) bersih kas dan setara kas</td><Num v={d.kenaikan} strong /></tr>
              <tr><td>Kas dan setara kas awal periode</td><Num v={d.kas_awal} /></tr>
              <tr className="grand"><td>Kas dan setara kas akhir periode</td><Num v={d.kas_akhir} strong /></tr>
            </tbody>
          </table>
          {d.selisih !== 0 && <p className="warn-text pad">⚠ Ada selisih Rp {rp(d.selisih)} antara arus kas dan saldo kas. Periksa akun kas/bank yang belum terdaftar di Kas & Bank.</p>}
          <p className="hint pad">ⓘ Disusun dari perubahan saldo akun: laba bersih dikoreksi penyusutan dan perubahan modal kerja (operasi), perubahan aset tetap (investasi), serta pinjaman, setoran modal, dan prive (pendanaan).</p>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- perubahan ekuitas

export function EquityReport() {
  const [p, setP] = usePeriod()
  const [d, setD] = useState<Equity | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setD(null); setErr('')
    call<Equity>('report.equity', p).then(setD).catch((e) => setErr(errorText(e)))
  }, [p])
  const exportXlsx = () => {
    if (!d) return
    downloadXlsx(`Perubahan-Ekuitas-${d.to}.xlsx`, [{ name: 'Perubahan Ekuitas', title: ['Laporan Perubahan Ekuitas', `${tglID(d.from)} – ${tglID(d.to)}`, 'dalam Rupiah'],
      columns: [{ header: 'Keterangan', key: 'label', width: 40 }, ...d.columns.map((c, i) => ({ header: c.nama, key: `c${i}`, money: true, width: 18 })), { header: 'Jumlah', key: 'total', money: true, width: 18 }],
      rows: d.rows.map((r) => ({ label: r.label, total: r.total, bold: r.key === 'awal' || r.key === 'akhir', ...Object.fromEntries(r.amounts.map((a, i) => [`c${i}`, a])) })), bold: (r) => !!r.bold }])
  }
  return (
    <>
      <PeriodBar p={p} setP={setP}>
        <button className="btn" onClick={() => window.print()} disabled={!d}>⎙ Cetak / PDF</button>
        <button className="btn" onClick={exportXlsx} disabled={!d}>⇣ Excel</button>
      </PeriodBar>
      <Banner kind="err">{err}</Banner>
      {!d ? (!err && <Spinner />) : (
        <div className="card flush report">
          <Title name="Laporan Perubahan Ekuitas" sub={`${tglID(d.from)} – ${tglID(d.to)} · dalam Rupiah`} ok={d.seimbang} />
          <div className="scroll-x">
            <table className="tbl rep">
              <thead><tr><th></th>{d.columns.map((c) => <th key={c.kode} className="r">{c.nama}</th>)}<th className="r">Jumlah</th></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.key} className={r.key === 'awal' || r.key === 'akhir' ? 'grand' : ''}>
                    <td>{r.label.replace(/(\d{4}-\d{2}-\d{2})/, (m) => tglID(m))}</td>
                    {r.amounts.map((a, i) => <Num key={i} v={a} strong={r.key === 'akhir'} />)}<Num v={r.total} strong />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint pad">ⓘ Kolom saldo laba sudah termasuk laba yang belum ditutup. Baris "penutupan buku" memindahkan prive/distribusi ke saldo laba saat jurnal penutup dibuat.</p>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- CALK

export function CalkReport() {
  const { can } = useSession()
  const [tahun, setTahun] = useState(String(year - 1))
  const [d, setD] = useState<Calk | null>(null)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState<CalkNote | null>(null)
  const [flash, setFlash] = useState('')
  const load = () => { setD(null); setErr(''); call<Calk>('calk.get', { tanggal: `${tahun}-06-30` }).then(setD).catch((e) => setErr(errorText(e))) }
  useEffect(load, [tahun]) // eslint-disable-line react-hooks/exhaustive-deps
  const years = [year, year - 1, year - 2, year - 3].map(String)
  return (
    <>
      <div className="filters no-print">
        <label className="inline">Tahun buku <select value={tahun} onChange={(e) => setTahun(e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <span className="grow" />
        <button className="btn" onClick={() => window.print()} disabled={!d}>⎙ Cetak / PDF</button>
      </div>
      {flash && <Banner kind="ok">{flash}</Banner>}
      <Banner kind="err">{err}</Banner>
      {!d ? (!err && <Spinner />) : (
        <div className="card report calk">
          <Title name="Catatan atas Laporan Keuangan" sub={`Untuk tahun buku ${tglID(d.from)} – ${tglID(d.to)} · ${d.kerangka}`} />
          {d.catatan.map((c) => (
            <section key={c.kode} className="calk-note">
              <div className="row between"><h3>{c.no}. {c.judul}</h3>
                {can('periode.lock') && <button className="link no-print" onClick={() => setEdit(c)}>✎ ubah teks</button>}</div>
              {c.teks && c.teks.split('\n').map((t, i) => <p key={i}>{t}</p>)}
              {c.tabel && (
                <table className="tbl rep calk-tbl">
                  <thead><tr><th></th><th className="r">{d.to.slice(0, 4)}</th><th className="r">{d.lalu.to.slice(0, 4)}</th></tr></thead>
                  <tbody>
                    {c.tabel.rows.map((r) => <tr key={r.kode}><td>{r.nama}</td><Num v={r.kini} /><Num v={r.lalu} /></tr>)}
                    <tr className="key"><td>Jumlah</td><Num v={c.tabel.kini} strong /><Num v={c.tabel.lalu} strong /></tr>
                  </tbody>
                </table>
              )}
              {c.mutasi && c.mutasi.length > 1 && (
                <>
                  <p className="small"><b>Mutasi aset tetap tahun {d.to.slice(0, 4)}</b></p>
                  <div className="scroll-x">
                    <table className="tbl rep calk-mut">
                      <thead><tr><th>Kategori</th><th className="r">Saldo awal</th><th className="r">Penambahan</th><th className="r">Pelepasan</th><th className="r">Saldo akhir</th>
                        <th className="r">Akum. awal</th><th className="r">Penyusutan</th><th className="r">Akum. dilepas</th><th className="r">Akum. akhir</th><th className="r">Nilai buku</th></tr></thead>
                      <tbody>{c.mutasi.map((m, i) => (
                        <tr key={m.kategori} className={i === c.mutasi!.length - 1 ? 'key' : ''}><td>{m.kategori}</td>
                          <Num v={m.awal} /><Num v={m.tambah} /><Num v={m.kurang} /><Num v={m.akhir} strong={i === c.mutasi!.length - 1} />
                          <Num v={m.akum_awal} /><Num v={m.susut} /><Num v={m.akum_kurang} /><Num v={m.akum_akhir} /><Num v={m.nilai_buku} strong /></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </>
              )}
              {c.diubah && <p className="small muted no-print">Teks diubah {c.diubah.oleh}</p>}
            </section>
          ))}
          <p className="hint no-print">ⓘ Angka diambil otomatis dari buku besar per akhir tahun buku dan tahun sebelumnya. Teks tiap catatan bisa disesuaikan; kosongkan untuk kembali ke teks bawaan.</p>
        </div>
      )}
      {edit && d && <CalkEdit note={edit} tahun={tahun} onClose={() => setEdit(null)} onSaved={(t) => { setEdit(null); setFlash(t); load() }} />}
    </>
  )
}

function CalkEdit({ note, tahun, onClose, onSaved }: { note: CalkNote; tahun: string; onClose: () => void; onSaved: (t: string) => void }) {
  const [isi, setIsi] = useState(note.teks)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async (reset = false) => {
    setBusy(true); setErr('')
    try {
      await call('calk.save', { tanggal: `${tahun}-06-30`, kode: note.kode, isi: reset ? '' : isi })
      onSaved(reset ? `Catatan "${note.judul}" kembali ke teks bawaan.` : `Catatan "${note.judul}" disimpan.`)
    } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  return (
    <Modal size="lg" title={`Ubah catatan ${note.no}. ${note.judul}`} sub={`Tahun buku ${tahun}`} onClose={onClose} dirty={!busy && isi !== note.teks}
      footer={<>{note.diubah && <button className="btn" onClick={() => save(true)} disabled={busy}>Kembalikan teks bawaan</button>}
        <button className="btn" onClick={onClose}>Batal</button><button className="btn primary" onClick={() => save()} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></>}>
      <textarea className="calk-area" value={isi} onChange={(e) => setIsi(e.target.value)} rows={14} />
      <p className="hint">ⓘ Tiap baris baru menjadi paragraf terpisah. Tabel angka di bawah catatan tetap otomatis.</p>
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
}
