// src/components/Skeleton.jsx — grey placeholder shapes in the page's layout
// while data loads, so the page doesn't jump when it arrives.
import { Bone } from './ui'

// Wraps placeholders; screen readers hear "Loading…" instead of empty shapes
export function Loading({ children }) {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">Loading…</span>
      <div aria-hidden="true">{children}</div>
    </div>
  )
}

const Rows = ({ n = 3 }) => Array.from({ length: n }, (_, i) => (
  <div key={i} className="flex items-center justify-between border-b border-line py-4">
    <div><Bone className="h-4 w-16" /><Bone className="mt-2 h-3 w-32" /></div>
    <Bone className="h-4 w-20" />
  </div>
))

export function DashboardSkeleton() {
  return (
    <Loading>
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_320px] md:gap-12">
        <div>
          <Bone className="h-4 w-28" />
          <Bone className="mt-3 h-11 w-52 md:h-14" />
          <Bone className="mt-3 h-4 w-64" />
          <div className="relative mt-6 h-[180px] md:h-[240px]"><Bone className="absolute inset-x-0 top-[70%] h-0.5" /></div>
          <div className="mt-8 flex gap-2"><Bone className="h-11 flex-1 rounded-full md:w-20 md:flex-none" /><Bone className="h-11 flex-1 rounded-full md:w-20 md:flex-none" /><Bone className="h-11 flex-1 rounded-full md:w-20 md:flex-none" /></div>
          <Bone className="mt-8 h-36 rounded-card md:hidden" />
          <div className="mt-10"><Rows n={3} /></div>
        </div>
        <div className="hidden md:block">
          <Bone className="h-64 rounded-card" />
          <Bone className="mt-10 h-4 w-28" />
          <Rows n={3} />
        </div>
      </div>
    </Loading>
  )
}

export function PositionsSkeleton() {
  return (
    <Loading>
      <Bone className="mb-3 h-4 w-40" />
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1].map(i => (
          <div key={i} className="rounded-card bg-surface p-5">
            <div className="flex justify-between"><Bone className="h-5 w-36" /><Bone className="h-5 w-12" /></div>
            <Bone className="mt-2 h-3 w-48" />
            <Bone className="mt-5 h-1.5" />
            <div className="mt-6 grid grid-cols-3 gap-3"><Bone className="h-9" /><Bone className="h-9" /><Bone className="h-9" /></div>
            <div className="mt-5 flex gap-2.5"><Bone className="h-12 flex-1 rounded-full" /><Bone className="h-12 flex-[2] rounded-full" /></div>
          </div>
        ))}
      </div>
      <Bone className="mt-8 h-4 w-28" />
      <Rows n={3} />
    </Loading>
  )
}

export function PerformanceSkeleton() {
  return (
    <Loading>
      <Bone className="h-4 w-48" />
      <Bone className="mt-3 h-11 w-56 md:h-14" />
      <Bone className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-10 flex h-[200px] items-end gap-4 border-b border-line md:h-[240px] md:max-w-[640px] md:gap-6">
        {[45, 74, 87, 18].map((h, i) => <Bone key={i} className="flex-1 rounded-b-none" style={{ height: `${h}%` }} />)}
      </div>
      <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map(i => <div key={i}><Bone className="h-3 w-24" /><Bone className="mt-2 h-6 w-28" /></div>)}
      </div>
    </Loading>
  )
}
