import test from "node:test";
import assert from "node:assert/strict";
import { imageResponse, resolveImageCatalogue } from "../../src/server/images";

const now = new Date("2026-11-04T12:00:00Z");
const candidate = {
  id: "synthetic-1",
  capturedOn: "2020-01-01",
  source: "Google Earth",
  url: "https://images.example.invalid/synthetic-1",
  expiresAt: "2026-11-04T13:00:00Z",
};
test("catalogue invokes selection then checks expiry, never returning expired or malformed URL evidence", () => {
  const base = {
    referenceDate: "2026-11-04",
    constructionDate: "2022-01-01",
    historicalCandidates: [candidate],
    survey: null,
  };
  assert.equal(resolveImageCatalogue(base, now).historical?.url, candidate.url);
  assert.equal(
    resolveImageCatalogue(
      {
        ...base,
        historicalCandidates: [
          { ...candidate, expiresAt: "2026-11-04T11:59:59Z" },
        ],
      },
      now,
    ).historical,
    null,
  );
  assert.equal(
    resolveImageCatalogue(
      {
        ...base,
        historicalCandidates: [{ ...candidate, expiresAt: "not-a-date" }],
      },
      now,
    ).historical,
    null,
  );
  assert.equal(
    resolveImageCatalogue({ ...base, historicalCandidates: [] }, now)
      .historical,
    null,
  );
});
test("API image projection strips historical metadata and rechecks survey expiry", () => {
  const metadata = { sensor: "synthetic" };
  const historical = { ...candidate, metadata };
  const result = imageResponse(
    {
      historical,
      survey: {
        url: "https://images.example.invalid/survey",
        source: "Relevamiento sintético",
        metadata,
        expiresAt: "2026-11-04T13:00:00Z",
      },
    },
    now,
  );
  assert.equal(result.length, 2);
  assert.equal("metadata" in result[0], false);
  assert.deepEqual(result[1].metadata, metadata);
  assert.equal(
    imageResponse(
      {
        historical,
        survey: {
          url: "https://images.example.invalid/survey",
          source: "Relevamiento sintético",
          metadata,
          expiresAt: "2026-11-04T12:00:00Z",
        },
      },
      now,
    )[1].url,
    null,
  );
});
