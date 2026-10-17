// 단색 선형 SVG 아이콘 모음 — 텍스트 라벨과 함께 쓴다.
const paths: Record<string, string> = {
  move: 'M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3',
  draw: 'M4 20l4-1 11-11-3-3L5 16l-1 4zM14 7l3 3',
  polyline: 'M3 17l6-8 5 5 7-10M3 17h.01M9 9h.01M14 14h.01M21 4h.01',
  undo: 'M9 14l-4-4 4-4M5 10h9a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l4-4-4-4M19 10h-9a5 5 0 0 0 0 10h3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  check: 'M5 12l5 5L20 7',
  close: 'M6 6l12 12M18 6L6 18',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  play: 'M7 5v14l11-7z',
  pause: 'M8 5v14M16 5v14',
  rewind: 'M18 5v14L8 12zM6 5v14',
  evidence: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  sound: 'M4 10v4h4l5 4V6l-5 4zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12',
  soundOff: 'M4 10v4h4l5 4V6l-5 4zM17 9l4 6M21 9l-4 6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5M11 18l-6-6 6-6',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  users: 'M16 19v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 19v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2',
  expand: 'M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5',
  compress: 'M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10 6.5A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6M6.5 8.5A16 16 0 0 0 2 12s4 7 10 7a9 9 0 0 0 3-.5M9.9 9.9a3 3 0 0 0 4.2 4.2',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM18 18h3v3h-3zM6 6h1v1H6zM17 6h1v1h-1zM6 17h1v1H6z',
  copy: 'M9 9h11v11H9zM4 15V4h11',
  print: 'M6 9V3h12v6M6 18H3v-7h18v7h-3M6 14h12v7H6z',
  warning: 'M12 3l10 18H2zM12 10v4M12 17h.01',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  volcano: 'M3 20h18L15 8h-2l-1 3-1-3H9z',
  quake: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  plate: 'M3 15c3-5 6 5 9 0s6-5 9 0',
  keyboard: 'M2 7h20v10H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8',
  home: 'M3 11l9-8 9 8v10h-6v-6H9v6H3z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  compare: 'M12 3v18M4 7h5l-2 10H2zM15 7h5l2 10h-7z',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  stop: 'M6 6h12v12H6z',
  next: 'M5 4l10 8-10 8zM19 4v16',
  prev: 'M19 4L9 12l10 8zM5 4v16',
}

export type IconName = keyof typeof paths

export function Icon({ name, size, className, title }: { name: IconName; size?: number; className?: string; title?: string }) {
  const d = paths[name]
  const style = size ? { width: size, height: size } : undefined
  return (
    <svg className={'icon' + (className ? ' ' + className : '')} style={style} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} focusable="false">
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  )
}
