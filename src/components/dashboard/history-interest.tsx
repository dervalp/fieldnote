'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { Button } from '@fieldnote/design-system';
import {
  historyInterestStatus,
  registerHistoryInterest,
} from '../../app/dashboard/history-actions';

type State = 'loading' | 'unregistered' | 'signed-out' | 'registered' | 'load-error' | 'save-error';

export function HistoryInterest() {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const request = useRef(0);
  const retryButton = useRef<HTMLButtonElement>(null);
  const success = useRef<HTMLParagraphElement>(null);
  const [state, setState] = useState<State>('loading');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (pending || !dialog.current?.open) return;
    if (state === 'save-error' || state === 'load-error') retryButton.current?.focus();
    if (state === 'registered') success.current?.focus();
  }, [pending, state]);

  function checkRegistration() {
    const version = ++request.current;
    setState('loading');
    startTransition(async () => {
      try {
        const result = await historyInterestStatus();
        if (version === request.current) setState(result.status);
      } catch {
        if (version === request.current) setState('load-error');
      }
    });
  }

  function register() {
    const version = ++request.current;
    startTransition(async () => {
      try {
        await registerHistoryInterest();
        if (version === request.current) setState('registered');
      } catch {
        if (version === request.current) setState('save-error');
      }
    });
  }

  return (
    <>
      <Button
        ref={trigger}
        type="button"
        className="expand-history"
        aria-haspopup="dialog"
        aria-controls={id}
        onClick={() => {
          dialog.current?.showModal();
          checkRegistration();
        }}
      >
        Expand history ↗
      </Button>
      <dialog
        ref={dialog}
        id={id}
        className="history-dialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onClose={() => {
          request.current++;
          trigger.current?.focus();
        }}
      >
        <Button type="button" className="history-close" onClick={() => dialog.current?.close()}>
          Close
        </Button>
        <p className="eyebrow">Coming soon</p>
        <h2 id={`${id}-title`}>Good work has a history.</h2>
        <p id={`${id}-description`}>
          Expanded history is coming soon. Older collected records stay stored; Free access
          continues to show your latest 100 PRs per repository.
        </p>
        <p>Registering interest helps us plan expanded history. It does not change your access.</p>
        <div aria-live="polite" aria-atomic="true">
          {state === 'loading' && <p role="status">Checking your registration…</p>}
          {state === 'registered' && (
            <p ref={success} role="status" tabIndex={-1}>
              Your interest is registered. Thank you!
            </p>
          )}
          {pending && state !== 'loading' && state !== 'registered' && (
            <p role="status">Registering your interest…</p>
          )}
        </div>
        {!pending && (state === 'load-error' || state === 'save-error') && (
          <p role="alert">
            {state === 'load-error'
              ? 'We could not check your registration.'
              : 'We could not register your interest.'}{' '}
            Try again, or sign in if your session has expired.
          </p>
        )}
        {(state === 'signed-out' || state === 'save-error' || state === 'load-error') && (
          <p>
            <a href="/api/auth/login">Sign in with GitHub</a> to register your interest.
          </p>
        )}
        {state !== 'registered' && state !== 'loading' && (
          <Button
            type="button"
            ref={retryButton}
            disabled={pending}
            onClick={state === 'load-error' ? checkRegistration : register}
          >
            {pending
              ? 'Registering…'
              : state === 'load-error' || state === 'save-error'
                ? 'Try again'
                : 'Register interest'}
          </Button>
        )}
      </dialog>
    </>
  );
}
