'use client';
import { useActionState } from 'react';
import { Button } from '@fieldnote/design-system';
export function SettingsForm({
  action,
  children,
  submitLabel = 'Save changes',
}: {
  action: (form: FormData) => Promise<{ error?: string }>;
  children: React.ReactNode;
  submitLabel?: string;
}) {
  const [state, run, pending] = useActionState(
    async (_: { error?: string }, form: FormData) => action(form),
    {},
  );
  return (
    <form action={run} className="settings-form">
      {children}
      <Button variant="secondary" disabled={pending} type="submit">
        {pending ? 'Saving…' : submitLabel}
      </Button>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
