import { useEffect, useState } from 'react'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, Spinner } from '../components/ui'
import { downloadXlsx } from '../lib/excel'
import { rp, tglID, today } from '../lib/format'

type Val = number | 'tak_hingga' | null
type Ratio = { grup: string; kode: string; nama: string; satuan: string; rumus: string; arti: string; rendah: boolean; baik?: number; waspada?: number; nilai: Val; lalu: Val; status: string }
type Base = Record<string, number>
type Res = { from: string; to: string; lalu: { from: string; to: string }; hari: number; rasio: Ratio[]
  dasar: { akhir: Base; awal: Base; lr: Base; lalu_akhir: Base; lalu_lr: Base } }

const ST: Record<string, [string, string]> = { baik: ['g', 'Sehat'], waspada: ['o', 'Perlu perhatian'], buruk: ['r', 'Lemah'], netral: ['n', 'Informasi'], na: ['n', 'Tidak ada data'] }
const year = Number(today().slice(0, 4))

export function fmtRatio(v: Val, s: string) {
  if (v === null) return '—'
  if (v === 'tak_hingga') return '∞'
  if (s === 'Rp') return `Rp ${rp(v)}`
  if (s === '%') return `${rp(Math.round(v * 10) / 10)}%`
  if (s === 'hari') return `${rp(Math.round(v))} hari`
  return `${rp(Math.round(v * 100) / 100)}×`
}
function patokan(r: Ratio) {
  if (r.baik === undefined) return ''
  const f = (v: number) => (r.satuan === 'Rp' ? 'positif' : fmtRatio(v, r.satuan))
  if (r.satuan === 'Rp') return 'sehat bila positif'
  return r.rendah ? `sehat ≤ ${f(r.baik)}, waspada ≤ ${f(r.waspada!)}` : `sehat ≥ ${f(r.baik)}${r.waspada ? `, waspada ≥ ${f(r.waspada)}` : ', waspada > 0'}`
}

