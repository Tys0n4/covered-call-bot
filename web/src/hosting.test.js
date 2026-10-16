// Vercel serves the app: every path opens it (links in Discord alerts go to /positions),
// and the security headers stay strict enough to forbid inline scripts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const header = key => vercel.headers.flatMap(h => h.headers).find(h => h.key === key)?.value

describe('hosting', () => {
  it('opens the app on every path, so links and refreshes never 404', () => {
    expect(vercel.rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' })
  })

  it('allows only scripts from the site itself', () => {
    const csp = header('Content-Security-Policy')
    const scripts = csp.split(';').map(s => s.trim()).find(s => s.startsWith('script-src'))
    expect(scripts).toBe("script-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain('connect-src')
  })

  it('has no inline scripts in the page (they would be blocked)', () => {
    const tags = page.match(/<script\b[^>]*>/g) || []
    expect(tags.length).toBeGreaterThan(0)
    for (const tag of tags) expect(tag).toMatch(/\ssrc=/)
  })

  it('refuses to be framed or sniffed', () => {
    expect(header('X-Frame-Options')).toBe('DENY')
    expect(header('X-Content-Type-Options')).toBe('nosniff')
  })
})
