'use client';
import { useActionState, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Surface } from '@fieldnote/design-system';
import type { RepositoryChoice } from '../../domain/import/types';
import { filterRepositoryChoices } from '../../domain/import/onboarding';
import { startFirstAnalysis, refreshRepositoryAccess } from '../../app/onboarding/actions';
import { ImportProgress } from './import-progress';
export function RepositoryPicker({
  repositories,
  installUrl,
  allConnected = false,
}: {
  repositories: RepositoryChoice[];
  installUrl: string;
  allConnected?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [state, action, pending] = useActionState(startFirstAnalysis, {});
  // Retain the heading even if the action's revalidation removes the now-tracked choice.
  const [chosen, setChosen] = useState<RepositoryChoice | null>(null);
  const filtered = filterRepositoryChoices(repositories, search);
  const valid = repositories.some((repo) => repo.id === selected && repo.canAdmin);
  return (
    <div className="onboarding-workspace">
      <h2 className="onboarding-repository-heading">
        {chosen
          ? `${chosen.owner}/${chosen.name}`
          : allConnected
            ? 'All available repositories are connected'
            : 'Choose a repository'}
      </h2>
      {state.run && chosen ? (
        <ImportProgress
          key={state.run.id}
          initial={state.run}
          repository={chosen}
          canAdmin={chosen.canAdmin}
          focusOnMount
        />
      ) : (
        <Surface className="onboarding-panel">
          {allConnected ? (
            <p>
              View your engineering records or give the app access to another repository.{' '}
              <Link href="/dashboard">View overview</Link>
            </p>
          ) : (
            <p>Import the latest 100 pull requests and their CI history.</p>
          )}
          {repositories.length ? (
            <>
              <label htmlFor="repository-search">Find a repository</label>
              <input
                id="repository-search"
                type="search"
                disabled={pending}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelected('');
                  setChosen(null);
                }}
              />
              <form action={action}>
                <fieldset disabled={pending} className="repository-choices">
                  <legend className="onboarding-sr-only">Repository</legend>
                  {filtered.map((repo) => (
                    <label className="repository-choice" key={repo.id}>
                      <input
                        type="radio"
                        name="repositoryId"
                        value={repo.id}
                        disabled={!repo.canAdmin}
                        checked={selected === repo.id}
                        onChange={() => {
                          setSelected(repo.id);
                          setChosen(repo);
                        }}
                      />
                      <span>
                        <strong>
                          {repo.owner}/{repo.name}
                        </strong>
                        <small>{repo.isPrivate ? 'Private repository' : 'Public repository'}</small>
                        {!repo.canAdmin && <small>Ask a repository admin to enable analysis</small>}
                      </span>
                    </label>
                  ))}
                </fieldset>
                {!filtered.length && <p>No repositories match your search.</p>}
                {state.error && <p role="alert">{state.error}</p>}
                <Button disabled={!valid || pending}>
                  {pending ? 'Starting analysis…' : 'Start first analysis'}
                </Button>
              </form>
            </>
          ) : (
            !allConnected && (
              <p>
                No accessible repositories are available to connect. Give the GitHub App access to a
                repository to begin.
              </p>
            )
          )}
          <RepositoryAccess installUrl={installUrl} />
        </Surface>
      )}
    </div>
  );
}
export function RepositoryAccess({ installUrl }: { installUrl: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="repository-access">
      {installUrl && <a href={installUrl}>Manage GitHub App access</a>}
      <p className="muted">
        If your organization requires approval, ask an owner to approve access.
      </p>
      <Button
        variant="quiet"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await refreshRepositoryAccess();
            router.refresh();
          })
        }
      >
        {pending ? 'Refreshing repositories…' : 'Refresh repositories'}
      </Button>
    </div>
  );
}
