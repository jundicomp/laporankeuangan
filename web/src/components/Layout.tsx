import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../auth/session'
import { NAV } from '../nav'

export function useVisibleNav() {
  const { can, modOn } = useSession()
  return NAV.filter((n) => can(n.perm) && modOn(n.module))
}

export default function Layout() {
  const { boot, company, signOut } = useSession()
  const items = useVisibleNav()
  const loc = useLocation()
  const nav = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [sideOpen, setSideOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => setSideOpen(false), [loc.pathname])
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  // label grup ikut item pertama yang terlihat di grup itu
  let group = ''
  const rows = items.map((n) => {
    const src = NAV.slice(0, NAV.indexOf(n) + 1).reverse().find((x) => x.group)?.group ?? ''
    const showGroup = src && src !== group
    group = src
    return { n, showGroup: showGroup ? src : '' }
  })

  const current = NAV.find((n) => n.path === loc.pathname) ?? NAV.find((n) => n.path !== '/' && loc.pathname.startsWith(n.path + '/'))
  const initials = (boot?.user.nama ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className={`shell ${sideOpen ? 'side-open' : ''}`}>
      <aside className="side">
        <div className="side-logo"><b>N</b>Neraca</div>
        <div className="side-co">
          {company || 'Perusahaan'}
          <span>{boot?.user.role_nama}</span>
        </div>
        <nav>
          {rows.map(({ n, showGroup }) => (
            <div key={n.path}>
              {showGroup && <div className="side-grp">{showGroup}</div>}
              <NavLink to={n.path} end={n.path === '/'} className={({ isActive }) => `side-it ${isActive ? 'on' : ''}`}>
                <span className="ic">{n.icon}</span>
                {n.label}
                {n.step && <span className="soon" title={`Dibangun di ${n.step}`}>•</span>}
              </NavLink>
            </div>
          ))}
        </nav>
      </aside>
      <div className="side-scrim" onClick={() => setSideOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="burger" onClick={() => setSideOpen(true)} aria-label="Buka menu">☰</button>
          <div className="crumb">{current?.label ?? (loc.pathname === '/profil' ? 'Profil' : '')}</div>
          <div className="top-right" ref={menuRef}>
            <button className="avatar" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu akun">{initials}</button>
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
    </div>
  )
}
