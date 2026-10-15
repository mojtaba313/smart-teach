"use client";

/**
 * Image upload, backed by a GitHub repository through our own server.
 *
 * This component has no token, no owner, no repository and no settings. It asks
 * `/api/media` to do the work and gets back a URL. That is deliberate: a
 * client-side GitHub integration would have to hold a personal access token in
 * `localStorage`, where it is readable by any injected script and outlives the
 * session on disk. Here the credentials stay in the server's environment and
 * are rotated by redeploying.
 *
 * The stored library is shown because the first thing you want after uploading
 * is to reuse last week's image, and hunting for a URL is what makes people
 * upload the same picture twice.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardPaste, Loader2, Trash2, Upload } from "lucide-react";
import {
  canReadClipboard,
  clipboardErrorMessage,
  readClipboardImage,
} from "../../lib/storage/clipboard";
import { cn } from "../../lib/utils";

type StoredImage = {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
};

type MediaState = {
  configured: boolean;
  dir?: string;
  repo?: string;
  branch?: string;
  images?: StoredImage[];
};

export function ImageUpload({
  onUploaded,
  disabled,
}: {
  onUploaded: (url: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<MediaState | null>(null);
  const [images, setImages] = useState<StoredImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/media");
      const body = (await res.json().catch(() => null)) as MediaState | null;
      if (!res.ok || !body) {
        setError(
          (body as { error?: string } | null)?.error ??
            "خواندن فهرست ناکام ماند.",
        );
        setState({ configured: false });
        return;
      }
      setState(body);
      setImages(body.images ?? []);
    } catch {
      setState({ configured: false });
      setError("ارتباط با سرور برقرار نشد.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const send = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/media", { method: "POST", body: form });
        const body = (await res.json().catch(() => null)) as
          | (StoredImage & { error?: string })
          | null;
        if (!res.ok || !body?.url) {
          setError(body?.error ?? "بارگذاری ناکام ماند.");
          return;
        }
        setImages((list) =>
          [...list, { ...body, url: body.url! }].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        );
        onUploaded(body.url);
        setMessage("تصویر بارگذاری شد.");
      } catch {
        setError("ارتباط با سرور برقرار نشد.");
      } finally {
        setBusy(false);
      }
    },
    [onUploaded],
  );

  const removeImage = useCallback(async (image: StoredImage) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(image.name)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "حذف ناکام ماند.");
        return;
      }
      setImages((list) => list.filter((i) => i.sha !== image.sha));
      setMessage("تصویر حذف شد.");
    } finally {
      setBusy(false);
    }
  }, []);

  const configured = state?.configured === true;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={disabled || busy || !configured}
          onClick={() => fileRef.current?.click()}
          onClickCapture={() => setOpen(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-2 text-2xs text-ink-3 hover:border-brand/50 hover:text-brand disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          بارگذاری تصویر
        </button>

        {/* Reads the clipboard directly, so a screenshot copied from another
            app does not have to be aimed at a paste target first. Hidden where
            the browser cannot do it, rather than shown and then failing. */}
        {canReadClipboard() ? (
          <button
            type="button"
            disabled={disabled || busy || !configured}
            onClick={() => {
              void (async () => {
                const result = await readClipboardImage();
                if (!result.ok) {
                  setMessage(null);
                  setError(clipboardErrorMessage(result));
                  return;
                }
                await send(result.file);
              })();
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-2 text-2xs text-ink-3 hover:border-brand/50 hover:text-brand disabled:opacity-50"
          >
            <ClipboardPaste className="size-3.5" />
            چسباندن از کلیپ‌بورد
          </button>
        ) : null}

        {configured ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "inline-flex h-8 items-center rounded-md border border-hairline px-2 text-2xs text-ink-3 hover:text-ink",
              open && "border-brand text-brand",
            )}
          >
            کتابخانه ({images.length})
          </button>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void send(file);
            // Reset so re-picking the same file fires again.
            e.target.value = "";
          }}
        />
      </div>

      {configured ? (
        <div
          role="button"
          tabIndex={0}
          onPaste={(e) => {
            const file = Array.from(e.clipboardData.files).find((f) =>
              f.type.startsWith("image/"),
            );
            if (file) {
              e.preventDefault();
              void send(file);
            }
          }}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
          className="flex h-12 cursor-pointer items-center justify-center rounded-lg border border-dashed border-hairline text-2xs text-ink-3 hover:border-brand/50 hover:text-ink"
        >
          تصویر را اینجا بچسبانید یا برای انتخاب کلیک کنید
        </div>
      ) : null}

      {message ? (
        <p role="status" className="text-2xs text-ok">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-2xs text-warn">
          {error}
        </p>
      ) : null}

      {open && images.length > 0 ? (
        <div className="space-y-1.5 rounded-lg border border-hairline p-2">
          <p className="text-2xs text-ink-3">
            {images.length} تصویر در{" "}
            <bdi>
              {state?.repo}/{state?.dir}/
            </bdi>{" "}
            روی شاخه <bdi>{state?.branch}</bdi>
          </p>
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {images.map((img) => (
              <li
                key={img.sha}
                className="overflow-hidden rounded-lg border border-hairline"
              >
                <img
                  src={img.url}
                  alt=""
                  loading="lazy"
                  className="h-16 w-full bg-sunken object-contain"
                />
                <div className="flex items-center justify-between gap-1 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      onUploaded(img.url);
                      setMessage("آدرس تصویر انتخاب شد.");
                    }}
                    className="truncate text-2xs text-brand hover:underline"
                    title={img.path}
                  >
                    استفاده
                  </button>
                  <span className="text-2xs text-ink-3">
                    {Math.round(img.size / 1024)} KB
                  </span>
                  <button
                    type="button"
                    aria-label={`حذف ${img.name}`}
                    onClick={() => void removeImage(img)}
                    disabled={busy}
                    className="text-ink-3 hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
