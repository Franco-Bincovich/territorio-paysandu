import type { ParcelImage, ParcelImages } from "../domain";
import {
  imageUrlAvailability,
  selectHistoricalImage,
  type HistoricalCandidate,
} from "../domain/image-selection";

/** An institutional adapter must obtain both dates from its authorized contract.
 * No current-date default is allowed for institutional evidence. */
export type ImageCatalogueSource = Readonly<{
  referenceDate: string;
  constructionDate?: string | null;
  historicalCandidates: readonly (HistoricalCandidate & ParcelImage)[];
  survey: ParcelImages["survey"];
}>;

export function availableImage<T extends ParcelImage>(
  image: T | null,
  now: Date,
): T | null {
  if (!image) return null;
  // Exact application-owned endpoints revalidate session and Storage RLS on every request.
  if (/^\/api\/parcel-image\/(historical|survey)$/.test(image.url))
    return image;
  try {
    return imageUrlAvailability(image, now).available ? image : null;
  } catch {
    return null;
  } // Invalid expiration evidence must not expose a URL or break the cadastral record.
}

export function resolveImageCatalogue(
  source: ImageCatalogueSource,
  now: Date,
): ParcelImages {
  const selection = selectHistoricalImage({
    referenceDate: source.referenceDate,
    constructionDate: source.constructionDate,
    candidates: source.historicalCandidates,
  });
  const selected =
    selection.status === "selected"
      ? (source.historicalCandidates.find(
          (c) => c.id === selection.candidate.id,
        ) ?? null)
      : null;
  const historical = availableImage(selected, now);
  const survey = availableImage(source.survey, now);
  return {
    historical,
    survey,
    ...(!historical || !survey
      ? { unavailableReason: "not_found" as const }
      : {}),
  };
}

/** Recheck expiration at the API boundary; never send historical metadata. */
export function imageResponse(images: ParcelImages, now: Date) {
  const historical = availableImage(images.historical, now),
    survey = availableImage(images.survey, now);
  return [
    {
      kind: "historical",
      source: historical?.source ?? "Google Earth",
      url: historical?.url ?? null,
    },
    {
      kind: "survey",
      source: survey?.source ?? "Relevamiento",
      url: survey?.url ?? null,
      metadata: survey?.metadata ?? null,
    },
  ];
}
