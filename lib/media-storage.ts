import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, get, put } from "@vercel/blob";
import { z } from "zod";

export const MAX_MEDIA_SIZE = 20 * 1024 * 1024;
export const mediaTypes = {
  "image/jpeg": { mediaType: "IMAGE", extension: "jpg" },
  "image/png": { mediaType: "IMAGE", extension: "png" },
  "image/gif": { mediaType: "IMAGE", extension: "gif" },
  "image/webp": { mediaType: "IMAGE", extension: "webp" },
  "video/mp4": { mediaType: "VIDEO", extension: "mp4" },
  "video/webm": { mediaType: "VIDEO", extension: "webm" },
} as const;

const metadataSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1).nullable(),
  ownerId: z.string().min(1),
  purpose: z.enum(["post", "avatar"]),
  contentType: z.enum(Object.keys(mediaTypes) as [keyof typeof mediaTypes, ...(keyof typeof mediaTypes)[]]),
  mediaType: z.enum(["IMAGE", "VIDEO"]),
  size: z.number().int().positive().max(MAX_MEDIA_SIZE),
});

export type MediaMetadata = z.infer<typeof metadataSchema>;

export function isMediaId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function uploadDirectory() {
  return path.resolve(/* turbopackIgnore: true */ process.env.MEDIA_UPLOAD_DIR || path.join(process.cwd(), ".local-data", "uploads"));
}

function usesVercelBlob() {
  const configured = Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID),
  );
  if (process.env.VERCEL === "1" && !configured) {
    throw new Error("Connect a private Vercel Blob store before using media in production.");
  }
  return configured;
}

function mediaBlobPath(id: string, contentType: keyof typeof mediaTypes) {
  return `media/${id}.${mediaTypes[contentType].extension}`;
}

function metadataBlobPath(id: string) {
  return `media/${id}.json`;
}

export function mediaFilePath(id: string, contentType: keyof typeof mediaTypes) {
  return path.join(/* turbopackIgnore: true */ uploadDirectory(), `${id}.${mediaTypes[contentType].extension}`);
}

function metadataFilePath(id: string) {
  return path.join(uploadDirectory(), `${id}.json`);
}

export function detectMediaType(bytes: Uint8Array): keyof typeof mediaTypes | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (pngSignature.every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(Buffer.from(bytes.subarray(0, 6)).toString("ascii"))) return "image/gif";
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) return "image/webp";
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(4, 8)).toString("ascii") === "ftyp") return "video/mp4";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  return null;
}

export async function saveMedia(metadata: MediaMetadata, bytes: Uint8Array) {
  if (usesVercelBlob()) {
    const mediaBlob = await put(mediaBlobPath(metadata.id, metadata.contentType), Buffer.from(bytes), {
      access: "private",
      addRandomSuffix: false,
      contentType: metadata.contentType,
    });
    try {
      await saveMediaMetadata(metadata);
    } catch (error) {
      try {
        await del(mediaBlob.pathname);
      } catch (cleanupError) {
        console.error("Échec du nettoyage après un échec d’enregistrement du média privé.", cleanupError);
      }
      throw error;
    }
    return;
  }

  await mkdir(uploadDirectory(), { recursive: true });
  const filePath = mediaFilePath(metadata.id, metadata.contentType);
  await writeFile(filePath, bytes, { flag: "wx" });
  try {
    await writeFile(metadataFilePath(metadata.id), JSON.stringify(metadata), { flag: "wx" });
  } catch (error) {
    await unlink(filePath).catch((cleanupError: NodeJS.ErrnoException) => {
      if (cleanupError.code !== "ENOENT") throw cleanupError;
    });
    throw error;
  }
}

export async function saveMediaMetadata(metadata: MediaMetadata) {
  if (!usesVercelBlob()) throw new Error("Private Blob storage is required to save remote media metadata.");
  await put(metadataBlobPath(metadata.id), JSON.stringify(metadata), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

export async function readMediaMetadata(id: string): Promise<MediaMetadata | null> {
  if (usesVercelBlob()) {
    const blob = await get(metadataBlobPath(id), { access: "private" });
    if (!blob || blob.statusCode !== 200) return null;
    const raw = await new Response(blob.stream).text();
    return metadataSchema.parse(JSON.parse(raw));
  }

  try {
    const raw = await readFile(metadataFilePath(id), "utf8");
    return metadataSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function readMediaBytes(
  id: string,
  contentType: keyof typeof mediaTypes,
): Promise<Uint8Array | null> {
  if (usesVercelBlob()) {
    const blob = await get(mediaBlobPath(id, contentType), { access: "private" });
    if (!blob || blob.statusCode !== 200) return null;
    return new Uint8Array(await new Response(blob.stream).arrayBuffer());
  }

  try {
    return await readFile(mediaFilePath(id, contentType));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}
