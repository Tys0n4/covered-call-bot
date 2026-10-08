// src/components/PageHeader.jsx — the page title, with the page's buttons beside it
import { useEffect } from 'react'

// Name the browser tab after the page, so tabs, history and bookmarks differ
// eslint-disable-next-line react-refresh/only-export-components
export function usePageTitle(title) {
  useEffect(() => { document.title = title ? `${title} · CovCall` : 'CovCall' }, [title])
}

export default function PageHeader({ title, actions, children }) {
  usePageTitle(title)
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 md:mb-8">
      <h1 className="page-title">{title}</h1>
      {actions && <div className="-mr-2 flex items-center gap-1 md:mr-0 md:gap-2">{actions}</div>}
      {children}
    </div>
  )
}
