/**
 * The media API: list and upload images.
 *
 * The GitHub token is configured on the server and never leaves it. The browser
 * has no idea a token exists — it asks this route, and this route talks to
 * GitHub. That is the whole reason this is not a client-side integration.
 */

import { NextResponse } from "next/server";
import {
  IMAGE_DIR,
  BucketError,
  configFromEnv,
  list,
  publicConfig,
  rawUrl,
  upload,
} from "../../../lib/storage/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unconfigured = () =>
  NextResponse.json(
    {
      error:
        "بارگذاری تصویر پیکربندی نشده است. GITHUB_TOKEN، GITHUB_OWNER و GITHUB_REPO را تنظیم کنید.",
    },
    { status: 501 },
  );

/** Listing plus a flag saying whether upload is even possible. */
export async function GET() {
  const config = configFromEnv();
  if (!config) return unconfigured();
  try {
    const images = await list(config);
    return NextResponse.json({
      ...publicConfig(config),
      dir: IMAGE_DIR,
      images: images.map((i) => ({ ...i, url: rawUrl(config, i.path) })),
      configured:true
    });
  } catch (e) {
    const status =
      e instanceof BucketError
        ? e.local
          ? (e.status ?? 400)
          : (e.status ?? 502)
        : 502;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خواندن فهرست ناکام ماند." },
      { status },
    );
  }
}

export async function POST(request: Request) {
  const config = configFromEnv();
  if (!config) return unconfigured();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "درخواست باید multipart باشد." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "فایلی ارسال نشد." }, { status: 400 });
  }

  try {
    const stored = await upload(config, file);
    return NextResponse.json({ ...stored, url: rawUrl(config, stored.path) });
  } catch (e) {
    const status =
      e instanceof BucketError
        ? e.local
          ? (e.status ?? 400)
          : (e.status ?? 502)
        : 502;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "بارگذاری ناکام ماند." },
      { status },
    );
  }
}
