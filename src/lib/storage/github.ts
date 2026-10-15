/**
 * Image storage in a GitHub repository, through the Contents API.
 *
 * SERVER-ONLY. Import this from a Route Handler, never from a component.
 *
 * The alternative was a bucket service. This is the whole trade-off: no vendor,
 * no monthly bill, no separate dashboard, and the images are versioned, diffed
 * and revertable alongside the lessons that reference them. In exchange, a
 * write is a commit — slower than a PUT, and visible in history.
 *
 * Three things this module is careful about, because each one is a way the
 * obvious implementation loses data:
 *
 * - **The token lives in the process environment and never travels to a
 *   client.** Every call here is made from our server to `api.github.com`; the
 *   browser only ever talks to `/api/media`. A prototype that calls GitHub
 *   straight from the browser has to keep the token in `localStorage`, where
 *   any XSS on any origin-shared page can read it, and where it survives on
 *   disk indefinitely. The credentials are configured once, on the server,
 *   where a deploy can rotate them.
 * - **Base64 is the wire format, not the storage format.** A 5MB file is ~6.7MB
 *   of base64; sending that as a JSON string body is what the Contents API
 *   expects, but it also means the body limit is the real limit, not the file
 *   limit.
 * - **A replace needs the current SHA.** PUTting to an existing path without
 *   `sha` is a 422, so a "replace" is a read-then-write and the two must not
 *   race. The caller is expected to refresh the listing rather than cache the
 *   SHA across an upload.
 */

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const RAW = "https://raw.githubusercontent.com";

/** Where images live inside the repository. */
export const IMAGE_DIR =  process.env.IMAGE_DIR || "images";

/** GitHub rejects a Contents write above this; the file cap is set below it. */
const MAX_BYTES = 5 * 1024 * 1024;

/** Formats we will store. SVG is excluded: it is a script container. */
export const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export type AllowedType = (typeof ALLOWED_TYPES)[number];

export type BucketConfig = {
  owner: string;
  repo: string;
  branch: string;
  /** A fine-grained PAT with Contents: read+write on this one repository. */
  token: string;
};

export type StoredImage = {
  name: string;
  path: string;
  sha: string;
  size: number;
  /** Set by GitHub; falls back to the raw URL when absent. */
  downloadUrl: string | null;
};

/**
 * Read the credentials from the environment.
 *
 * Returns `null` rather than a partly-filled config, so a misconfigured server
 * fails loudly instead of silently uploading into a repository named "".
 */
export function configFromEnv(
  env: Record<string, string | undefined> = process.env,
): BucketConfig | null {
  const owner = env.GITHUB_OWNER?.trim() ?? "";
  const repo = env.GITHUB_REPO?.trim() ?? "";
  const token = env.GITHUB_TOKEN?.trim() ?? "";
  if (!owner || !repo || !token) return null;
  return { owner, repo, branch: env.GITHUB_BRANCH?.trim() || "main", token };
}

/** Public view of the config: everything except the token. */
export type PublicConfig = { owner: string; repo: string; branch: string };

export function publicConfig(c: BucketConfig): PublicConfig {
  return { owner: c.owner, repo: c.repo, branch: c.branch };
}

export function isConfigured(c: BucketConfig): boolean {
  return c.owner.trim() !== "" && c.repo.trim() !== "" && c.token.trim() !== "";
}

export class BucketError extends Error {
  /** The HTTP status, when the failure came from GitHub. */
  readonly status?: number;
  /**
   * True when this is our own validation talking, not GitHub. A rejected file
   * is the caller's fault and should surface as 4xx; relaying it as 5xx would
   * tell a monitoring dashboard the server is broken.
   */
  readonly local: boolean;

  constructor(message: string, status?: number, local = false) {
    super(message);
    this.name = "BucketError";
    this.status = status;
    this.local = local;
  }
}

/* ------------------------------------------------------------------ *
 *  Paths and URLs
 * ------------------------------------------------------------------ */

