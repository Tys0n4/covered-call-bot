// src/components/Skeleton.jsx — grey placeholder shapes in the page's layout
// while data loads, so the page doesn't jump when it arrives.

export function Bone({ w = '100%', h = 14, r = 8, style }) {
  return <span className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />
}

// Wraps placeholders; screen readers hear "Loading…" instead of empty shapes
export function Loading({ children }) {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">Loading…</span>
      <div aria-hidden="true">{children}</div>
    </div>
  )
}

function StatCard({ big = false }) {
  return (
    <div className="card">
      <Bone w={110} h={12} />
      <Bone w={big ? 180 : 70} h={30} style={{ marginTop: 14 }} />
      <Bone w={big ? '70%' : 120} h={12} style={{ marginTop: 14 }} />
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <Loading>
      <div className="card" style={{ marginBottom: 20 }}>
        <Bone w={140} h={16} />
        {[0, 1].map(i => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
            <Bone w={32} h={32} r={10} /><Bone w="45%" /><span style={{ flex: 1 }} /><Bone w={70} />
          </div>
        ))}
      </div>
      <div className="grid-stats" style={{ marginBottom: 32 }}><StatCard big /><StatCard /><StatCard /></div>
      <Bone w={110} h={16} style={{ marginBottom: 14 }} />
      <div className="card" style={{ padding: 0 }}>
        {[0, 1, 2].map(i => (
          <div key={i} className="stock-row">
            <div className="stock-name"><Bone w={64} h={26} /><Bone w={150} h={12} /></div>
            <div className="stock-bar"><Bone w={150} h={12} style={{ marginBottom: 8 }} /><Bone h={8} /></div>
            <div className="stock-num"><Bone w={80} h={14} /></div>
            <div className="stock-actions"><Bone w={80} h={30} r={10} /></div>
          </div>
        ))}
      </div>
    </Loading>
  )
}

export function PositionsSkeleton() {
  return (
    <Loading>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[0, 1, 2].map(i => (
          <div key={i} className="card">
            <div className="grid-split">
              <div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}><Bone w={46} h={22} /><Bone w={64} h={22} r={99} /></div>
                <Bone w="60%" h={20} style={{ marginBottom: 10 }} />
                <Bone w="80%" h={13} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}><Bone w={120} h={24} r={99} /><Bone w={90} h={13} /></div>
                <Bone h={6} style={{ marginBottom: 12 }} />
                <Bone w="70%" h={13} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Loading>
  )
}

export function PerformanceSkeleton() {
  return (
    <Loading>
      <div className="grid-3" style={{ marginBottom: 16 }}><StatCard /><StatCard /><StatCard /></div>
      <div className="grid-3" style={{ marginBottom: 32 }}><StatCard /><StatCard /><StatCard /></div>
      <Bone w={130} h={16} style={{ marginBottom: 12 }} />
      <div className="card" style={{ height: 260, display: 'flex', alignItems: 'flex-end', gap: '8%', padding: '24px 40px' }}>
        {[45, 70, 85, 25].map((h, i) => <Bone key={i} w="14%" h={`${h}%`} r={6} />)}
      </div>
    </Loading>
  )
}
