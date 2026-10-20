import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  detectMediaType,
  isMediaId,
  MAX_MEDIA_SIZE,
  mediaTypes,
  readMediaMetadata,
  saveMediaMetadata,
} from "@/lib/media-storage";
import { rateLimit, requestKey } from "@/lib/rate-limit";

const completionSchema = z.object({
  id: z.string().uuid(),
  purpose: z.enum(["post", "avatar"]),
  contentType: z.enum(Object.keys(mediaTypes) as [keyof typeof mediaTypes, ...(keyof typeof mediaTypes)[]]),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  if (!(await rateLimit(requestKey(request, `media-complete:${session.user.id}`), 10, 60_000))) {
    return NextResponse.json({ error: "Limite de téléversements atteinte. Réessayez plus tard." }, { status: 429 });
  }

  const parsed = completionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Les informations du média téléversé sont invalides." }, { status: 400 });
  }

  const { id, purpose, contentType } = parsed.data;
  if (!isMediaId(id)) {
    return NextResponse.json({ error: "Les informations du média téléversé sont invalides." }, { status: 400 });
  }
  let metadata;
  try {
    metadata = await readMediaMetadata(id);
  } catch (error) {
    console.error("Impossible de lire les métadonnées de téléversement.", error);
    return NextResponse.json({ error: "Impossible de vérifier le média téléversé." }, { status: 500 });
  }
  if (
    !metadata ||
    metadata.ownerId !== session.user.id ||
    metadata.purpose !== purpose ||
    metadata.contentType !== contentType
  ) {
    return NextResponse.json({ error: "Le média téléversé ne correspond pas à votre sélection." }, { status: 403 });
  }

  if (purpose === "post") {
    if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Accès réservé aux partenaires." }, { status: 403 });
    }
    const tenant = await prisma.tenant.findFirst({
      where: { ownerId: session.user.id, status: "ACTIVE" },
      select: { id: true },
    });
    if (!tenant || metadata.tenantId !== tenant.id) {
      return NextResponse.json({ error: "Aucun espace partenaire actif n’est associé à ce média." }, { status: 403 });
    }
  }

  const pathname = `media/${id}.${mediaTypes[contentType].extension}`;
  let stored;
  try {
    stored = await get(pathname, { access: "private", useCache: false });
  } catch (error) {
    console.error("Impossible de vérifier le fichier dans le stockage média.", error);
    return NextResponse.json({ error: "Impossible de vérifier le fichier téléversé. Réessayez." }, { status: 502 });
  }
  if (!stored || stored.statusCode !== 200 || stored.blob.contentType !== contentType) {
    return NextResponse.json({ error: "Le fichier n’est pas encore disponible dans le stockage. Réessayez dans quelques secondes." }, { status: 409 });
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await new Response(stored.stream).arrayBuffer());
  } catch (error) {
    console.error("Impossible de lire le fichier média téléversé.", error);
    return NextResponse.json({ error: "Impossible de lire le fichier téléversé." }, { status: 502 });
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MEDIA_SIZE || detectMediaType(bytes) !== contentType) {
    return NextResponse.json({ error: "Le contenu du fichier ne correspond pas à un format média accepté." }, { status: 415 });
  }

  await saveMediaMetadata({ ...metadata, size: bytes.byteLength });

  return NextResponse.json({ ok: true, size: bytes.byteLength });
}
