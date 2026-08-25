export const ROLLING_GPM_WINDOWS = [1, 5, 10, 30, 60, 300] as const;
export type RollingGpmWindowSeconds = typeof ROLLING_GPM_WINDOWS[number];
