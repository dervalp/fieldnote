import { loadDetectionsForWorker } from '../db/queries/ai-involvement';
import { detectAgentCandidates } from '../domain/fieldnote-skills/adapters';
import type { SetupRepositorySnapshot } from '../domain/fieldnote-skills/types';
import { repositoryClient } from './repositories';

const limits = {
  entries: 15_000,
  documents: 400,
  fileBytes: 256 * 1024,
  totalBytes: 4 * 1024 * 1024,
};

type GitTreeEntry = { path?: string; sha?: string; mode?: string; type?: string; size?: number };

export type FieldnoteSetupCollectionErrorCode =
  | 'repository_unavailable'
  | 'installation_unavailable'
  | 'empty_repository'
  | 'github_unavailable'
  | 'collection_failed';

const messages: Record<FieldnoteSetupCollectionErrorCode, string> = {
  repository_unavailable: 'Repository or pinned commit is unavailable.',
  installation_unavailable: 'GitHub installation access is unavailable.',
  empty_repository: 'Repository has no commits to inspect.',
  github_unavailable: 'GitHub is temporarily unavailable. Try again later.',
  collection_failed: 'Repository setup evidence could not be collected.',
};

/** Safe to persist: provider errors and their request metadata never escape this boundary. */
export class FieldnoteSetupCollectionError extends Error {
  constructor(
    public readonly code: FieldnoteSetupCollectionErrorCode,
    public readonly retryable: boolean,
  ) {
    super(messages[code]);
    this.name = 'FieldnoteSetupCollectionError';
  }
}

function safeError(error: unknown): FieldnoteSetupCollectionError {
  if (error instanceof FieldnoteSetupCollectionError) return error;
  const status =
    typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
  const permissionDenied =
    status === 403 &&
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    /^Resource not accessible by integration(?:$| - )/.test(error.message);
  if (status === 401 || permissionDenied)
    return new FieldnoteSetupCollectionError('installation_unavailable', false);
  if (status === 404 || status === 410)
    return new FieldnoteSetupCollectionError('repository_unavailable', false);
  if (status === 409) return new FieldnoteSetupCollectionError('empty_repository', false);
  if (status === 403 || status === 429 || (typeof status === 'number' && status >= 500))
    return new FieldnoteSetupCollectionError('github_unavailable', true);
  return new FieldnoteSetupCollectionError('collection_failed', status === undefined);
}

async function withDeadline<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new FieldnoteSetupCollectionError('collection_failed', true));
      controller.abort();
    }, 30_000);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function context(repositoryId: string) {
  try {
    return await withDeadline(() => repositoryClient(repositoryId));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Repository unavailable:'))
      throw new FieldnoteSetupCollectionError('repository_unavailable', false);
    throw safeError(error);
  }
}

const isFile = (entry: GitTreeEntry) =>
  entry.type === 'blob' && ['100644', '100755'].includes(entry.mode ?? '');

const rootFiles = new Set([
  'README.md',
  'README.mdx',
  'CONTRIBUTING.md',
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'Dockerfile',
  'Procfile',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'vercel.json',
  'netlify.toml',
  'fly.toml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'PULL_REQUEST_TEMPLATE.md',
]);

function isSecretOrLock(path: string): boolean {
  if (path === '.fieldnote/skills.lock.json') return false;
  const name = path.split('/').at(-1)?.toLowerCase() ?? '';
  return (
    name.startsWith('.env') ||
    /(?:secret|credential|password|private[._-]?key|access[._-]?token)/.test(name) ||
    /(?:^|[._-])(?:lock|lockb|shrinkwrap)(?:[._-]|$)/.test(name) ||
    name === 'go.sum' ||
    /\.(?:pem|key|p12|pfx|der|crt)$/i.test(name)
  );
}

function isTextEvidencePath(path: string): boolean {
  return /\.(?:md|mdx|mdc|txt|json|toml|ya?ml)$/i.test(path);
}

