/** A policy or input rejection that can be safely mapped to a public reason code. */
export class PlatformCommandRejectedError extends Error {
  constructor(readonly reason: string) {
    super("platform_command_rejected");
  }
}
