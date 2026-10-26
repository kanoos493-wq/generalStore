/** Design tokens: restrained retail palette, large touch targets. */
export const colors = {
  bg: '#F4F6F8',
  card: '#FFFFFF',
  cardAlt: '#F9FAFB',
  text: '#0F172A',
  muted: '#64748B',
  faint: '#94A3B8',
  border: '#E2E8F0',
  primary: '#0F766E',
  primaryDark: '#115E59',
  primarySoft: '#CCFBF1',
  onPrimary: '#FFFFFF',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  success: '#15803D',
  successSoft: '#DCFCE7',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  info: '#1D4ED8',
  infoSoft: '#DBEAFE',
  overlay: 'rgba(15, 23, 42, 0.45)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const font = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
};

export const touchTarget = 48;

/**
 * Motion tokens. Everything animated in the app uses these durations and
 * curves so transitions feel like one system, and every animation is gated on
 * the OS "remove animations" accessibility setting.
 */
export const motion = {
  /** Standard duration for transitions and feedback. */
  duration: 180,
  /** Slightly longer for larger surfaces such as sheets. */
  durationSlow: 260,
  /** Transform distance used when a sheet or card slides in. */
  slideDistance: 12,
  /** cubic-bezier(0.2, 0, 0, 1) — quick out, settled landing. */
  ease: [0.2, 0, 0, 1] as const,
};