/**
 * Encode each segment but keep the separators.
 *
 * A naive `encodeURIComponent(path)` turns `images/a.png` into
 * `images%2Fa.png`, which GitHub reads as a single filename containing a slash.
 */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** The URL a browser can load the image from. Stable for a given path+branch. */
export function rawUrl(config: BucketConfig, path: string): string {
  return `${RAW}/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/${encodeURIComponent(config.branch)}/${encodePath(path)}`;
}

function contentsPath(config: BucketConfig, path: string): string {
  return `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodePath(path)}`;
}

const EXT_BY_TYPE: Record<AllowedType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const TYPE_BY_EXT: Record<string, AllowedType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/**
 * The extension to store under.
 *
 * Taken from the declared MIME type, not the filename: a file called
 * `photo.txt` that is actually a PNG is still a PNG, and storing it as `.txt`
 * would make browsers refuse to render it.
 */
export function extensionFor(file: {
  type: string;
  name: string;
}): string | null {
  const byType = EXT_BY_TYPE[file.type as AllowedType];
  if (byType) return byType;
  const m = /\.([a-z0-9]{1,5})$/i.exec(file.name);
  const ext = m ? m[1].toLowerCase() : "";
  return TYPE_BY_EXT[ext] ? (ext === "jpeg" ? "jpg" : ext) : null;
}

/**
 * A filename that will not collide and will not leak anything.
 *
 * The user's own name is dropped entirely. A filename arrives from the user's
 * machine and ends up in a URL, in git history and in a directory listing; a
 * Persian name, a home directory, or a project codename all leak something. A
 * timestamp plus randomness costs nothing and leaks nothing.
 */
