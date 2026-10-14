// src/lib/useRolls.js — later calls to roll an open call into (/positions/{id}/rolls),
// shared by the card that shows the best one and the dialog that lists them all.
// Kept for a minute; forgotten when a call changes.
import { useEffect, useState } from 'react'
import { apiError, getRolls } from '../api/client'

const FRESH = 60 * 1000
const found = new Map()   // position id -> { promise, data }

export function forgetRolls() { found.clear() }

function load(id) {
  let entry = found.get(id)
  if (!entry) {
    entry = { data: null }
    entry.promise = getRolls(id).then(r => (entry.data = r.data))
    found.set(id, entry)
    entry.promise.then(
      () => setTimeout(() => { if (found.get(id) === entry) found.delete(id) }, FRESH),
      () => { if (found.get(id) === entry) found.delete(id) },
    )
  }
  return entry.promise
}

// Returns { data, loading, error } for the open call with this id (null: nothing to load)
export function useRolls(id) {
  const [result, setResult] = useState(() => {
    const data = id != null ? found.get(id)?.data : null
    return data ? { id, data, error: null } : { id: null, data: null, error: null }
  })
  useEffect(() => {
    if (id == null || result.id === id) return
    let live = true
    load(id)
      .then(data => { if (live) setResult({ id, data, error: null }) })
      .catch(e => { if (live) setResult({ id, data: null, error: apiError(e, "Couldn't look for rolls. Is the API running?") }) })
    return () => { live = false }
  }, [id, result.id])
  const current = result.id === id
  return { data: current ? result.data : null, loading: id != null && !current, error: current ? result.error : null }
}
