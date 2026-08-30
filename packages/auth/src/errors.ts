export class OnboardingCommandRejectedError extends Error {
  override readonly name = "OnboardingCommandRejectedError";

  constructor(readonly reason: string) {
    super(reason);
  }
}