export function storageName(ext: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${rand}.${ext}`;
}

/* ------------------------------------------------------------------ *
 *  Validation
 * ------------------------------------------------------------------ */

export function validateFile(file: {
  type: string;
  size: number;
}): string | null {
  if (!ALLOWED_TYPES.includes(file.type as AllowedType)) {
    return "قالب مجاز: JPG، PNG، WebP، GIF یا AVIF";
  }
  if (file.size === 0) return "فایل خالی است.";
  if (file.size > MAX_BYTES) {
    return `حجم فایل بیش از ${Math.round(MAX_BYTES / 1024 / 1024)} مگابایت است.`;
  }
  return null;
}

export function validateConfig(config: BucketConfig): string | null {
  if (!config.owner.trim() || !config.repo.trim())
    return "نام کاربری و نام ریپو را وارد کنید.";
  if (!config.token.trim()) return "توکن را وارد کنید.";
  if (!config.branch.trim()) return "نام شاخه را وارد کنید.";
  return null;
}

/* ------------------------------------------------------------------ *
 *  Transport
 * ------------------------------------------------------------------ */

async function request<T>(
  config: BucketConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "X-GitHub-Api-Version": API_VERSION,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch(err) {
    throw new BucketError("ارتباط با GitHub برقرار نشد.");
  }

  if (response.status === 204) return undefined as T;

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    const detail = body?.message ?? response.statusText;
    // 401/403 are configuration problems and deserve a clearer line than
    // GitHub's, which says only "Bad credentials".
    if (response.status === 401) {
      throw new BucketError("توکن نامعتبر است یا منقضی شده.", response.status);
    }
    if (response.status === 403) {
      throw new BucketError(
        "دسترسی توکن کافی نیست؛ به ریپو مجوز Contents: نوشتن بدهید.",
        response.status,
      );
    }
    if (response.status === 409) {
      throw new BucketError("این نام فایل از قبل وجود دارد.", response.status);
    }
    if (response.status === 422) {
      throw new BucketError(
        "نوشتن ناموفق بود؛ شاید فایل هم‌زمان تغییر کرده باشد.",
        response.status,
      );
    }
    throw new BucketError(
      `GitHub ${response.status}: ${detail}`,
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

/** GitHub's shape for a content entry. */
type Content = {
  name: string;
  path: string;
  sha: string;
  size: number;
  download_url?: string | null;
  type: string;
};

function toStored(c: Content, config: BucketConfig): StoredImage {
  return {
    name: c.name,
    path: c.path,
    sha: c.sha,
    size: c.size,
    downloadUrl: c.download_url ?? rawUrl(config, c.path),
  };
}

/**
 * Base64 for the Contents API.
 *
 * `FileReader` is browser-only and this module runs on the server, where it is
 * simply undefined — so the bytes go through `arrayBuffer` instead. `Buffer`
 * does the encoding; it is the one base64 implementation that is definitely
 * present in the Node runtime Next.js runs on.
 */
async function toBase64(file: Blob): Promise<string> {
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    return bytes.toString("base64");
  } catch (e) {
    throw new BucketError(
      `خواندن فایل ناموفق بود.${e instanceof Error ? ` (${e.message})` : ""}`,
      400,
      true,
    );
  }
}

/**
 * List the stored images.
 *
 * An absent directory is an empty list, not an error: a fresh repository has
 * no `images/` yet and the first upload creates it.
 */
export async function list(config: BucketConfig): Promise<StoredImage[]> {
  const invalid = validateConfig(config);
  if (invalid) throw new BucketError(invalid, 400, true);

  const path = `${contentsPath(config, IMAGE_DIR)}?ref=${encodeURIComponent(config.branch)}`;
  try {
    const entries = await request<Content[]>(config, path);
    return entries
      .filter((e) => e.type === "file" && /\.([a-z0-9]{1,5})$/i.test(e.name))
      .map((e) => toStored(e, config))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    if (e instanceof BucketError && e.status === 404) return [];
    throw e;
  }
}

/** Upload a new image and return its entry. */
export async function upload(
  config: BucketConfig,
  file: File,
): Promise<StoredImage> {
  const invalid = validateConfig(config) ?? validateFile(file);
  if (invalid) throw new BucketError(invalid, 400, true);

  const ext = extensionFor(file);
  if (!ext) throw new BucketError("قالب فایل پشتیبانی نمی‌شود.", 415, true);

  const path = `${IMAGE_DIR}/${storageName(ext)}`;
  const content = await toBase64(file);

  const result = await request<{ content: Content }>(
    config,
    contentsPath(config, path),
    {
      method: "PUT",
      body: JSON.stringify({
        message: `Add image ${path}`,
        branch: config.branch,
        content,
      }),
    },
  );

  return toStored(result.content, config);
}

/**
 * Overwrite an existing image, keeping its path.
 *
 * Requires the current SHA — without it GitHub answers 422. A "replace" that
 * changes the bytes but keeps the URL will be served stale from
 * `raw.githubusercontent.com`'s cache for a while, so the caller should prefer
 * uploading a new file when the intent is "this is a different picture".
 */
export async function replace(
  config: BucketConfig,
  image: StoredImage,
  file: File,
): Promise<StoredImage> {
  const invalid = validateConfig(config) ?? validateFile(file);
  if (invalid) throw new BucketError(invalid, 400, true);

  const content = await toBase64(file);
  const result = await request<{ content: Content }>(
    config,
    contentsPath(config, image.path),
    {
      method: "PUT",
      body: JSON.stringify({
        message: `Replace image ${image.path}`,
        branch: config.branch,
        content,
        sha: image.sha,
      }),
    },
  );
  return toStored(result.content, config);
}

/** Find one stored image by filename. Returns null when it is not there. */
export async function find(
  config: BucketConfig,
  name: string,
): Promise<StoredImage | null> {
  const entries = await list(config);
  return entries.find((e) => e.name === name) ?? null;
}

/** Delete an image. Needs its SHA for the same reason a replace does. */
export async function remove(
  config: BucketConfig,
  image: StoredImage,
): Promise<void> {
  const invalid = validateConfig(config);
  if (invalid) throw new BucketError(invalid, 400, true);

  await request<void>(config, contentsPath(config, image.path), {
    method: "DELETE",
    body: JSON.stringify({
      message: `Remove image ${image.path}`,
      branch: config.branch,
      sha: image.sha,
    }),
  });
}
