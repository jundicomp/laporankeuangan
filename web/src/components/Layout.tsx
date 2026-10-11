import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../auth/session'
import { tglID } from '../lib/format'
import { loadImage, trimImage } from '../lib/image'
import { NAV, type NavItem } from '../nav'
import { APP_NAME, APP_VERSION, CHANGELOG, CHANGE_LABEL, type ChangeType } from '../version'
import { Modal } from './ui'

export function useVisibleNav() {
  const { can, modOn } = useSession()
  return NAV.filter((n) => can(n.perm) && modOn(n.module))
}

type Group = { title: string; items: NavItem[] }

/** Kelompokkan menu sesuai judul grup di nav.ts; item sebelum grup pertama (Dashboard) berdiri sendiri. */
function useGroups(): Group[] {
  const items = useVisibleNav()
  return useMemo(() => {
    const out: Group[] = []
    let title = ''
    NAV.forEach((n) => {
      if (n.group) title = n.group
      if (!items.includes(n)) return
      const last = out[out.length - 1]
      if (last && last.title === title) last.items.push(n)
      else out.push({ title, items: [n] })
    })
    return out
  }, [items])
}

/** Logo lama yang masih punya tepi putih dipotong otomatis saat tampil. */
function useTrimmedLogo(src?: string) {
  const [out, setOut] = useState({ src: src ?? '', wide: false })
  useEffect(() => {
    setOut({ src: src ?? '', wide: false })
    if (!src) return
    let alive = true
    trimImage(src).then(async (t) => {
      const im = await loadImage(t)
      if (alive) setOut({ src: t, wide: im.naturalWidth / im.naturalHeight > 1.35 })
    }).catch(() => { /* tampilkan aslinya */ })
    return () => { alive = false }
  }, [src])
  return out
}

const isMobile = () => window.matchMedia('(max-width: 860px)').matches
const readMini = () => { try { return localStorage.getItem('neraca.side') === 'mini' } catch { return false } }

