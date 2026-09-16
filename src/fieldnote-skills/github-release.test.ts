import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { latestSkillsRelease, readSkillsRelease } from './github-release';

const repository = 'https://api.github.com/repos/dervalp/fieldnote-skills';
const digest = (value: string | Buffer) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;
const encode = (value: string | Buffer) => Buffer.from(value).toString('base64');

type FakeOptions = {
  corrupt?: string;
  latestTag?: string;
  metadataRelease?: string;
  lockRelease?: string;
  skillCount?: number;
  fileBytes?: number;
  filePath?: string;
  fileContent?: Buffer;
  metadataPadding?: number;
  normalizedBinaryLockHash?: boolean;
  corruptCoreHash?: boolean;
  responseStatus?: { endpoint: string; status: number; message: string };
};

function contentResponse(path: string, value: string | Buffer) {
  return {
    type: 'file',
    encoding: 'base64',
    size: Buffer.byteLength(value),
    name: path.split('/').at(-1)!,
    path,
    content: encode(value),
    sha: createHash('sha1').update(value).digest('hex'),
    url: `${repository}/contents/${path}`,
    git_url: `https://api.github.com/repos/dervalp/fieldnote-skills/git/blobs/example`,
    html_url: `https://github.com/dervalp/fieldnote-skills/blob/skills-v0.1.0/${path}`,
    download_url: `https://raw.githubusercontent.com/dervalp/fieldnote-skills/skills-v0.1.0/${path}`,
    _links: {
      self: `${repository}/contents/${path}`,
      git: 'https://api.github.com/repos/dervalp/fieldnote-skills/git/blobs/example',
      html: `https://github.com/dervalp/fieldnote-skills/blob/skills-v0.1.0/${path}`,
    },
  };
}

