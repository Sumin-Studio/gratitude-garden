// The pad's icons, drawn like the tune panel's: 16 px, 1.4 px round strokes.

const icon = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export const Plus = () => (
  <svg {...icon} strokeWidth={1.8}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
)

export const Close = () => (
  <svg {...icon}>
    <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
  </svg>
)

export const Play = ({ size = 10 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
    <path d="M2.5 1.4v7.2a.5.5 0 0 0 .76.43l5.9-3.6a.5.5 0 0 0 0-.86l-5.9-3.6a.5.5 0 0 0-.76.43Z" fill="currentColor" />
  </svg>
)

export const Pause = ({ size = 10 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
    <rect x="2" y="1.5" width="2.2" height="7" rx="0.8" fill="currentColor" />
    <rect x="5.8" y="1.5" width="2.2" height="7" rx="0.8" fill="currentColor" />
  </svg>
)

// The board's tools.

export const TextTool = () => (
  <svg {...icon}>
    <path d="M3.5 4V3h9v1M8 3v10M6 13h4" />
  </svg>
)

export const DrawTool = () => (
  <svg {...icon}>
    <path d="M10.8 2.9a1.6 1.6 0 0 1 2.3 2.3l-7.6 7.6-3 .7.7-3 7.6-7.6ZM9.6 4.1l2.3 2.3" />
  </svg>
)

export const ImageTool = () => (
  <svg {...icon}>
    <rect x="2.5" y="3" width="11" height="10" rx="2" />
    <circle cx="6" cy="6.5" r="1.1" />
    <path d="m3 11.5 3.2-3.1 2.4 2.2 1.8-1.6 3.1 2.8" />
  </svg>
)

export const VoiceTool = () => (
  <svg {...icon}>
    <rect x="6" y="2.2" width="4" height="7.4" rx="2" />
    <path d="M3.8 7.8a4.2 4.2 0 0 0 8.4 0M8 12v1.8" />
  </svg>
)

export const VideoTool = () => (
  <svg {...icon}>
    <rect x="2" y="4" width="8.5" height="8" rx="2" />
    <path d="m10.5 7 3.5-2v6l-3.5-2" />
  </svg>
)

export const Lock = () => (
  <svg {...icon}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" />
    <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
  </svg>
)
