export function RobotsMark({ size = 56 }: { size?: number }) {
  return (
    <div className="flex flex-col items-center gap-2" data-robots-logo="">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <rect x="30" y="4" width="4" height="11" rx="2" fill="#a9b8c6" />
        <circle cx="32" cy="5" r="4.5" fill="#2f6fdc" />
        <rect
          x="6"
          y="14"
          width="52"
          height="42"
          rx="13"
          fill="#fff"
          stroke="#c3cfda"
          strokeWidth="2.5"
        />
        <rect x="12" y="21" width="40" height="27" rx="9" fill="#1c2b39" />
        <circle cx="24" cy="34.5" r="4" fill="#7fb3ff" />
        <circle cx="40" cy="34.5" r="4" fill="#7fb3ff" />
      </svg>
      <span className="font-mono text-heading3 font-extrabold tracking-[-0.06em] text-foreground">
        robots
      </span>
    </div>
  );
}