function fakeFetch(options: FakeOptions = {}) {
  const tag = options.latestTag ?? 'skills-v0.1.0';
  const revision = `a${'1'.repeat(39)}`;
  const count = options.skillCount ?? 1;
  const files = Array.from({ length: count }, (_, index) => {
    const name = count === 1 ? 'fieldnote-testing' : `fieldnote-skill-${index}`;
    const content =
      options.fileContent ??
      (options.fileBytes === undefined
        ? '# Fieldnote testing\n\nUse test-first development.\n'
        : 'x'.repeat(options.fileBytes));
    return { name, content };
  });
  const path = options.filePath ?? 'SKILL.md';
  const catalog = {
    version: 1,
    skills: files.map(({ name }) => ({
      name,
      stage: 'review',
      description: 'A published Fieldnote skill.',
      surface: 'code',
      version: '0.1.0',
      mcp: [],
      variance: 'templated',
      concerns: ['shared'],
    })),
  };
  const lock = {
    release: options.lockRelease ?? tag,
    skills: files.map(({ name, content }) => {
      const fileHash = options.normalizedBinaryLockHash ? digest(Buffer.from(content).toString('utf8')) : digest(content);
      return {
      name,
      version: '0.1.0',
      coreHash: options.corruptCoreHash ? digest(`${content}corrupt`) : digest(`${path} ${fileHash}`),
      files: {
        [path]: { role: 'prompt', hash: fileHash },
      },
    };
    }),
  };
  const releaseMetadata = {
    release: options.metadataRelease ?? tag,
    ...(options.metadataPadding === undefined ? {} : { padding: 'x'.repeat(options.metadataPadding) }),
  };
  const encoded = {
    'release.json': JSON.stringify(releaseMetadata),
    'catalog.json': JSON.stringify(catalog),
    'skills.lock.json': JSON.stringify(lock),
    ...Object.fromEntries(
      files.map(({ name, content }) => [
        `skills/${name}/${path}`,
        options.corrupt === name ? `${content}corrupt` : content,
      ]),
    ),
  };
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init });
    const endpoint = `${new URL(url).pathname}${new URL(url).search}`;
    if (options.responseStatus?.endpoint === endpoint)
      return new Response(JSON.stringify({ message: options.responseStatus.message }), {
        status: options.responseStatus.status,
      });
    if (endpoint === '/repos/dervalp/fieldnote-skills/releases/latest')
      return Response.json({
        url: `${repository}/releases/1`,
        html_url: 'https://github.com/dervalp/fieldnote-skills/releases/tag/skills-v0.1.0',
        assets_url: `${repository}/releases/1/assets`,
        upload_url: `${repository}/releases/1/assets{?name,label}`,
        tarball_url: `${repository}/tarball/skills-v0.1.0`,
        zipball_url: `${repository}/zipball/skills-v0.1.0`,
        id: 1,
        node_id: 'RE_kwDOExample',
        tag_name: tag,
        target_commitish: 'main',
        name: tag,
        body: 'Published Fieldnote Skills.',
        draft: false,
        prerelease: false,
        created_at: '2026-09-16T00:00:00Z',
        published_at: '2026-09-16T00:00:00Z',
        author: {
          login: 'dervalp',
          id: 1,
          node_id: 'MDQ6VXNlcjE=',
          avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
          gravatar_id: '',
          url: 'https://api.github.com/users/dervalp',
          html_url: 'https://github.com/dervalp',
          followers_url: 'https://api.github.com/users/dervalp/followers',
          following_url: 'https://api.github.com/users/dervalp/following{/other_user}',
          gists_url: 'https://api.github.com/users/dervalp/gists{/gist_id}',
          starred_url: 'https://api.github.com/users/dervalp/starred{/owner}{/repo}',
          subscriptions_url: 'https://api.github.com/users/dervalp/subscriptions',
          organizations_url: 'https://api.github.com/users/dervalp/orgs',
          repos_url: 'https://api.github.com/users/dervalp/repos',
          events_url: 'https://api.github.com/users/dervalp/events{/privacy}',
          received_events_url: 'https://api.github.com/users/dervalp/received_events',
          type: 'User',
          user_view_type: 'public',
          site_admin: false,
        },
        assets: [],
      });
    if (endpoint === `/repos/dervalp/fieldnote-skills/commits/${tag}`)
      return Response.json({
        sha: revision,
        node_id: 'C_kwDOExample',
        commit: {
          author: { name: 'Fieldnote', email: 'skills@example.com', date: '2026-09-16T00:00:00Z' },
          committer: { name: 'Fieldnote', email: 'skills@example.com', date: '2026-09-16T00:00:00Z' },
          message: 'release skills-v0.1.0',
          tree: { sha: `b${'2'.repeat(39)}`, url: `${repository}/git/trees/example` },
          url: `${repository}/git/commits/example`,
          comment_count: 0,
          verification: { verified: false, reason: 'unsigned', signature: null, payload: null },
        },
        url: `${repository}/commits/${revision}`,
        html_url: `https://github.com/dervalp/fieldnote-skills/commit/${revision}`,
        comments_url: `${repository}/commits/${revision}/comments`,
        author: null,
        committer: null,
        parents: [],
      });
    const contentPath = endpoint.match(/^\/repos\/dervalp\/fieldnote-skills\/contents\/(.+)\?ref=(.+)$/);
    const requestedPath = contentPath ? decodeURIComponent(contentPath[1]) : undefined;
    if (contentPath && contentPath[2] === revision && requestedPath && encoded[requestedPath as keyof typeof encoded])
      return Response.json(contentResponse(requestedPath, encoded[requestedPath as keyof typeof encoded]));
    return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
  }) as typeof fetch;

  return { fetcher, calls, revision, lock, files };
}