export default function Layout() {
  const { boot, company, signOut } = useSession()
  const groups = useGroups()
  const loc = useLocation()
  const nav = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [sideOpen, setSideOpen] = useState(false)
  const [mini, setMini] = useState(readMini)
  const [log, setLog] = useState(false)
  const [tip, setTip] = useState<{ text: string; y: number } | null>(null)
  // label melayang saat sidebar ciut — posisinya fixed supaya tidak terpotong area gulir menu
  const showTip = (text: string) => (e: React.MouseEvent<HTMLElement>) => {
    if (!mini || isMobile()) return
    const r = e.currentTarget.getBoundingClientRect()
    setTip({ text, y: r.top + r.height / 2 })
  }
  const hideTip = () => setTip(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const match = (n: NavItem) => (n.path === '/' ? loc.pathname === '/' : loc.pathname === n.path || loc.pathname.startsWith(n.path + '/'))
  const activeGroup = groups.find((g) => g.items.some(match))?.title ?? ''
  const [openGroup, setOpenGroup] = useState(activeGroup)
  useEffect(() => { setOpenGroup(activeGroup); setSideOpen(false) }, [loc.pathname, activeGroup])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const toggleSide = () => {
    if (isMobile()) return setSideOpen((o) => !o)
    hideTip()
    setMini((m) => {
      try { localStorage.setItem('neraca.side', m ? 'full' : 'mini') } catch { /* tidak wajib */ }
      return !m
    })
  }

  const current = NAV.find(match)
  const initials = (s: string) => s.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'
  const logo = useTrimmedLogo(boot?.company.logo_url)
  const coName = company || boot?.company.nama || 'Perusahaan'

  const item = (n: NavItem) => (
    <NavLink key={n.path} to={n.path} end={n.path === '/'} className={({ isActive }) => `side-it ${isActive ? 'on' : ''}`}
      onMouseEnter={showTip(n.label)} onMouseLeave={hideTip} onClick={hideTip}>
      <span className="ic">{n.icon}</span>
      <span className="lbl">{n.label}</span>
      {n.step && <span className="soon" title={`Dibangun ${n.step}`}>•</span>}
    </NavLink>
  )

  return (
    <div className={`shell ${sideOpen ? 'side-open' : ''} ${mini ? 'mini' : ''}`}>
      <aside className="side">
        <div className="side-brand" onMouseEnter={showTip(coName)} onMouseLeave={hideTip}>
          <span className={`side-mark ${logo.src ? 'img' : ''} ${logo.wide ? 'wide' : ''}`}>{logo.src ? <img src={logo.src} alt="" /> : initials(coName)}</span>
          <span className="side-name"><b>{coName}</b><small>Aplikasi Keuangan</small></span>
        </div>

        <nav className="side-nav">
          {groups.map((g) => {
            if (!g.title) return <div key="_" className="side-solo">{g.items.map(item)}</div>
            const open = mini || openGroup === g.title
            const hasActive = g.title === activeGroup
            return (
              <div key={g.title} className={`side-sec ${open ? 'open' : ''} ${hasActive ? 'has-on' : ''}`}>
                <button type="button" className="side-grp" onClick={() => setOpenGroup(openGroup === g.title ? '' : g.title)} aria-expanded={open}>
                  <span>{g.title}</span>
                  <span className="chev">›</span>
                </button>
                <div className="side-items"><div>{g.items.map(item)}</div></div>
              </div>
            )
          })}
        </nav>

        <button type="button" className="side-foot" onClick={() => { hideTip(); setLog(true) }} onMouseEnter={showTip(`${APP_NAME} v${APP_VERSION} · riwayat update`)} onMouseLeave={hideTip}>
          <span className="ver-dot" />
          <span className="lbl"><b>{APP_NAME}</b> v{APP_VERSION}<small>Riwayat update</small></span>
          <span className="ver-mini">v{APP_VERSION.split('.').slice(0, 2).join('.')}</span>
        </button>
      </aside>
 {tip && <div className="side-tip" style={{ top: tip.y }}>{tip.text}</div>}
      <div className="side-scrim" onClick={() => setSideOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className={`burger ${mini ? 'is-mini' : ''}`} onClick={toggleSide} aria-label={mini ? 'Lebarkan menu' : 'Ciutkan menu'} title={mini ? 'Lebarkan menu' : 'Ciutkan menu'}>
            <i /><i /><i />
          </button>
          <div className="crumb">{current?.label ?? (loc.pathname === '/profil' ? 'Profil' : '')}</div>
          <div className="top-right" ref={menuRef}>
            <button className="avatar" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu akun">{initials(boot?.user.nama ?? '?')}</button>
            {menuOpen && (
              <div className="dropdown">
                <div className="dd-head">
                  <b>{boot?.user.nama}</b>
                  <span>@{boot?.user.username} · {boot?.user.role_nama}</span>
                </div>
                <button onClick={() => { setMenuOpen(false); nav('/profil') }}>Profil & password</button>
                <button onClick={() => signOut()}>Keluar</button>
              </div>
            )}
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      {log && <ChangelogModal onClose={() => setLog(false)} />}
    </div>
  )
}

function ChangelogModal({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(CHANGELOG[0]?.version ?? '')
  const [type, setType] = useState<ChangeType | ''>('')
  const count = (t: ChangeType) => CHANGELOG.reduce((s, r) => s + r.changes.filter((c) => c.type === t).length, 0)
  return (
    <Modal title={`${APP_NAME} — Aplikasi Keuangan`} sub={`Versi ${APP_VERSION} · riwayat update`} onClose={onClose}
      footer={<button className="btn primary" onClick={onClose}>Tutup</button>}>
      <div className="cl-filter">
        <button className={type === '' ? 'on' : ''} onClick={() => setType('')}>Semua</button>
        {(Object.keys(CHANGE_LABEL) as ChangeType[]).map((t) => (
          <button key={t} className={`t-${t} ${type === t ? 'on' : ''}`} onClick={() => setType(type === t ? '' : t)}>{CHANGE_LABEL[t]} · {count(t)}</button>
        ))}
      </div>
      <div className="cl-list">
        {CHANGELOG.map((r, i) => {
          const changes = r.changes.filter((c) => !type || c.type === type)
          if (!changes.length) return null
          const isOpen = !!type || open === r.version
          return (
            <div key={r.version} className={`cl-rel ${isOpen ? 'open' : ''}`}>
              <button className="cl-head" onClick={() => setOpen(open === r.version ? '' : r.version)}>
                <b className="mono">v{r.version}</b>
                {i === 0 && <span className="pill g">terbaru</span>}
                <span className="cl-title">{r.title}</span>
                <span className="cl-date">{tglID(r.date)}</span>
                <span className="cl-types">
                  {(Object.keys(CHANGE_LABEL) as ChangeType[]).map((t) => {
                    const n = r.changes.filter((c) => c.type === t).length
                    return n ? <span key={t} className={`cl-badge t-${t}`} title={CHANGE_LABEL[t]}>{n}</span> : null
                  })}
                </span>
              </button>
              {isOpen && (
                <ul>
                  {changes.map((c, j) => <li key={j}><span className={`cl-tag t-${c.type}`}>{CHANGE_LABEL[c.type]}</span>{c.text}</li>)}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
