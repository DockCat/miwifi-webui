/**
 * Connection-type icons: Wi-Fi (four signal arcs above a dot) and
 * LAN/Ethernet (RJ45 jack). Inline SVGs inherit `currentColor` so they
 * follow text color in both themes.
 */

export interface ConnectionIconProps {
  /** Device connection type; anything non-wired renders the Wi-Fi icon. */
  connectionType?: string;
  size?: number;
  className?: string;
}

export function WifiIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      {/* Four-level signal strength: three arcs of increasing reach + base dot */}
      <path d="M2 8.5 C4.7 5.6 8.2 4 12 4 C15.8 4 19.3 5.6 22 8.5" />
      <path d="M5.5 12.2 C7.3 10.2 9.6 9 12 9 C14.4 9 16.7 10.2 18.5 12.2" />
      <path d="M9 15.9 C9.9 14.8 10.9 14.2 12 14.2 C13.1 14.2 14.1 14.8 15 15.9" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LanIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Ethernet RJ45 jack face: shield outline with pins and latch notch */}
      <path d="M5 4 h14 v9 l-7 7 l-7 -7 z" />
      <path d="M9 8 v3" />
      <path d="M12 8 v3" />
      <path d="M15 8 v3" />
      <path d="M9.5 15 h5" />
    </svg>
  );
}

export function ConnectionIcon({ connectionType, size = 24, className }: ConnectionIconProps) {
  return connectionType === 'wired' ? (
    <LanIcon size={size} className={className} />
  ) : (
    <WifiIcon size={size} className={className} />
  );
}
