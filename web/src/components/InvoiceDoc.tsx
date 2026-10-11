import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSession } from '../auth/session'
import { rp, terbilang, tglPanjang } from '../lib/format'

export type InvLine = { produk_id: string; deskripsi: string; qty: number; satuan: string; harga: number; diskon: number; jumlah: number; akun_id: string }
export type Payment = {
  id: string; no: string; tgl: string; metode: string; kasbank_id: string; jumlah: number; potongan: number; akun_potongan: string
  keterangan: string; referensi: string; status: string; alasan_batal: string; jurnal_id: string; dibuat_oleh: string
}
export type Invoice = {
  id: string; no: string; tgl: string; jatuh_tempo: string; pihak_id: string; pihak_nama: string; status: 'draft' | 'posted' | 'batal'
  bayar: 'draft' | 'batal' | 'lunas' | 'sebagian' | 'belum'; terlambat: number
  subtotal: number; diskon: number; diskon_nota: number; pajak: number; ppn_tarif: number; total: number; sisa: number
  referensi: string; catatan: string; saldo_awal: boolean; jurnal_id: string; alasan_batal: string
  dibuat_oleh: string; dibuat_pada: string; diposting_oleh: string
  lines: InvLine[]
  pembayaran?: Payment[]
  penagihan?: { tgl: string; via: string; catatan: string; oleh: string }[]
  pelanggan?: { id: string; kode: string; nama: string; npwp: string; alamat: string; telepon: string; email: string } | null
}
export type Rekening = { bank: string; no: string; atas_nama: string }

export function companyAccounts(json: string | undefined): Rekening[] {
  try { const r = JSON.parse(json || '[]'); return Array.isArray(r) ? r : [] } catch { return [] }
}

