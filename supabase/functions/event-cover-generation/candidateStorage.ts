import { ProviderError, validCoverImage } from "./provider.ts";
/** Only a confirmed absence authorizes another provider call. */
export async function existingCandidate(
  download: () => Promise<{ data: Blob | null; error: unknown }>,
): Promise<Uint8Array | null> {
  const result = await download();
  if (result.error) {
    const code = typeof result.error === "object" && result.error !== null &&
        "statusCode" in result.error
      ? String(result.error.statusCode)
      : "";
    if (code === "404") return null;
    throw new ProviderError("STORAGE_FAILED");
  }
  if (!result.data) throw new ProviderError("STORAGE_FAILED");
  const bytes = new Uint8Array(await result.data.arrayBuffer());
  if (!validCoverImage(bytes)) {
    throw new ProviderError("INVALID_PROVIDER_IMAGE");
  }
  return bytes;
}
