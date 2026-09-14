import type { RepositorySnapshot, SourceDocument } from '../domain/grading/types';
import { repositoryClient } from './repositories';

const limits = {
  entries: 10_000,
  documents: 200,
  fileBytes: 128 * 1024,
  totalBytes: 2 * 1024 * 1024,
};
/** Race the entire hook/auth chain as well as cancelling the endpoint transport. */
async function withDeadline<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new FileCollectionError('collection_failed', true));
      controller.abort();
    }, 30_000);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export type FileCollectionErrorCode =
  | 'repository_unavailable'
  | 'installation_unavailable'
  | 'empty_repository'
  | 'github_unavailable'
  | 'collection_failed';
const messages: Record<FileCollectionErrorCode, string> = {
  repository_unavailable: 'Repository or pinned commit is unavailable.',
  installation_unavailable: 'GitHub installation access is unavailable.',
  empty_repository: 'Repository has no commits to grade.',
  github_unavailable: 'GitHub is temporarily unavailable. Try again later.',
  collection_failed: 'Repository evidence could not be collected.',
};
/** Safe to persist: never retains provider errors, request metadata or content. */
export class FileCollectionError extends Error {
  constructor(
    public readonly code: FileCollectionErrorCode,
    public readonly retryable: boolean,
  ) {
    super(messages[code]);
    this.name = 'FileCollectionError';
  }
}
function safeError(error: unknown): FileCollectionError {
  if (error instanceof FileCollectionError) return error;
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
    return new FileCollectionError('installation_unavailable', false);
  if (status === 404 || status === 410)
    return new FileCollectionError('repository_unavailable', false);
  if (status === 409) return new FileCollectionError('empty_repository', false);
  if (status === 403 || status === 429 || (typeof status === 'number' && status >= 500))
    return new FileCollectionError('github_unavailable', true);
  // Network and timeout failures have no HTTP status and can be retried durably.
  return new FileCollectionError('collection_failed', status === undefined);
}
async function context(repositoryId: string) {
  try {
    return await withDeadline(() => repositoryClient(repositoryId));
  } catch (error) {
    // The existing lookup uses this fixed prefix for missing/inactive/demo records.
    if (error instanceof Error && error.message.startsWith('Repository unavailable:'))
      throw new FileCollectionError('repository_unavailable', false);
    throw safeError(error);
  }
}
/** Resolve in a durable step, persist the SHA, then pass it to collectFiles. */
export async function resolveHeadSha(repositoryId: string): Promise<string> {
  try {
    const { repo, client } = await context(repositoryId);
    const identity = { owner: repo.owner, repo: repo.name };
    const { data } = await withDeadline((signal) =>
      client.rest.repos.get({ ...identity, request: { signal } }),
    );
    const commit = await withDeadline((signal) =>
      client.rest.repos.getCommit({ ...identity, ref: data.default_branch, request: { signal } }),
    );
    return commit.data.sha;
  } catch (error) {
    throw safeError(error);
  }
}
type TreeEntry = { path?: string; sha?: string; mode?: string; type?: string; size?: number };
function relevant(path: string) {
  return (
    path === 'AGENTS.md' ||
    path === 'CLAUDE.md' ||
    /^readme\.md$/i.test(path) ||
    (/^docs\//i.test(path) && /\.(?:md|markdown)$/i.test(path))
  );
}
/** Server-side evidence collection only; callers must not serialize raw documents to clients. */
export async function collectFiles(
  repositoryId: string,
  sha?: string,
): Promise<RepositorySnapshot> {
  try {
    const pinnedSha = sha ?? (await resolveHeadSha(repositoryId));
    const { repo, client } = await context(repositoryId);
    const identity = { owner: repo.owner, repo: repo.name };
    const { data: commit } = await withDeadline((signal) =>
      client.rest.git.getCommit({
        request: { signal },
        ...identity,
        commit_sha: pinnedSha,
      }),
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
    const candidates: { path: string; sha: string }[] = [];
    let reservedBytes = 0;
    function consider(entry: TreeEntry, prefix: string) {
      const path = prefix + (entry.path ?? '');
      if (
        entry.type !== 'blob' ||
        !['100644', '100755'].includes(entry.mode ?? '') ||
        !relevant(path)
      )
        return;
      if (
        !entry.sha ||
        entry.size === undefined ||
        entry.size < 0 ||
        !Number.isSafeInteger(entry.size) ||
        entry.size > limits.fileBytes ||
        candidates.length >= limits.documents ||
        reservedBytes + entry.size > limits.totalBytes
      ) {
        complete = false;
        return;
      }
      reservedBytes += entry.size;
      candidates.push({ path, sha: entry.sha });
    }
    if (!recursive.truncated) {
      for (const entry of recursive.tree) {
        if (++entries > limits.entries) {
          complete = false;
          break;
        }
        consider(entry, '');
      }
    } else {
      // Discard partial recursive data and traverse the immutable root breadth first.
      const queue = [{ sha: commit.tree.sha, prefix: '' }];
      let treeRequests = 0;
      for (let index = 0; index < queue.length; index++) {
        if (++treeRequests > limits.entries || entries >= limits.entries) {
          complete = false;
          break;
        }
        const current = queue[index];
        const { data: tree } = await withDeadline((signal) =>
          client.rest.git.getTree({
            request: { signal },
            ...identity,
            tree_sha: current.sha,
          }),
        );
        if (tree.truncated) complete = false;
        for (const entry of tree.tree) {
          if (++entries > limits.entries) {
            complete = false;
            break;
          }
          consider(entry, current.prefix);
          if (entry.type === 'tree') {
            if (!entry.sha || !entry.path) complete = false;
            else queue.push({ sha: entry.sha, prefix: `${current.prefix}${entry.path}/` });
          }
        }
        if (entries > limits.entries) break;
      }
    }
    const documents: SourceDocument[] = [];
    let totalBytes = 0;
    // Batches bound concurrency and make byte accounting/order deterministic.
    for (let index = 0; index < candidates.length; index += 4) {
      const batch = candidates.slice(index, index + 4);
      const blobs = await Promise.all(
        batch.map((candidate) =>
          withDeadline((signal) =>
            client.rest.git.getBlob({ ...identity, file_sha: candidate.sha, request: { signal } }),
          ),
        ),
      );
      for (let offset = 0; offset < blobs.length; offset++) {
        const { data } = blobs[offset];
        // Check encoded length before allocating/decoding, then actual decoded bytes.
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
          complete = false;
          continue;
        }
        const bytes = Buffer.from(encoded, 'base64');
        if (
          bytes.length > limits.fileBytes ||
          totalBytes + bytes.length > limits.totalBytes ||
          bytes.includes(0)
        ) {
          complete = false;
          continue;
        }
        totalBytes += bytes.length;
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          documents.push({ path: batch[offset].path, blobSha: batch[offset].sha, text });
        } catch {
          complete = false;
        }
      }
      if (totalBytes >= limits.totalBytes && index + 4 < candidates.length) {
        complete = false;
        break;
      }
    }
    return { sha: pinnedSha, complete, documents };
  } catch (error) {
    throw safeError(error);
  }
}
