import { describe, expect, it } from 'vitest'
import {
  ALLOWED_TYPES,
  BucketError,
  IMAGE_DIR,
  configFromEnv,
  encodePath,
  extensionFor,
  isConfigured,
  publicConfig,
  rawUrl,
  storageName,
  validateConfig,
  validateFile,
  type BucketConfig,
} from './github'

const cfg: BucketConfig = { owner: 'mojtaba', repo: 'media', branch: 'main', token: 'github_pat_x' }

describe('encodePath', () => {
  it('encodes each segment but keeps the separators', () => {
    // The bug this prevents: encoding the whole path turns `images/a.png`
    // into one filename that literally contains a slash.
    expect(encodePath('images/a b.png')).toBe('images/a%20b.png')
    expect(encodePath('images/2024/plan.png')).toBe('images/2024/plan.png')
  })

  it('encodes characters that would otherwise change the path', () => {
    expect(encodePath('images/a?b#c.png')).toBe('images/a%3Fb%23c.png')
  })
})

describe('rawUrl', () => {
  it('points at the raw host for the configured branch', () => {
    expect(rawUrl(cfg, 'images/x.png')).toBe(
      'https://raw.githubusercontent.com/mojtaba/media/main/images/x.png',
    )
  })

  it('encodes the owner and repo too', () => {
    expect(rawUrl({ ...cfg, owner: 'a b' }, 'images/x.png')).toContain('/a%20b/media/')
  })

  it('encodes the branch, so a slash in it cannot forge a path', () => {
    expect(rawUrl({ ...cfg, branch: 'a/b' }, 'x.png')).toContain('/a%2Fb/')
  })
})

describe('extensionFor', () => {
  it('trusts the MIME type over the filename', () => {
    // A PNG called `photo.txt` is still a PNG; storing it as `.txt` makes
    // browsers refuse to render it.
    expect(extensionFor({ type: 'image/png', name: 'photo.txt' })).toBe('png')
    expect(extensionFor({ type: 'image/jpeg', name: 'anything' })).toBe('jpg')
  })

  it('falls back to the filename when the type is missing or generic', () => {
    expect(extensionFor({ type: '', name: 'a.PNG' })).toBe('png')
    expect(extensionFor({ type: 'application/octet-stream', name: 'a.webp' })).toBe('webp')
  })

  it('normalises jpeg to jpg', () => {
    expect(extensionFor({ type: '', name: 'a.jpeg' })).toBe('jpg')
  })

  it('refuses anything not on the allowlist', () => {
    expect(extensionFor({ type: 'image/svg+xml', name: 'a.svg' })).toBeNull()
    expect(extensionFor({ type: 'text/html', name: 'a.html' })).toBeNull()
    expect(extensionFor({ type: 'image/png', name: 'noext' })).toBe('png')
    expect(extensionFor({ type: 'image/tiff', name: 'a.tiff' })).toBeNull()
  })
})

describe('storageName', () => {
  it('produces a name with the right extension', () => {
    expect(storageName('png')).toMatch(/\.png$/)
  })

  it('never reuses the caller\'s filename', () => {
    // Whatever the user calls the file ends up in a URL, in git history and in
    // a directory listing; a project name or a home path leaks from all three.
    const a = storageName('png')
    const b = storageName('png')
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9-]+\.png$/)
  })
})

describe('validateFile', () => {
  const ok = { type: 'image/png', size: 1024 }

  it('accepts a normal image', () => {
    expect(validateFile(ok)).toBeNull()
  })

  it('names the allowed formats when refusing one', () => {
    const message = validateFile({ type: 'image/svg+xml', size: 10 })
    expect(message).toContain('PNG')
    expect(message).toContain('AVIF')
  })

  it('refuses an empty file', () => {
    expect(validateFile({ type: 'image/png', size: 0 })).toContain('خالی')
  })

  it('caps the size', () => {
    expect(validateFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toContain('مگابایت')
    expect(validateFile({ type: 'image/png', size: 5 * 1024 * 1024 })).toBeNull()
  })

  it('covers every advertised format', () => {
    for (const t of ALLOWED_TYPES) expect(validateFile({ type: t, size: 10 })).toBeNull()
  })
})

describe('validateConfig', () => {
  it('accepts a full config', () => {
    expect(validateConfig(cfg)).toBeNull()
  })

  it('says what is missing', () => {
    expect(validateConfig({ ...cfg, owner: '  ' })).toContain('کاربر')
    expect(validateConfig({ ...cfg, repo: '' })).toContain('ریپو')
    expect(validateConfig({ ...cfg, token: '' })).toContain('توکن')
    expect(validateConfig({ ...cfg, branch: '' })).toContain('شاخه')
  })

  it('does not treat whitespace as a value', () => {
    expect(isConfigured({ ...cfg, owner: '   ', repo: 'r', branch: 'b', token: 't' })).toBe(false)
  })
})

describe('configFromEnv', () => {
  it('reads all four values', () => {
    expect(
      configFromEnv({ GITHUB_OWNER: 'm', GITHUB_REPO: 'r', GITHUB_BRANCH: 'dev', GITHUB_TOKEN: 't' }),
    ).toEqual({ owner: 'm', repo: 'r', branch: 'dev', token: 't' })
  })

  it('defaults the branch to main', () => {
    expect(configFromEnv({ GITHUB_OWNER: 'm', GITHUB_REPO: 'r', GITHUB_TOKEN: 't' })?.branch).toBe('main')
  })

  it('treats whitespace as unset', () => {
    expect(configFromEnv({ GITHUB_OWNER: '  ', GITHUB_REPO: 'r', GITHUB_TOKEN: 't' })).toBeNull()
  })

  it('returns null rather than a half-filled config', () => {
    // A partially configured server must fail loudly; silently uploading into a
    // repository named "" is not a failure mode worth supporting.
    expect(configFromEnv({})).toBeNull()
    expect(configFromEnv({ GITHUB_OWNER: 'm', GITHUB_REPO: 'r' })).toBeNull()
  })

  it('never puts the token in the public config', () => {
    const full = configFromEnv({ GITHUB_OWNER: 'm', GITHUB_REPO: 'r', GITHUB_TOKEN: 'secret' })!
    expect(publicConfig(full)).toEqual({ owner: 'm', repo: 'r', branch: 'main' })
    expect(JSON.stringify(publicConfig(full))).not.toContain('secret')
  })

  it('stores images under images/', () => {
    expect(IMAGE_DIR).toBe('images')
  })
})

describe('BucketError', () => {
  it('carries the status for callers that branch on it', () => {
    const e = new BucketError('nf', 404)
    expect(e.status).toBe(404)
    expect(e.local).toBe(false)
    expect(e.name).toBe('BucketError')
    expect(e).toBeInstanceOf(Error)
  })

  it('marks our own validation so it can be reported as 4xx, not 5xx', () => {
    // Relaying "wrong file type" as 502 would tell a monitoring dashboard the
    // server is broken when the user simply picked a .txt.
    expect(new BucketError('bad', 400, true).local).toBe(true)
  })
})