export function RatioReport() {
  const { boot } = useSession()
  const [p, setP] = useState({ from: `${year}-01-01`, to: today() })
  const [d, setD] = useState<Res | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setD(null); setErr(''); call<Res>('ratio.get', p).then(setD).catch((e) => setErr(errorText(e))) }, [p])
  const groups = d ? [...new Set(d.rasio.map((r) => r.grup))] : []
  const count = (s: string) => d?.rasio.filter((r) => r.status === s).length ?? 0
  const exportXlsx = () => d && downloadXlsx(`Analisis-rasio-${d.to}.xlsx`, [{
    name: 'Rasio', title: [boot?.company.nama ?? '', 'Analisis Rasio Keuangan', `${tglID(d.from)} – ${tglID(d.to)} dibanding ${tglID(d.lalu.from)} – ${tglID(d.lalu.to)}`],
    columns: [{ header: 'Kelompok', key: 'grup', width: 14 }, { header: 'Rasio', key: 'nama', width: 34 }, { header: 'Periode ini', key: 'v', width: 16 }, { header: 'Tahun lalu', key: 'l', width: 16 },
      { header: 'Status', key: 's', width: 16 }, { header: 'Rumus', key: 'rumus', width: 44 }, { header: 'Patokan', key: 'pt', width: 30 }],
    rows: d.rasio.map((r) => ({ ...r, v: fmtRatio(r.nilai, r.satuan), l: fmtRatio(r.lalu, r.satuan), s: ST[r.status]?.[1], pt: patokan(r) })),
  }])
  const b = d?.dasar
  return (
    <>
      <div className="filters no-print">
        <select value="" onChange={(e) => {
          const v = e.target.value
          if (v === 'ytd') setP({ from: `${year}-01-01`, to: today() })
          if (v === 'lalu') setP({ from: `${year - 1}-01-01`, to: `${year - 1}-12-31` })
        }}>
          <option value="">Pilih cepat…</option><option value="ytd">Tahun ini s/d hari ini</option><option value="lalu">Tahun {year - 1}</option>
        </select>
        <label className="inline">Dari <input type="date" value={p.from} onChange={(e) => e.target.value && setP({ ...p, from: e.target.value })} /></label>
        <label className="inline">Sampai <input type="date" value={p.to} onChange={(e) => e.target.value && setP({ ...p, to: e.target.value })} /></label>
        <span className="grow" />
        <button className="btn" onClick={exportXlsx} disabled={!d}>⤓ Excel</button>
        <button className="btn" onClick={() => window.print()} disabled={!d}>⎙ Cetak / PDF</button>
      </div>
      <Banner kind="err">{err}</Banner>
      {!d ? (!err && <Spinner />) : (
        <div className="card report ratio">
          <div className="report-title"><b>{boot?.company.nama}</b><h2>Analisis Rasio Keuangan</h2>
            <span>{tglID(d.from)} – {tglID(d.to)} ({d.hari} hari) · pembanding {tglID(d.lalu.from)} – {tglID(d.lalu.to)}</span></div>
          <div className="ratio-sum">
            <span className="pill g">{count('baik')} sehat</span><span className="pill o">{count('waspada')} perlu perhatian</span><span className="pill r">{count('buruk')} lemah</span>
          </div>
          {groups.map((g) => (
            <section key={g}>
              <h3>{g}</h3>
              <table className="tbl rep ratio-tbl">
                <thead><tr><th>Rasio</th><th className="r">Periode ini</th><th className="r">Tahun lalu</th><th>Status</th></tr></thead>
                <tbody>{d.rasio.filter((r) => r.grup === g).map((r) => (
                  <tr key={r.kode}>
                    <td><b>{r.nama}</b><div className="small">{r.rumus}{patokan(r) && ` · ${patokan(r)}`}</div><div className="hint small">ⓘ {r.arti}</div></td>
                    <td className="r tot nowrap">{fmtRatio(r.nilai, r.satuan)}</td>
                    <td className="r nowrap">{fmtRatio(r.lalu, r.satuan)}</td>
                    <td><span className={`pill ${ST[r.status]?.[0] ?? 'n'}`}>{ST[r.status]?.[1] ?? r.status}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </section>
          ))}
          {b && (
            <section>
              <h3>Angka dasar</h3>
              <table className="tbl rep ratio-base">
                <thead><tr><th>Pos</th><th className="r">Awal periode</th><th className="r">Akhir periode</th></tr></thead>
                <tbody>
                  {[['aset', 'Total aset'], ['aset_lancar', 'Aset lancar'], ['kas', 'Kas & bank'], ['piutang', 'Piutang usaha'], ['persediaan', 'Persediaan'],
                    ['liabilitas', 'Total liabilitas'], ['liab_lancar', 'Liabilitas jangka pendek'], ['utang_usaha', 'Utang usaha'], ['utang_bank', 'Utang bank'], ['ekuitas', 'Ekuitas']].map(([k, l]) => (
                    <tr key={k}><td>{l}</td><td className="r">{rp(b.awal[k], true)}</td><td className="r">{rp(b.akhir[k], true)}</td></tr>
                  ))}
                </tbody>
                <thead><tr><th>Laba rugi periode</th><th className="r">Tahun lalu</th><th className="r">Periode ini</th></tr></thead>
                <tbody>
                  {[['pendapatan', 'Pendapatan'], ['hpp', 'Beban pokok penjualan'], ['laba_kotor', 'Laba kotor'], ['beban', 'Beban usaha'], ['laba_usaha', 'Laba usaha'],
                    ['bunga', 'Beban bunga'], ['penyusutan', 'Penyusutan'], ['ebitda', 'EBITDA'], ['laba_bersih', 'Laba bersih']].map(([k, l]) => (
                    <tr key={k} className={['laba_kotor', 'laba_usaha', 'laba_bersih', 'ebitda'].includes(k) ? 'key' : ''}><td>{l}</td><td className="r">{rp(b.lalu_lr[k], true)}</td><td className={`r ${b.lr[k] < 0 ? 'neg' : ''}`}>{rp(b.lr[k], true)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <p className="hint no-print">ⓘ Rasio aktivitas & imbal hasil dihitung dari rata-rata saldo awal dan akhir periode, disetahunkan ({d.hari} hari → 365 hari). Patokan bersifat umum untuk UMKM; bank bisa memakai batas berbeda sesuai sektor usaha.</p>
        </div>
      )}
    </>
  )
}
