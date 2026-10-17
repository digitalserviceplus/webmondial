import assert from "node:assert/strict";
import test from "node:test";
import { detectMediaType, isMediaId } from "../lib/media-storage";

test("media type is determined from the file signature", () => {
  assert.equal(detectMediaType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(detectMediaType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectMediaType(Buffer.from("GIF89a")), "image/gif");
  assert.equal(detectMediaType(Buffer.from("RIFF0000WEBP")), "image/webp");
  assert.equal(detectMediaType(Buffer.from("0000ftypisom")), "video/mp4");
  assert.equal(detectMediaType(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])), "video/webm");
  assert.equal(detectMediaType(Buffer.from("<svg></svg>")), null);
  assert.equal(detectMediaType(Buffer.from("not media")), null);
});

test("media IDs must be UUIDs before they can be used in storage paths", () => {
  assert.equal(isMediaId("8a4cc179-1f24-4ca1-a520-7821442c8cc1"), true);
  assert.equal(isMediaId("../../secret"), false);
  assert.equal(isMediaId("not-a-uuid"), false);
});
