import { describe, expect, it } from 'vitest'
import { bedRoom, bedSlot, heightAt, inWater, POND, pondDist, slots } from './layout'

describe('slots', () => {
  it('keeps 30 lotuses apart and in the water', () => {
    const s = slots(30)
    expect(s).toHaveLength(30)
    for (let i = 0; i < s.length; i++) {
      expect(pondDist(s[i].x, s[i].z)).toBeLessThan(-0.1)
      for (let k = 0; k < i; k++) expect(Math.hypot(s[i].x - s[k].x, s[i].z - s[k].z)).toBeGreaterThan(0.75)
    }
  })

  it('adds flowers without moving the ones already planted', () => {
    expect(slots(30).slice(0, 12)).toEqual(slots(12))
  })
})

it('keeps a dragged flower in the water', () => {
  const [x, z] = inWater(30, 30)
  expect(pondDist(x, z)).toBeLessThan(0)
})

it('levels the lawn at the bank', () => {
  expect(Math.abs(heightAt(POND.x + POND.rx * 0.94, POND.z))).toBeLessThan(0.05)
})

const LAWN = ['shrub', 'blossom', 'chrysanthemum', 'iris', 'lily', 'jasmine', 'daisy', 'nemophila']
const full = LAWN.flatMap((kind) => Array.from({ length: bedRoom(kind) }, (_, k) => bedSlot(kind, k)))

describe('bedSlot', () => {
  it('plants every bed on the lawn, clear of the bank', () => {
    expect(full.length).toBeGreaterThanOrEqual(60)
    for (const s of full) expect(pondDist(s.x, s.z)).toBeGreaterThanOrEqual(0.279)
  })

  it('never stacks two plants when the beds are full', () => {
    for (let i = 0; i < full.length; i++)
      for (let k = 0; k < i; k++) expect(Math.hypot(full[i].x - full[k].x, full[i].z - full[k].z)).toBeGreaterThan(0.3)
  })

  it('starts every kind by the pond, so a few flowers are already a planting', () => {
    // The heart: the pond's right bank and the border just behind it.
    for (const kind of LAWN.filter((k) => k !== 'lily' && k !== 'jasmine')) {
      const s = bedSlot(kind, 0)
      expect(Math.hypot(s.x - 1, s.z - 1.5), kind).toBeLessThan(6.5)
    }
  })

  it('fills a group before starting the next', () => {
    const first = bedSlot('iris', 0)
    for (let k = 1; k < 3; k++) expect(Math.hypot(bedSlot('iris', k).x - first.x, bedSlot('iris', k).z - first.z)).toBeLessThan(1.2)
    expect(Math.hypot(bedSlot('iris', 3).x - first.x, bedSlot('iris', 3).z - first.z)).toBeGreaterThan(3)
  })
})
