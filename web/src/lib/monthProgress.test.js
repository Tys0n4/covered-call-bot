import { describe, expect, it } from 'vitest'
import { monthProgress } from './monthProgress'

describe('monthProgress', () => {
  it('ahead of pace: kept more than the even share of the goal so far', () => {
    const p = monthProgress({ kept: 613.05, goal: 1500, month: '2026-10', today: '2026-10-08' })
    expect(p.state).toBe('ahead')
    expect(p.pace).toBeCloseTo(387.10, 2)
    expect(p.diff).toBeCloseTo(225.95, 2)
    expect(p.pct).toBe(41)
    expect(p.day).toBe(8)
    expect(p.days).toBe(31)
    expect(p.daysLeft).toBe(23)
    expect(p.monthName).toBe('October')
  })

  it('behind pace', () => {
    const p = monthProgress({ kept: 520, goal: 1500, month: '2026-10', today: '2026-10-20' })
    expect(p.state).toBe('behind')
    expect(p.diff).toBeCloseTo(-447.74, 2)
    expect(p.daysLeft).toBe(11)
  })

  it('goal reached, with how much over', () => {
    const p = monthProgress({ kept: 1670.45, goal: 1500, month: '2026-10', today: '2026-10-16' })
    expect(p.state).toBe('reached')
    expect(p.over).toBeCloseTo(170.45, 2)
    expect(p.goalFrac).toBe(1)
    expect(p.pct).toBe(111)
  })

  it('no goal: only the month, no pace', () => {
    const p = monthProgress({ kept: 613.05, goal: 0, month: '2026-10', today: '2026-10-08' })
    expect(p.state).toBe('none')
    expect(p.pace).toBeUndefined()
    expect(p.monthFrac).toBeCloseTo(8 / 31, 5)
  })

  it('a month that lost money draws an empty goal bar, not a negative one', () => {
    const p = monthProgress({ kept: -40, goal: 1500, month: '2026-10', today: '2026-10-08' })
    expect(p.goalFrac).toBe(0)
    expect(p.pct).toBe(0)
    expect(p.state).toBe('behind')
  })

  it("when the API's month and today's date disagree, it doesn't mix months", () => {
    expect(monthProgress({ kept: 0, goal: 1500, month: '2026-11', today: '2026-10-31' }).day).toBe(1)
    expect(monthProgress({ kept: 0, goal: 1500, month: '2026-10', today: '2026-11-01' }).day).toBe(31)
    expect(monthProgress({ kept: 0, goal: 1500, month: '2027-02', today: '2027-02-10' }).days).toBe(28)
  })
})
