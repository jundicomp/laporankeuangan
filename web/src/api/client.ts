/**
 * Klien API ke Apps Script Web App.
 *
 * Body dikirim sebagai text/plain (bukan application/json) supaya browser tidak
 * mengirim preflight CORS — Apps Script tidak bisa menjawab OPTIONS.
 * Token sesi ikut di body, bukan header, dengan alasan yang sama.
 */

export type ApiErrorBody = { code: string; message: string }
type Envelope<T> = { ok: true; data: T; ms: number } | { ok: false; error: ApiErrorBody; ms: number }

const URL_KEY = 'neraca.apiUrl'
const TOKEN_KEY = 'neraca.token'

let token: string | null = null
let onAuthLost: (() => void) | null = null

function safeGet(store: Storage, k: string) {
  try {
    return store.getItem(k)
  } catch {
    return null
  }
}
function safeSet(store: Storage, k: string, v: string | null) {
  try {
    if (v === null) store.removeItem(k)
    else store.setItem(k, v)
  } catch {
    /* storage diblokir — tetap jalan di memori */
  }
}

export function getApiUrl(): string {
  return safeGet(localStorage, URL_KEY) || import.meta.env.VITE_API_URL || ''
}
export function setApiUrl(url: string) {
  safeSet(localStorage, URL_KEY, url.trim() || null)
}

/** Token disimpan di sessionStorage: hilang saat tab ditutup, tidak dibagi antar tab. */
export function getToken() {
  if (token === null) token = safeGet(sessionStorage, TOKEN_KEY)
  return token
}
export function setToken(t: string | null) {
  token = t
  safeSet(sessionStorage, TOKEN_KEY, t)
}
export function setAuthLostHandler(fn: () => void) {
  onAuthLost = fn
}

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const AUTH_LOST = new Set(['UNAUTHENTICATED', 'SESSION_EXPIRED'])

async function send<T>(body: object): Promise<{ data: T; serverMs: number; totalMs: number }> {
  const url = getApiUrl()
  if (!url) throw new ApiError('NO_URL', 'URL server belum diatur.')
  const t0 = performance.now()
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, token: getToken() ?? '' }),
      redirect: 'follow',
    })
  } catch {
    throw new ApiError('NETWORK', 'Tidak bisa menghubungi server. Periksa koneksi internet.')
  }
  const totalMs = Math.round(performance.now() - t0)
  let env: Envelope<T>
  try {
    env = await res.json()
  } catch {
    throw new ApiError('BAD_RESPONSE', `Respons server tidak terbaca (HTTP ${res.status}). Pastikan URL berakhiran /exec dan Web App sudah di-deploy ulang.`)
  }
  if (!env.ok) {
    if (AUTH_LOST.has(env.error.code)) onAuthLost?.()
    throw new ApiError(env.error.code, env.error.message)
  }
  return { data: env.data, serverMs: env.ms, totalMs }
}

/** Panggil satu aksi. */
export async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return (await send<T>({ action, payload })).data
}

/** Panggil satu aksi dan kembalikan juga waktu tempuh (untuk halaman diagnostik). */
export function callTimed<T>(action: string, payload: Record<string, unknown> = {}) {
  return send<T>({ action, payload })
}

export type BatchResult = { ok: true; data: unknown } | { ok: false; error: ApiErrorBody }

/** Banyak aksi dalam satu round-trip (±1 detik hemat per aksi). */
export async function batch(calls: { action: string; payload?: Record<string, unknown> }[]): Promise<BatchResult[]> {
  const results = (await send<BatchResult[]>({ action: 'batch', payload: { calls } })).data
  if (results.some((r) => !r.ok && AUTH_LOST.has(r.error.code))) onAuthLost?.()
  return results
}

export function errorText(e: unknown) {
  return e instanceof ApiError ? e.message : 'Terjadi kesalahan tak terduga.'
}
