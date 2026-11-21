/** Canonical identity key stored as UTF-8 bytes, separate from display spelling. */
export const usernameKey = (value: string) => value.normalize("NFKC").trim().toLowerCase();
