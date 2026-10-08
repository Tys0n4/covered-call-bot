// src/lib/useWide.js — true on screens 768px and wider (the md breakpoint), where
// the top bar replaces the bottom tabs and editors open in place instead of in a sheet
import { useEffect, useState } from 'react'

const QUERY = '(min-width: 768px)'

export function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia?.(QUERY).matches ?? true)
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY)
    if (!mq) return
    const onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}
