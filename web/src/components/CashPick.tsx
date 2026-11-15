import { useEffect, useState } from 'react'
import { call } from '../api/client'
import { useSession } from '../auth/session'
import { rp } from '../lib/format'

export type CashAcc = { id: string; nama: string; jenis: string; akun_id: string; aktif: boolean; saldo: number | null }

/** Rekening kas/bank aktif. Saldo hanya tampil bila peran boleh melihat kas & bank. */
export function useCashAccounts() {
  const { boot, can } = useSession()
  const [list, setList] = useState<CashAcc[] | null>(null)
  useEffect(() => {
    const fallback = () => setList((boot?.kasbank ?? []).map((k) => ({ id: String(k.id), nama: String(k.nama), jenis: String(k.jenis), akun_id: String(k.akun_id), aktif: k.aktif !== false && String(k.aktif).toUpperCase() !== 'FALSE', saldo: null }))
      .filter((k) => k.aktif && (k.jenis !== 'bank' || can('bank.saldo'))))
    if (!can('kas.view')) { fallback(); return }
    call<CashAcc[]>('kasbank.list', {}).then((r) => setList(r.filter((k) => k.aktif))).catch(fallback)
  }, [boot, can])
  return list
}

export function CashSelect({ list, value, onChange }: { list: CashAcc[]; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— pilih rekening —</option>
      {list.map((k) => <option key={k.id} value={k.id}>{k.nama}{k.saldo !== null ? ` — saldo Rp ${rp(k.saldo)}` : ''}</option>)}
    </select>
  )
}

/** Alasan tombol simpan belum bisa dipakai karena saldo tunai kurang (bank boleh minus). */
export function cashShort(list: CashAcc[] | null, id: string, keluar: number) {
  const k = list?.find((x) => x.id === id)
  if (!k || k.jenis === 'bank' || k.saldo === null) return ''
  return keluar > k.saldo ? `Saldo ${k.nama} tidak cukup (Rp ${rp(k.saldo)}).` : ''
}
