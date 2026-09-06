/** Pseudonymous identity used to enforce provider-feedback suppression. */
export function createRecipientFingerprint(
  secret: string,
  environment: string,
): (email: string) => Promise<string> {
  if (secret.length < 32)
    throw new Error("recipient_fingerprint_secret_required");
  let key: Promise<CryptoKey> | undefined;
  return async (email) => {
    const normalized = email.trim().toLowerCase();
    if (
      normalized.length < 3 ||
      normalized.length > 320 ||
      !normalized.includes("@")
    )
      throw new Error("recipient_invalid");
    key ??= crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const bytes = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await key,
        new TextEncoder().encode(
          `atharvan:transactional-recipient:${environment}:${normalized}`,
        ),
      ),
    );
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  };
}