/** Lembar invoice — dipakai untuk pratinjau di layar dan untuk cetak/PDF. */
export function InvoiceDoc({ inv }: { inv: Invoice }) {
  const { boot } = useSession()
  const c = boot?.company ?? {}
  const s = boot?.settings ?? {}
  const rek = companyAccounts(c.rekening_json)
  const dpp = inv.subtotal - inv.diskon
  const paid = (inv.pembayaran ?? []).filter((p) => p.status !== 'batal')
  const paidSum = paid.reduce((t, p) => t + p.jumlah + p.potongan, 0)
  const anyDisc = inv.lines.some((l) => l.diskon)
  return (
    <div className="inv-doc">
      <div className="inv-top">
        <div className="inv-co">
          {c.logo_url && <img src={c.logo_url} alt="" className="inv-logo" />}
          <div>
            <b className="inv-co-name">{c.nama}</b>
            {c.alamat && <div>{c.alamat}</div>}
            <div>{[c.telepon, c.email].filter(Boolean).join(' · ')}</div>
            {c.npwp && <div>NPWP {c.npwp}</div>}
          </div>
        </div>
        <div className="inv-title">
          <h2>INVOICE</h2>
          <div className="mono">{inv.no || 'DRAFT'}</div>
          {inv.status === 'draft' && <span className="pill o">Draft — belum berlaku</span>}
          {inv.status === 'batal' && <span className="pill r">Dibatalkan</span>}
          {inv.status === 'posted' && inv.bayar === 'lunas' && <span className="inv-stamp">LUNAS</span>}
        </div>
      </div>

      <div className="inv-meta">
        <div>
          <span className="inv-lbl">Ditagihkan kepada</span>
          <b>{inv.pelanggan?.nama ?? inv.pihak_nama}</b>
          {inv.pelanggan?.alamat && <div>{inv.pelanggan.alamat}</div>}
          {inv.pelanggan?.telepon && <div>{inv.pelanggan.telepon}</div>}
          {inv.pelanggan?.npwp && <div>NPWP {inv.pelanggan.npwp}</div>}
        </div>
        <table className="inv-kv">
          <tbody>
            <tr><td>Tanggal</td><td>{tglPanjang(inv.tgl)}</td></tr>
            <tr><td>Jatuh tempo</td><td>{tglPanjang(inv.jatuh_tempo)}</td></tr>
            {inv.referensi && <tr><td>Referensi</td><td>{inv.referensi}</td></tr>}
          </tbody>
        </table>
      </div>

      <table className="inv-lines">
        <thead>
          <tr><th className="n">No</th><th>Deskripsi</th><th className="r">Qty</th><th className="r">Harga</th>{anyDisc && <th className="r">Diskon</th>}<th className="r">Jumlah</th></tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={i}>
              <td className="n">{i + 1}</td>
              <td>{l.deskripsi}</td>
              <td className="r nowrap">{rp(l.qty)} {l.satuan}</td>
              <td className="r">{rp(l.harga)}</td>
              {anyDisc && <td className="r">{l.diskon ? rp(l.diskon) : ''}</td>}
              <td className="r">{rp(l.jumlah)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="inv-bottom">
        <div className="inv-words">
          <span className="inv-lbl">Terbilang</span>
          <i>{(() => { const t = terbilang(inv.total); return t.charAt(0).toUpperCase() + t.slice(1) })()}</i>
          {rek.length > 0 && (
            <div className="inv-bank">
              <span className="inv-lbl">Pembayaran ke</span>
              {rek.map((r, i) => <div key={i}><b>{r.bank}</b> {r.no}{r.atas_nama && <> a.n. {r.atas_nama}</>}</div>)}
            </div>
          )}
          {inv.catatan && <div className="inv-note"><span className="inv-lbl">Catatan</span>{inv.catatan}</div>}
        </div>
        <table className="inv-tot">
          <tbody>
            {(inv.diskon > 0 || inv.pajak > 0) && <tr><td>Subtotal</td><td>{rp(inv.subtotal)}</td></tr>}
            {inv.diskon > 0 && <tr><td>Diskon</td><td>({rp(inv.diskon)})</td></tr>}
            {inv.pajak > 0 && <tr><td>DPP</td><td>{rp(dpp)}</td></tr>}
            {inv.pajak > 0 && <tr><td>PPN {inv.ppn_tarif}%</td><td>{rp(inv.pajak)}</td></tr>}
            <tr className="grand"><td>Total</td><td>Rp {rp(inv.total)}</td></tr>
            {paidSum > 0 && inv.status === 'posted' && <tr><td>Sudah dibayar</td><td>({rp(paidSum)})</td></tr>}
            {paidSum > 0 && inv.status === 'posted' && <tr className="grand"><td>Sisa tagihan</td><td>Rp {rp(inv.sisa)}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="inv-foot">
        <div>{s.invoice_catatan}</div>
        <div className="inv-sign">
          <div>Hormat kami,</div>
          <div className="inv-sign-space" />
          <b>{s.invoice_ttd_nama || c.nama}</b>
          {s.invoice_ttd_jabatan && <div>{s.invoice_ttd_jabatan}</div>}
        </div>
      </div>
    </div>
  )
}

/**
 * Cetak satu dokumen saja (bukan seluruh halaman). Isi dipasang di luar #root lewat portal,
 * judul tab diganti nomor dokumen supaya nama file "Simpan sebagai PDF" otomatis sesuai.
 */
export function usePrintDoc() {
  const [node, setNode] = useState<ReactNode>(null)
  const [title, setTitle] = useState('')
  useEffect(() => {
    if (!node) return
    const old = document.title
    document.title = title
    document.body.classList.add('printing-doc')
    const done = () => { document.body.classList.remove('printing-doc'); document.title = old; setNode(null) }
    window.addEventListener('afterprint', done, { once: true })
    const t = setTimeout(() => window.print(), 50)
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done) }
  }, [node, title])
  const print = (n: ReactNode, docTitle: string) => { setTitle(docTitle.replace(/[\\/:*?"<>|]/g, '-')); setNode(n) }
  const portal = node ? createPortal(<div id="print-area">{node}</div>, document.body) : null
  return { print, portal }
}
