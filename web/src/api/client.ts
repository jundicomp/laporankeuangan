/**
 * Klien API ke Apps Script Web App.
 *
 * Penting: body dikirim sebagai text/plain, BUKAN application/json.
 * Apps Script tidak bisa menjawab preflight (OPTIONS), jadi request harus
 * berupa "simple request" CORS. Isinya tetap JSON, dibaca server via
 * e.postData.contents.
 */

export type ApiOk<T> = { ok: true; data: T; ms: number }
export type ApiErr = { ok: false; error: { code: string; message: string }; ms: number }
export type ApiResult<T> = ApiOk<T> | ApiErr

const STORAGE_KEY = 'neraca.apiUrl'

export function getApiUrl(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return saved
  } catch {
    /* storage bisa diblokir — pakai env */
  }
  return import.meta.env.VITE_API_URL ?? ''
}

export function setApiUrl(url: string) {
  try {
    localStorage.setItem(STORAGE_KEY, url.trim())
  } catch {
    /* abaikan */
  }
}

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<{ data: T; serverMs: number; totalMs: number }> {
  const url = getApiUrl()
  if (!url) throw new ApiError('NO_URL', 'URL Apps Script belum diisi.')
  const t0 = performance.now()
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload }),
      redirect: 'follow',
    })
  } catch {
    throw new ApiError('NETWORK', 'Tidak bisa menghubungi server. Cek URL /exec dan akses Web App ("Anyone").')
  }
  const totalMs = Math.round(performance.now() - t0)
  let body: ApiResult<T>
  try {
    body = await res.json()
  } catch {
    throw new ApiError('BAD_RESPONSE', `Respons bukan JSON (HTTP ${res.status}). Biasanya karena URL salah atau Web App belum di-deploy ulang.`)
  }
  if (!body.ok) throw new ApiError(body.error.code, body.error.message)
  return { data: body.data, serverMs: body.ms, totalMs }
}