describe('published Fieldnote Skills releases', () => {
  it('resolves the latest immutable release and only revalidates moving metadata', async () => {
    const source = fakeFetch();

    await expect(latestSkillsRelease(source.fetcher)).resolves.toEqual({
      release: 'skills-v0.1.0',
      revision: source.revision,
      releaseLockHash: digest(JSON.stringify(source.lock)),
      skills: [
        {
          name: 'fieldnote-testing',
          version: '0.1.0',
          files: [
            {
              path: 'SKILL.md',
              content: '# Fieldnote testing\n\nUse test-first development.\n',
              hash: digest('# Fieldnote testing\n\nUse test-first development.\n'),
            },
          ],
        },
      ],
    });
    expect(source.calls[0]).toMatchObject({
      url: `${repository}/releases/latest`,
      init: { next: { revalidate: 300 } },
    });
    expect(source.calls.slice(1)).not.toContainEqual(
      expect.objectContaining({ init: expect.objectContaining({ next: expect.anything() }) }),
    );
    expect(source.calls.slice(2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ init: expect.objectContaining({ cache: 'force-cache' }) }),
      ]),
    );
  });

  it.each(['skills-v0.1.0', 'skills-v0.1.1'])(
    'pins an ordinary or annotated %s tag through its commit endpoint',
    async (tag) => {
      const source = fakeFetch({ latestTag: tag });

      const release = await readSkillsRelease(tag, source.fetcher);

      expect(release.revision).toBe(source.revision);
      expect(source.calls[0].url).toBe(`${repository}/commits/${tag}`);
    },
  );

  it('rejects a downloaded skill whose bytes do not match its lock hash', async () => {
    const source = fakeFetch({ corrupt: 'fieldnote-testing' });

    await expect(readSkillsRelease('skills-v0.1.0', source.fetcher)).rejects.toMatchObject({
      code: 'release_invalid',
      retryable: false,
    });
  });

  it('rejects a prompt-file core hash that does not match the locked files', async () => {
    const source = fakeFetch({ corruptCoreHash: true });

    await expect(readSkillsRelease('skills-v0.1.0', source.fetcher)).rejects.toMatchObject({
      code: 'release_invalid',
      retryable: false,
    });
  });

  it('rejects a tag whose release metadata does not agree with the requested tag', async () => {
    const source = fakeFetch({ metadataRelease: 'skills-v9.9.9' });

    await expect(readSkillsRelease('skills-v0.1.0', source.fetcher)).rejects.toMatchObject({
      code: 'release_invalid',
      retryable: false,
    });
  });

  it('encodes URL-reserved locked file paths without losing the immutable revision', async () => {
    const source = fakeFetch({ filePath: 'SKILL.md#published' });

    await expect(readSkillsRelease('skills-v0.1.0', source.fetcher)).resolves.toMatchObject({
      revision: source.revision,
      skills: [{ files: [{ path: 'SKILL.md#published' }] }],
    });
    expect(source.calls.at(-1)?.url).toBe(
      `${repository}/contents/skills/fieldnote-testing/SKILL.md%23published?ref=${source.revision}`,
    );
  });

  it('rejects invalid UTF-8 whose normalized text would otherwise match the lock', async () => {
    const source = fakeFetch({
      fileContent: Buffer.from([0xc3, 0x28]),
      normalizedBinaryLockHash: true,
    });

    await expect(readSkillsRelease('skills-v0.1.0', source.fetcher)).rejects.toMatchObject({
      code: 'release_invalid',
      retryable: false,
    });
  });

  it('rejects oversized decoded release metadata before parsing it', async () => {
    const source = fakeFetch({ metadataPadding: 256 * 1024 });

    await expect(readSkillsRelease('skills-v0.1.0', source.fetcher)).rejects.toMatchObject({
      code: 'release_invalid',
      retryable: false,
    });
  });

  it('rejects releases with more than 100 catalogued skills', async () => {
    const source = fakeFetch({ skillCount: 101 });

    await expect(readSkillsRelease('skills-v0.1.0', source.fetcher)).rejects.toMatchObject({
      code: 'release_invalid',
      retryable: false,
    });
  });

  it('rejects an individual decoded skill file above 256 KiB', async () => {
    const source = fakeFetch({ fileBytes: 256 * 1024 + 1 });

    await expect(readSkillsRelease('skills-v0.1.0', source.fetcher)).rejects.toMatchObject({
      code: 'release_invalid',
      retryable: false,
    });
  });

  it('rejects a decoded release above 8 MiB', async () => {
    const source = fakeFetch({ skillCount: 33, fileBytes: 256 * 1024 });

    await expect(readSkillsRelease('skills-v0.1.0', source.fetcher)).rejects.toMatchObject({
      code: 'release_invalid',
      retryable: false,
    });
  });

  it('converts provider failures into stable errors without provider response text', async () => {
    const providerMessage = 'rate limit details that must not be stored';
    const source = fakeFetch({
      responseStatus: {
        endpoint: '/repos/dervalp/fieldnote-skills/releases/latest',
        status: 503,
        message: providerMessage,
      },
    });

    const error = await latestSkillsRelease(source.fetcher).catch((failure: unknown) => failure);

    expect(error).toMatchObject({ code: 'release_unavailable', retryable: true });
    expect(JSON.stringify(error)).not.toContain(providerMessage);
    expect(String(error)).not.toContain(providerMessage);
  });
});
