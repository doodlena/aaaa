/** Small inline SVG icon set (no icon font / external requests). Icons are decorative unless `label` is given. */
const PATHS: Record<string, string> = {
  check: 'M4 12.5l5 5L20 6.5',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  question: 'M8.5 8.5a3.5 3.5 0 1 1 5 3.2c-.9.4-1.5 1.2-1.5 2.2V15M12 19.5v.01',
  cross: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 4l9 16H3zM12 10v4m0 3v.1',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h2M18 9v6a4 4 0 0 1-4 4h-2',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
  filter: 'M4 6h16M7 12h10M10 18h4',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  calendar: 'M4 7h16v13H4zM4 11h16M8 3v4M16 3v4',
  locate: 'M12 2v3M12 19v3M2 12h3M19 12h3M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20',
  wheelchair: 'M11 4.5a1.5 1.5 0 1 0 0-.01M10 8v6h6l3 5M10 11h5M7.5 12.5A5 5 0 1 0 14 18',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6m0-9.5v.1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5',
  close: 'M6 6l12 12M18 6L6 18',
  arrowLeft: 'M19 12H5m6-6l-6 6 6 6',
  store: 'M4 9l1.5-5h13L20 9M4 9h16M4 9v11h16V9M9 20v-6h6v6',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  share: 'M12 15V3m0 0L8 7m4-4l4 4M5 12v8h14v-8',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  bag: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5v.01',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  wifiOff: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M19 13a10 10 0 0 0-2.3-1.6M2 9.5a15 15 0 0 1 4.5-2.8M22 9.5A15 15 0 0 0 11 5.1M12 20h.01',
  plus: 'M12 5v14M5 12h14',
  truck: 'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  // needs
  basket: 'M3 10h18l-2 10H5zM7 10l4-6M17 10l-4-6M9 14v3M15 14v3M12 14v3',
  bowl: 'M3 12h18a9 9 0 0 1-18 0zM9 8c0-1.5 1-1.5 1-3M14 8c0-1.5 1-1.5 1-3',
  baby: 'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM6 21c0-3.5 2.7-6 6-6s6 2.5 6 6M10.5 7.5h.01M13.5 7.5h.01',
  document: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  health: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z',
  heart: 'M12 20s-8-4.7-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.3 12 20 12 20z',
  home: 'M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-6h4v6',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6.5v1.5M12 16v1.5',
  shirt: 'M8 3l-5 3 2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z',
  scale: 'M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z',
  book: 'M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2zM4 20a2 2 0 0 0 2 1h13v-3',
  family: 'M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3 21v-5a5 5 0 0 1 10 0v5M13 21v-3.5a4 4 0 0 1 8 0V21',
  paw: 'M7 10.5a1.6 1.6 0 1 0 0-.01M10.3 6.8a1.6 1.6 0 1 0 0-.01M13.7 6.8a1.6 1.6 0 1 0 0-.01M17 10.5a1.6 1.6 0 1 0 0-.01M12 12.5c-2.8 0-4.8 3.3-4.8 5.1 0 1.5 1.6 2.1 4.8 2.1s4.8-.6 4.8-2.1c0-1.8-2-5.1-4.8-5.1z',
  bus: 'M5 4h14v13H5zM5 11h14M8 20v-3M16 20v-3M8 14h.01M16 14h.01',
  lifebuoy: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6',
  message: 'M4 5h16v11H9l-5 4z',
  key: 'M8 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM11.5 11H21M18 11v3M15 11v2',
};

export type IconName = keyof typeof PATHS | string;

export function Icon({ name, size = 18, label, className }: { name: keyof typeof PATHS | string; size?: number; label?: string; className?: string }) {
  return (
    <svg
      className={`icon ${className || ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      <path d={PATHS[name] || PATHS.info} />
    </svg>
  );
}
