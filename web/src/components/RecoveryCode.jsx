// src/components/RecoveryCode.jsx — the recovery code, shown once: it's how you set a new
// password if you forget yours (there's no email). The box (copy, save as a file) is shared
// by the screen after sign-up and the "Make a new one" dialog on Strategy.
import { useEffect, useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { Logo } from './ui'

function saveAsFile(code, email) {
  const text = `CovCall recovery code${email ? ` for ${email}` : ''}: ${code}\n\n`
    + 'If you forget your password, choose "Forgot password?" on the CovCall login screen and enter this code.\n'
    + 'It works once; you get a new one when you use it.\n'
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: 'covcall-recovery-code.txt' })
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

export function RecoveryCodeBox({ code, email }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true) } catch { /* the code is on screen to copy by hand */ }
  }
  return (
    <div className="rounded-card bg-surface p-5 text-center">
      <div className="font-mono text-22 font-semibold tracking-[0.06em] select-all" aria-label={`Recovery code ${code.split('').join(' ')}`}>{code}</div>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-secondary flex-1" onClick={copy}>
          {copied ? <><Check size={16} strokeWidth={2.4} /> Copied</> : <><Copy size={16} strokeWidth={2} /> Copy</>}
        </button>
        <button type="button" className="btn btn-secondary flex-1" onClick={() => saveAsFile(code, email)}>
          <Download size={16} strokeWidth={2} /> Save as a file
        </button>
      </div>
    </div>
  )
}

export function RecoveryCodeNotes() {
  return (
    <ul className="mt-4 list-disc pl-5 text-13 text-fg-2">
      <li>It works once. Using it gives you a new one.</li>
      <li>CovCall only keeps a scrambled copy, so it can't show you this code again. You can make a new one in Strategy › Account and security.</li>
    </ul>
  )
}

// Full screen, before the app: after sign-up, at the first login of an older account, and after
// using a code to set a new password. Continue waits for "I saved it".
export default function RecoveryCodeScreen({ code, email, kicker, onDone }) {
  const [saved, setSaved] = useState(false)
  useEffect(() => { document.title = 'Save your recovery code · CovCall' }, [])
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="page flex w-full max-w-[400px] flex-col" aria-labelledby="code-h">
        <Logo size={44} />
        <div className="mt-6 text-12 font-semibold uppercase tracking-wide text-muted">{kicker}</div>
        <h1 id="code-h" className="mt-1.5 font-display text-28 font-medium">Save your recovery code</h1>
        <p className="mt-2.5 text-15 text-fg-2">
          If you ever forget your password, this code lets you set a new one. Keep it somewhere safe, like a password manager.
        </p>
        <div className="mt-6"><RecoveryCodeBox code={code} email={email} /></div>
        <RecoveryCodeNotes />
        <label className="mt-5 flex min-h-11 cursor-pointer items-center gap-3 text-15">
          <input type="checkbox" className="h-5 w-5 accent-[var(--text)]" checked={saved} onChange={e => setSaved(e.target.checked)} />
          I saved it somewhere safe
        </label>
        <button type="button" className="btn btn-primary btn-block mt-3" disabled={!saved} onClick={onDone}>Continue</button>
      </section>
    </div>
  )
}
