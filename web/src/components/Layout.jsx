// src/components/Layout.jsx — top bar on bigger screens; five tabs along the bottom on phones
import { Link, NavLink } from 'react-router-dom'
import { Briefcase, House, ScanLine, SlidersHorizontal, TrendingUp } from 'lucide-react'
import { Logo, MarketStatus } from './ui'
import WakingNotice from './WakingNotice'

// The workflow: see where you stand, find a trade, look after it, see how it went
const NAV = [
  { to: '/',            label: 'Home',        icon: House },
  { to: '/scanner',     label: 'Scanner',     icon: ScanLine },
  { to: '/positions',   label: 'Positions',   icon: Briefcase },
  { to: '/performance', label: 'Performance', icon: TrendingUp },
]
const STRATEGY = { to: '/strategy', label: 'Strategy', icon: SlidersHorizontal }

export default function Layout({ children }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 hidden border-b border-line bg-bg/90 backdrop-blur-md md:block">
        <div className="mx-auto flex min-h-16 max-w-[1160px] items-center gap-7 px-6">
          <Link to="/" className="flex items-center gap-2.5 font-display text-22 font-medium text-fg">
            <Logo /> CovCall
          </Link>
          {/* The page you're on is underlined in the ink color (gold is kept for money) */}
          <nav aria-label="Main" className="flex gap-1 self-stretch">
            {NAV.map(({ to, label }) => (
              <NavLink key={to} to={to} end={to === '/'}
                className={({ isActive }) => `flex items-center border-b-2 px-3 text-15 ${isActive ? 'border-fg font-semibold text-fg' : 'border-transparent font-medium text-fg-2 hover:text-fg'}`}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <MarketStatus />
            <NavLink to={STRATEGY.to}
              className={({ isActive }) => `inline-flex min-h-11 items-center gap-2 rounded-sm px-3.5 text-15 ${isActive ? 'bg-surface font-semibold text-fg' : 'font-medium text-fg-2 hover:text-fg'}`}>
              <SlidersHorizontal size={18} strokeWidth={1.9} aria-hidden="true" /> Strategy
            </NavLink>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1160px] px-4 pt-4 pb-[calc(104px+env(safe-area-inset-bottom))] md:px-6 md:pt-10 md:pb-12">
        <WakingNotice />
        {children}
        <footer className="mt-16 border-t border-line pt-5 text-12 text-muted">
          Prices from Cboe, delayed about 15 minutes. CovCall tracks your trades; it doesn't place orders with your broker.
        </footer>
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-bg px-1 pt-1.5 pb-[calc(10px+env(safe-area-inset-bottom))] md:hidden">
        {[...NAV, STRATEGY].map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) => `relative flex min-h-13 flex-1 flex-col items-center justify-center gap-1 text-11 ${isActive ? 'font-semibold text-fg' : 'font-medium text-muted'}`}>
            {({ isActive }) => <>
              {isActive && <span className="absolute -top-1.5 h-0.5 w-7 rounded-full bg-fg" aria-hidden="true" />}
              <Icon size={22} strokeWidth={isActive ? 2.1 : 1.75} aria-hidden="true" />{label}
            </>}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