const extensionlessAgentMarkers = new Set(['.cursor/rules']);

/** Text configuration and process documents; never arbitrary application source. */
function isRelevant(path: string): boolean {
  if (isSecretOrLock(path)) return false;
  if (rootFiles.has(path)) return true;
  if (path === '.github/copilot-instructions.md') return true;
  if (extensionlessAgentMarkers.has(path)) return true;
  if (
    (path.startsWith('.agents/') || path.startsWith('.claude/') || path.startsWith('.cursor/')) &&
    isTextEvidencePath(path)
  )
    return true;
  if (
    (path.startsWith('.devin/') || path.startsWith('.gemini/') || path.startsWith('.fieldnote/')) &&
    isTextEvidencePath(path)
  )
    return true;
  if (path.startsWith('.github/workflows/') && /\.ya?ml$/i.test(path)) return true;
  if (path === '.github/PULL_REQUEST_TEMPLATE.md') return true;
  if (path.startsWith('.github/PULL_REQUEST_TEMPLATE/') && /\.mdx?$/i.test(path)) return true;
  if (
    (path.startsWith('docs/adr/') ||
      path.startsWith('docs/decisions/') ||
      path.startsWith('adr/')) &&
    /\.mdx?$/i.test(path)
  )
    return true;
  return false;
}

type Candidate = { path: string; sha: string };
const installationLockPath = '.fieldnote/skills.lock.json';

/**
 * Collects a bounded, immutable setup snapshot. Repository content is evidence
 * only; callers must keep documents server-side and never treat them as instructions.
 */
