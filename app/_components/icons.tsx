// Icon library ported from the design's components.jsx. Stroke 1.7, 24x24
// viewBox, currentColor — sized via the `size` prop (default 16).

import type { SVGProps } from 'react'

type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, 'children'> & {
  children?: React.ReactNode
}

function Icon({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

export type SimpleIconProps = { size?: number; className?: string }

export const Icons = {
  radar: (p: SimpleIconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <path d="M12 12 19 5" />
    </Icon>
  ),
  grid: (p: SimpleIconProps) => (
    <Icon {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  ),
  compass: (p: SimpleIconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5 13 13l-4.5 2.5L11 11z" />
    </Icon>
  ),
  scan: (p: SimpleIconProps) => (
    <Icon {...p}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M3 12h18" />
    </Icon>
  ),
  alert: (p: SimpleIconProps) => (
    <Icon {...p}>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </Icon>
  ),
  sparkles: (p: SimpleIconProps) => (
    <Icon {...p}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2" />
    </Icon>
  ),
  wrench: (p: SimpleIconProps) => (
    <Icon {...p}>
      <path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L4 17l3 3 5.5-5.5a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.5-.6-.6-2.5z" />
    </Icon>
  ),
  dots: (p: SimpleIconProps) => (
    <Icon {...p}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Icon>
  ),
  ext: (p: SimpleIconProps) => (
    <Icon {...p}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Icon>
  ),
  up: (p: SimpleIconProps) => (
    <Icon {...p}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </Icon>
  ),
  chat: (p: SimpleIconProps) => (
    <Icon {...p}>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 21l1.9-4.1A8.4 8.4 0 1 1 21 11.5z" />
    </Icon>
  ),
  chev: (p: SimpleIconProps) => (
    <Icon {...p}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  ),
  x: (p: SimpleIconProps) => (
    <Icon {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
  ),
  plus: (p: SimpleIconProps) => (
    <Icon {...p}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  ),
  bolt: (p: SimpleIconProps) => (
    <svg
      width={p.size ?? 16}
      height={p.size ?? 16}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={p.className}
      aria-hidden="true"
    >
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z" />
    </svg>
  ),
  clock: (p: SimpleIconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  ),
  stop: (p: SimpleIconProps) => (
    <Icon {...p}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </Icon>
  ),
  menu: (p: SimpleIconProps) => (
    <Icon {...p}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icon>
  ),
  sun: (p: SimpleIconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </Icon>
  ),
  moon: (p: SimpleIconProps) => (
    <Icon {...p}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </Icon>
  ),
}

export function Spinner({ size = 14, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ animation: 'spin 0.8s linear infinite' }}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="rgba(255,255,255,0.3)"
        strokeWidth="3"
      />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
