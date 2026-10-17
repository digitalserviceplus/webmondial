import { del, put } from "@vercel/blob";
import { config } from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { detectMediaType, isMediaId, mediaTypes } from "../lib/media-storage";

const root = process.cwd();
config({ path: path.join(root, ".env.migration.local"), quiet: true });

const uploadDirectory = path.join(root, ".local-data", "uploads");
const metadataSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1).nullable(),
  ownerId: z.string().min(1),
  purpose: z.enum(["post", "avatar"]),
  contentType: z.enum(Object.keys(mediaTypes) as [keyof typeof mediaTypes, ...(keyof typeof mediaTypes)[]]),
  mediaType: z.enum(["IMAGE", "VIDEO"]),
  size: z.number().int().positive(),
});

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new Error("Add BLOB_READ_WRITE_TOKEN to the ignored .env.migration.local file.");

  const entries = await readdir(uploadDirectory, { withFileTypes: true });
  const metadataFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  if (metadataFiles.length === 0) {
    console.info("No local media metadata files found; nothing to migrate.");
    return;
  }

  let migrated = 0;
  for (const metadataFile of metadataFiles) {
    const metadata = metadataSchema.parse(JSON.parse(await readFile(path.join(uploadDirectory, metadataFile), "utf8")));
    if (!isMediaId(metadata.id) || metadataFile !== `${metadata.id}.json`) {
      throw new Error(`Invalid local media metadata filename: ${metadataFile}`);
    }
    const extension = mediaTypes[metadata.contentType].extension;
    const bytes = await readFile(path.join(uploadDirectory, `${metadata.id}.${extension}`));
    if (bytes.byteLength !== metadata.size || detectMediaType(bytes) !== metadata.contentType) {
      throw new Error(`Local media file failed verification for ${metadata.id}.`);
    }

    const pathname = `media/${metadata.id}.${extension}`;
    const blob = await put(pathname, bytes, {
      access: "private",
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: metadata.contentType,
    });
    try {
      await put(`media/${metadata.id}.json`, JSON.stringify(metadata), {
        access: "private",
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
    } catch (error) {
      try {
        await del(blob.pathname, { token });
      } catch (cleanupError) {
        console.error("Could not clean up an incomplete private media migration.", cleanupError);
      }
      throw error;
    }
    migrated += 1;
  }

  console.info(`Migrated ${migrated} media files to the private Vercel Blob store.`);
}

main().catch((error: unknown) => {
  console.error("Local media migration failed.", error instanceof Error ? error.message : "Unknown error.");
  process.exitCode = 1;
});
