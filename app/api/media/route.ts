import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { detectMediaType, MAX_MEDIA_SIZE, mediaTypes, saveMedia, saveMediaMetadata } from "@/lib/media-storage";
import { rateLimit, requestKey } from "@/lib/rate-limit";

const uploadRequestSchema = z.object({
  id: z.string().uuid(),
  purpose: z.enum(["post", "avatar"]),
  contentType: z.enum(Object.keys(mediaTypes) as [keyof typeof mediaTypes, ...(keyof typeof mediaTypes)[]]),
});
async function handleDirectUpload(request: Request) {
  const body = await request.json().catch(() => null) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: "La requête de téléversement est invalide." }, { status: 400 });

  try {
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const session = await auth();
        if (!session?.user) throw new Error("Authentification requise.");
        if (!(await rateLimit(requestKey(request, `media-upload:${session.user.id}`), 10, 60_000))) {
          throw new Error("Limite de téléversements atteinte. Réessayez plus tard.");
        }
        const parsedPayload = uploadRequestSchema.safeParse(
          clientPayload ? JSON.parse(clientPayload) : null,
        );
        if (!parsedPayload.success) throw new Error("Les informations du téléversement sont invalides.");
        const payload = parsedPayload.data;
        const expectedPath = `media/${payload.id}.${mediaTypes[payload.contentType].extension}`;
        if (pathname !== expectedPath) throw new Error("Le chemin du média ne correspond pas à son identifiant.");

        let tenantId: string | null = null;
        if (payload.purpose === "post") {
          if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
            throw new Error("Accès réservé aux partenaires.");
          }
          const tenant = await prisma.tenant.findFirst({
            where: { ownerId: session.user.id },
            select: { id: true, status: true },
          });
          if (!tenant) throw new Error("Aucun espace partenaire n’est associé à votre compte.");
          if (tenant.status !== "ACTIVE") throw new Error("Votre espace est inactif.");
          tenantId = tenant.id;
        }

        await saveMediaMetadata({
          id: payload.id,
          tenantId,
          ownerId: session.user.id,
          purpose: payload.purpose,
          contentType: payload.contentType,
          mediaType: mediaTypes[payload.contentType].mediaType,
        });
        return {
          allowedContentTypes: [payload.contentType],
          maximumSizeInBytes: MAX_MEDIA_SIZE,
          addRandomSuffix: false,
          allowOverwrite: false,
        };
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    console.error("Échec du téléversement direct vers Blob.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impossible de téléverser le média." },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.includes("application/json")) {
    return handleDirectUpload(request);
  }

  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (!(await rateLimit(requestKey(request, `media-upload:${session.user.id}`), 10, 60_000))) {
    return NextResponse.json({ error: "Limite de téléversements atteinte. Réessayez plus tard." }, { status: 429 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_MEDIA_SIZE + 1_048_576) {
    return NextResponse.json({ error: "Le fichier ne doit pas dépasser 20 Mo." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Le formulaire de téléversement est invalide." }, { status: 400 });
  }
  const file = form.get("file");
  const purposeValue = form.get("purpose");
  const purpose = purposeValue === "avatar" ? "avatar" : purposeValue === null || purposeValue === "post" ? "post" : null;
  if (!purpose) return NextResponse.json({ error: "Type de téléversement invalide." }, { status: 400 });
  let tenant: { id: string; status: string } | null = null;
  if (purpose === "post") {
    if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Accès réservé aux partenaires." }, { status: 403 });
    }
    tenant = await prisma.tenant.findFirst({
      where: { ownerId: session.user.id },
      select: { id: true, status: true },
    });
    if (!tenant) return NextResponse.json({ error: "Aucun espace partenaire n’est associé à votre compte." }, { status: 404 });
    if (tenant.status !== "ACTIVE") return NextResponse.json({ error: "Votre espace est inactif." }, { status: 403 });

  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Sélectionnez un fichier image ou vidéo." }, { status: 400 });
  }
  if (file.size > MAX_MEDIA_SIZE) {
    return NextResponse.json({ error: "Le fichier ne doit pas dépasser 20 Mo." }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = detectMediaType(bytes);
  if (!contentType) {
    return NextResponse.json({ error: "Format refusé. Utilisez une image JPEG, PNG, GIF, WebP ou une vidéo MP4/WebM." }, { status: 415 });
  }
  if (file.type && file.type !== contentType) {
    return NextResponse.json({ error: "Le type réel du fichier ne correspond pas à son type déclaré." }, { status: 415 });
  }

  const id = randomUUID();
  try {
    await saveMedia(
      {
        id,
        tenantId: tenant?.id ?? null,
        ownerId: session.user.id,
        purpose,
        contentType,
        mediaType: mediaTypes[contentType].mediaType,
        size: bytes.byteLength,
      },
      bytes,
    );
  } catch (error) {
    console.error("Échec de l’écriture du média téléversé.", error);
    return NextResponse.json({ error: "Impossible d’enregistrer le média." }, { status: 500 });
  }

  return NextResponse.json({ url: `/api/media/${id}`, mediaType: mediaTypes[contentType].mediaType }, { status: 201 });
}
