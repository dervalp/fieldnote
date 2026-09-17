import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ReleaseFile, SkillsRelease } from '../domain/fieldnote-skills/types';
import { fieldnoteSkillsGithubToken } from '../lib/env';

const repository = 'https://api.github.com/repos/dervalp/fieldnote-skills';
const maxSkills = 100;
const maxFileBytes = 256 * 1024;
const maxReleaseBytes = 8 * 1024 * 1024;
const releaseTag = /^skills-v[0-9]+(?:\.[0-9]+){2}(?:-[0-9A-Za-z.-]+)?$/;
const sha256 = /^sha256:[a-f0-9]{64}$/;
const relativePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0)[^/\0]+(?:\/[^/\0]+)*$/;

const latestReleaseSchema = z.object({ tag_name: z.string().regex(releaseTag) });
const commitSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) });
const contentSchema = z.object({
  type: z.literal('file'),
  encoding: z.literal('base64'),
  size: z.number().int().nonnegative(),
  content: z.string(),
});
const releaseMetadataSchema = z.object({ release: z.string().regex(releaseTag) });
const catalogSchema = z.object({
  version: z.number().int(),
  skills: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
        version: z.string().min(1),
        stage: z.string().min(1),
        description: z.string(),
        surface: z.string().min(1),
        mcp: z.array(z.unknown()),
        variance: z.string().min(1),
        concerns: z.array(z.string()).optional(),
      }),
    )
    .max(maxSkills),
});
const lockSchema = z.object({
  release: z.string().regex(releaseTag),
  skills: z.array(
    z.object({
      name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      version: z.string().min(1),
      coreHash: z.string().regex(sha256),
      files: z.record(
        z.string().regex(relativePath),
        z.object({ role: z.enum(['prompt', 'tooling']), hash: z.string().regex(sha256) }),
      ),
    }),
  ),
});

export type SkillsReleaseErrorCode = 'release_unavailable' | 'release_invalid';

/** Safe to retain: it intentionally contains no provider response text or release bytes. */
export class SkillsReleaseError extends Error {
  constructor(
    public readonly code: SkillsReleaseErrorCode,
    public readonly retryable: boolean,
  ) {
    super(code === 'release_unavailable' ? 'Published skills release is unavailable.' : 'Published skills release is invalid.');
    this.name = 'SkillsReleaseError';
  }
}

function invalid(): never {
  throw new SkillsReleaseError('release_invalid', false);
}

function hash(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function requestOptions(cache?: RequestCache): RequestInit {
  const token = fieldnoteSkillsGithubToken();
  return {
    ...(cache ? { cache } : {}),
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
}

async function responseJson(fetcher: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    throw new SkillsReleaseError('release_unavailable', true);
  }
  if (!response.ok) {
    throw new SkillsReleaseError(
      'release_unavailable',
      response.status === 403 || response.status === 429 || response.status >= 500,
    );
  }
  try {
    return await response.json();
  } catch {
    invalid();
  }
}

async function readContent(
  fetcher: typeof fetch,
  path: string,
  revision: string,
): Promise<{ bytes: Buffer; size: number }> {
  const value = await responseJson(
    fetcher,
    `${repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(revision)}`,
    requestOptions('force-cache'),
  );
  const parsed = contentSchema.safeParse(value);
  if (!parsed.success) invalid();
  if (parsed.data.size > maxFileBytes) invalid();
  let bytes: Buffer;
  try {
    bytes = Buffer.from(parsed.data.content.replace(/\s/g, ''), 'base64');
  } catch {
    invalid();
  }
  if (bytes.byteLength !== parsed.data.size) invalid();
  return { bytes, size: bytes.byteLength };
}

function decodeText(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return invalid();
  }
}

function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    return invalid();
  }
}

function addBytes(total: number, bytes: number): number {
  const next = total + bytes;
  if (next > maxReleaseBytes) invalid();
  return next;
}

function assertMatchingMetadata(
  tag: string,
  metadata: z.infer<typeof releaseMetadataSchema>,
  lock: z.infer<typeof lockSchema>,
  catalog: z.infer<typeof catalogSchema>,
) {
  if (metadata.release !== tag || lock.release !== tag || catalog.skills.length !== lock.skills.length)
    invalid();
  const catalogNames = new Set(catalog.skills.map((skill) => skill.name));
  const lockNames = new Set(lock.skills.map((skill) => skill.name));
  if (catalogNames.size !== catalog.skills.length || lockNames.size !== lock.skills.length) invalid();
  for (const skill of catalog.skills) {
    const locked = lock.skills.find((candidate) => candidate.name === skill.name);
    if (!locked || locked.version !== skill.version || Object.keys(locked.files).length === 0) invalid();
  }
}

// Presentation needs only the cached moving tag. Commit and content validation
// still runs at authoring boundaries through latestSkillsRelease/readSkillsRelease.
export async function latestSkillsReleaseTag(fetcher: typeof fetch = fetch): Promise<string> {
  const value = await responseJson(fetcher, `${repository}/releases/latest`, {
    ...requestOptions(),
    next: { revalidate: 300 },
  });
  const latest = latestReleaseSchema.safeParse(value);
  if (!latest.success) invalid();
  return latest.data.tag_name;
}

export async function latestSkillsRelease(fetcher: typeof fetch = fetch): Promise<SkillsRelease> {
  return readSkillsRelease(await latestSkillsReleaseTag(fetcher), fetcher);
}

export async function readSkillsRelease(
  tag: string,
  fetcher: typeof fetch = fetch,
): Promise<SkillsRelease> {
  if (!releaseTag.test(tag)) invalid();
  const commit = commitSchema.safeParse(
    await responseJson(fetcher, `${repository}/commits/${encodeURIComponent(tag)}`, requestOptions()),
  );
  if (!commit.success) invalid();
  const revision = commit.data.sha;

  let totalBytes = 0;
  const metadataContent = await readContent(fetcher, 'release.json', revision);
  totalBytes = addBytes(totalBytes, metadataContent.size);
  const catalogContent = await readContent(fetcher, 'catalog.json', revision);
  totalBytes = addBytes(totalBytes, catalogContent.size);
  const lockContent = await readContent(fetcher, 'skills.lock.json', revision);
  totalBytes = addBytes(totalBytes, lockContent.size);

  const metadata = parseJson(decodeText(metadataContent.bytes), releaseMetadataSchema);
  const catalog = parseJson(decodeText(catalogContent.bytes), catalogSchema);
  const lock = parseJson(decodeText(lockContent.bytes), lockSchema);
  assertMatchingMetadata(tag, metadata, lock, catalog);

  const skills = [] as SkillsRelease['skills'];
  for (const catalogSkill of catalog.skills) {
    const locked = lock.skills.find((skill) => skill.name === catalogSkill.name)!;
    const files: ReleaseFile[] = [];
    const promptParts: string[] = [];
    for (const [path, file] of Object.entries(locked.files).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    )) {
      const content = await readContent(fetcher, `skills/${catalogSkill.name}/${path}`, revision);
      totalBytes = addBytes(totalBytes, content.size);
      const contentHash = hash(content.bytes);
      if (contentHash !== file.hash) invalid();
      if (file.role === 'prompt') promptParts.push(`${path} ${contentHash}`);
      files.push({ path, content: decodeText(content.bytes), hash: contentHash });
    }
    if (hash(promptParts.join('\n')) !== locked.coreHash) invalid();
    skills.push({ name: catalogSkill.name, version: catalogSkill.version, files });
  }
  return { release: tag, revision, releaseLockHash: hash(lockContent.bytes), skills };
}
