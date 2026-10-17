export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="21" fill="none" stroke="#66D8C1" strokeWidth="2.4" />
      <path d="M12 36c7-7 13-2 20 0s13 7 20 0" fill="none" stroke="#D2AF75" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="22" cy="23" r="2.2" fill="#F3F0E7" />
      <circle cx="41" cy="21" r="2.2" fill="#F3F0E7" />
      <circle cx="46" cy="42" r="2.2" fill="#F3F0E7" />
    </svg>
  )
}
