export function LogoMark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="2" y="2" width="9" height="9" rx="2.2" fill="#9085e9" />
      <rect x="13" y="2" width="9" height="9" rx="2.2" fill="#b3a8ff" />
      <rect x="2" y="13" width="9" height="9" rx="2.2" fill="#4a3fa0" />
      <rect x="13" y="13" width="9" height="9" rx="2.2" fill="#ededef" />
    </svg>
  )
}
