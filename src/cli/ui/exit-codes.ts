export const ExitCode = {
  OK: 0,
  USER_ERROR: 1,
  SYSTEM_ERROR: 2,
  AUTH_REQUIRED: 3,
} as const

export type ExitCodeValue = typeof ExitCode[keyof typeof ExitCode]