export async function collectFieldnoteSetup(
  repositoryId: string,
  sha: string,
): Promise<SetupRepositorySnapshot> {
  try {
    const { repo, client } = await context(repositoryId);
    const identity = { owner: repo.owner, repo: repo.name };
    const { data: commit } = await withDeadline((signal) =>
      client.rest.git.getCommit({ request: { signal }, ...identity, commit_sha: sha }),
    );
    const { data: recursive } = await withDeadline((signal) =>
      client.rest.git.getTree({
        request: { signal },
        ...identity,
        tree_sha: commit.tree.sha,
        recursive: '1',
      }),
    );

    let complete = true;
    let entries = 0;
    let reservedBytes = 0;
    const paths = new Set<string>();
    const candidates: Candidate[] = [];
    const managedFiles: NonNullable<SetupRepositorySnapshot['managedFiles']> = [];
    let installationLock: SetupRepositorySnapshot['installationLock'] = null;
    const missingDocument = (path: string) => {
      // Git identity is sufficient to ask for explicit replacement of an unreadable lock.
      if (path !== installationLockPath || !installationLock) complete = false;
    };
    const consider = (entry: GitTreeEntry, prefix: string) => {
      const path = prefix + (entry.path ?? '');
      if (path === installationLockPath) {
        paths.add(path);
        if (
          !/^[a-f0-9]{40}$/.test(entry.sha ?? '') ||
          !/^[0-7]{6}$/.test(entry.mode ?? '') ||
          !['blob', 'tree', 'commit'].includes(entry.type ?? '')
        )
          complete = false;
        else installationLock = { blobSha: entry.sha!, mode: entry.mode!, type: entry.type! };
      }
      if (/^\.(?:agents|claude)\/skills\//.test(path) && entry.type !== 'tree') {
        if (
          managedFiles.length >= limits.documents ||
          path.length > 240 ||
          /[\x00-\x1f\x7f]/.test(path) ||
          !/^[a-f0-9]{40}$/.test(entry.sha ?? '') ||
          !entry.mode ||
          !entry.type
        )
          complete = false;
        else managedFiles.push({ path, blobSha: entry.sha!, mode: entry.mode, type: entry.type });
      }
      if (!isFile(entry) || !isRelevant(path)) return;
      paths.add(path);
      if (
        !entry.sha ||
        entry.size === undefined ||
        entry.size < 0 ||
        !Number.isSafeInteger(entry.size) ||
        entry.size > limits.fileBytes ||
        candidates.length >= limits.documents ||
        reservedBytes + entry.size > limits.totalBytes
      ) {
        missingDocument(path);
        return;
      }
      reservedBytes += entry.size;
      candidates.push({ path, sha: entry.sha });
    };
    const visit = (entry: GitTreeEntry, prefix: string) => {
      if (++entries > limits.entries) {
        complete = false;
        return false;
      }
      consider(entry, prefix);
      return true;
    };

    if (!recursive.truncated) {
      for (const entry of recursive.tree) if (!visit(entry, '')) break;
    } else {
      const queue = [{ sha: commit.tree.sha, prefix: '' }];
      let treeRequests = 0;
      for (let index = 0; index < queue.length; index++) {
        if (++treeRequests > limits.entries || entries >= limits.entries) {
          complete = false;
          break;
        }
        const current = queue[index];
        const { data: tree } = await withDeadline((signal) =>
          client.rest.git.getTree({ request: { signal }, ...identity, tree_sha: current.sha }),
        );
        if (tree.truncated) complete = false;
        for (const entry of tree.tree) {
          if (!visit(entry, current.prefix)) break;
          if (entry.type === 'tree') {
            if (!entry.sha || !entry.path) complete = false;
            else queue.push({ sha: entry.sha, prefix: `${current.prefix}${entry.path}/` });
          }
        }
        if (entries > limits.entries) break;
      }
    }

    candidates.sort((left, right) => left.path.localeCompare(right.path, 'en'));
    const documents: SetupRepositorySnapshot['documents'] = [];
    let totalBytes = 0;
    for (let index = 0; index < candidates.length; index += 4) {
      const batch = candidates.slice(index, index + 4);
      const blobs = await Promise.all(
        batch.map((candidate) =>
          withDeadline((signal) =>
            client.rest.git.getBlob({ ...identity, file_sha: candidate.sha, request: { signal } }),
          ).catch((error: unknown) => {
            if (candidate.path === installationLockPath && installationLock) return null;
            throw error;
          }),
        ),
      );
      for (let offset = 0; offset < blobs.length; offset++) {
        const result = blobs[offset];
        if (!result) continue;
        const { data } = result;
        const encoded = data.content.replace(/\s/g, '');
        if (
          data.encoding !== 'base64' ||
          data.size === null ||
          !Number.isSafeInteger(data.size) ||
          data.size < 0 ||
          data.size > limits.fileBytes ||
          encoded.length > Math.ceil(limits.fileBytes / 3) * 4 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
        ) {
          missingDocument(batch[offset].path);
          continue;
        }
        const bytes = Buffer.from(encoded, 'base64');
        if (
          bytes.length > limits.fileBytes ||
          totalBytes + bytes.length > limits.totalBytes ||
          bytes.includes(0)
        ) {
          missingDocument(batch[offset].path);
          continue;
        }
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          totalBytes += bytes.length;
          documents.push({ path: batch[offset].path, blobSha: batch[offset].sha, text });
        } catch {
          missingDocument(batch[offset].path);
        }
      }
      if (totalBytes >= limits.totalBytes && index + 4 < candidates.length) {
        complete = false;
        break;
      }
    }
    documents.sort((left, right) => left.path.localeCompare(right.path, 'en'));
    const sortedPaths = [...paths].sort((left, right) => left.localeCompare(right, 'en'));
    const detections = await loadDetectionsForWorker(repositoryId);
    return {
      sha,
      complete,
      paths: sortedPaths,
      documents,
      managedFiles: managedFiles.sort((left, right) => left.path.localeCompare(right.path, 'en')),
      installationLock,
      candidates: detectAgentCandidates({ paths: sortedPaths, detections }),
    };
  } catch (error) {
    throw safeError(error);
  }
}
