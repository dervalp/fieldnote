import Link from 'next/link';
import { eq, desc } from 'drizzle-orm';
import { Surface } from '@fieldnote/design-system';
import { db } from '../../../db';
import {
  users,
  workspaceMemberships,
  workspaceInvitations,
  invitationDeliveries,
} from '../../../db/schema';
import { requireWorkspace, accessibleRepositories } from '../../../workspaces/access';
import { SettingsForm } from '../../../components/settings-form';
import {
  saveWorkspaceName,
  createNamedWorkspace,
  inviteMember,
  resendInvite,
  revokeInvite,
  updateMember,
  deleteMember,
  disconnectRepository,
} from '../actions';
export const metadata = { title: 'Workspace settings' };
export default async function WorkspaceSettings() {
  const workspace = await requireWorkspace();
  const owner = workspace.role === 'owner';
  const demo = workspace.id === 'demo';
  const members = demo
    ? []
    : await db()
        .select({
          id: users.id,
          name: users.displayName,
          login: users.login,
          role: workspaceMemberships.role,
        })
        .from(workspaceMemberships)
        .innerJoin(users, eq(users.id, workspaceMemberships.userId))
        .where(eq(workspaceMemberships.workspaceId, workspace.id));
  const invitations = owner
    ? await db()
        .select({
          id: workspaceInvitations.id,
          email: workspaceInvitations.email,
          expiresAt: workspaceInvitations.expiresAt,
          revokedAt: workspaceInvitations.revokedAt,
          acceptedAt: workspaceInvitations.acceptedAt,
        })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.workspaceId, workspace.id))
        .orderBy(desc(workspaceInvitations.createdAt))
    : [];
  const deliveries = owner
    ? await db()
        .select({
          invitationId: invitationDeliveries.invitationId,
          state: invitationDeliveries.state,
        })
        .from(invitationDeliveries)
        .where(eq(invitationDeliveries.workspaceId, workspace.id))
        .orderBy(desc(invitationDeliveries.createdAt))
    : [];
  const repositories = await accessibleRepositories(workspace.id);
  return (
    <>
      <div className="eyebrow">A shared view of the work</div>
      <h1>Workspace settings</h1>
      <p className="page-intro">
        Manage the people and repositories that make up {workspace.name}.
      </p>
      <div className="settings-tabs">
        <Link href="/settings/account">Account</Link>
        <Link aria-current="page" href="/settings/workspace">
          Workspace
        </Link>
        <span className={owner ? 'owner-badge' : 'member-badge'}>{owner ? 'Owner' : 'Member'}</span>
      </div>
      <div className="settings-grid" key={workspace.id}>
        <div>
          <Surface className="settings-panel">
            <h2>Workspace name</h2>
            {owner ? (
              <SettingsForm action={saveWorkspaceName}>
                <label htmlFor="workspace-name">Workspace name</label>
                <input
                  id="workspace-name"
                  name="name"
                  defaultValue={workspace.name}
                  required
                  maxLength={80}
                />
              </SettingsForm>
            ) : (
              <>
                <p>{workspace.name}</p>
                <p className="fine">Only owners can change workspace settings.</p>
              </>
            )}
            <p className="fine">Your account and workspace are separate identities.</p>
          </Surface>
          <Surface className="settings-panel">
            <h2>Connected repositories</h2>
            <p className="fine">
              Every member can view analytics and grading evidence for all connected repositories,
              including private repositories.
            </p>
            {repositories.map((repo) => (
              <div className="settings-row" key={repo.id}>
                <Link href={`/repos/${repo.id}`}>
                  {repo.owner}/{repo.name}
                </Link>
                {owner && (
                  <SettingsForm action={disconnectRepository} submitLabel="Disconnect">
                    <input type="hidden" name="repositoryId" value={repo.id} />
                  </SettingsForm>
                )}
              </div>
            ))}
            {!repositories.length && <p>No repositories connected yet.</p>}
            {owner ? (
              <Link className="settings-link" href="/onboarding">
                Connect a repository →
              </Link>
            ) : (
              <p className="fine">Ask an owner to connect a repository.</p>
            )}
            {owner && <p className="fine">Connecting requires GitHub administrator access.</p>}
          </Surface>
          {!demo && (
            <Surface className="settings-panel" id="new-workspace">
              <h2>A fresh workspace</h2>
              <p className="fine">Create a separate home for another team or project.</p>
              <SettingsForm action={createNamedWorkspace} submitLabel="Create workspace">
                <label htmlFor="new-name">New workspace name</label>
                <input
                  id="new-name"
                  name="name"
                  placeholder="Your team’s name"
                  required
                  maxLength={80}
                />
              </SettingsForm>
            </Surface>
          )}
        </div>
        <div>
          <Surface className="settings-panel">
            <h2>Members & invitations</h2>
            {members.map((member) => (
              <div className="member-row" key={member.id}>
                <div className="member-identity">
                  <span className="account-avatar">
                    {(member.name ?? member.login).slice(0, 2).toUpperCase()}
                  </span>
                  <strong>{member.name ?? member.login}</strong>
                  <span className={member.role === 'owner' ? 'owner-badge' : 'member-badge'}>
                    {member.role === 'owner' ? 'Owner' : 'Member'}
                  </span>
                </div>
                {owner && (
                  <div className="member-controls">
                    <SettingsForm action={updateMember} submitLabel="Update role">
                      <input type="hidden" name="userId" value={member.id} />
                      <label className="sr-only" htmlFor={`role-${member.id}`}>
                        Role for {member.name ?? member.login}
                      </label>
                      <select id={`role-${member.id}`} name="role" defaultValue={member.role}>
                        <option value="member">Member</option>
                        <option value="owner">Owner</option>
                      </select>
                    </SettingsForm>
                    <SettingsForm action={deleteMember} submitLabel="Remove">
                      <input type="hidden" name="userId" value={member.id} />
                    </SettingsForm>
                  </div>
                )}
              </div>
            ))}
            {owner && (
              <>
                <h3>Invite a teammate</h3>
                <SettingsForm action={inviteMember} submitLabel="Send invitation">
                  <label htmlFor="invite-email">Email address</label>
                  <input
                    id="invite-email"
                    name="email"
                    type="email"
                    required
                    placeholder="teammate@company.com"
                  />
                </SettingsForm>
                <p className="fine">
                  Members can view all workspace repositories and run graders. Invitations expire in
                  7 days. Delivery status appears below.
                </p>
                {invitations.map((invitation) => {
                  const status = invitation.acceptedAt
                    ? 'Accepted'
                    : invitation.revokedAt
                      ? 'Revoked'
                      : invitation.expiresAt.getTime() <= Date.now()
                        ? 'Expired'
                        : (deliveries.find((delivery) => delivery.invitationId === invitation.id)
                            ?.state ?? 'pending');
                  return (
                    <div className="invitation-row" key={invitation.id}>
                      <div>
                        <strong>{invitation.email}</strong>
                        <span className={`delivery-status status-${status.toLowerCase()}`}>
                          {status}
                        </span>
                      </div>
                      {!invitation.acceptedAt && !invitation.revokedAt && (
                        <div className="member-controls">
                          <SettingsForm action={resendInvite} submitLabel="Resend">
                            <input type="hidden" name="invitationId" value={invitation.id} />
                          </SettingsForm>
                          <SettingsForm action={revokeInvite} submitLabel="Revoke">
                            <input type="hidden" name="invitationId" value={invitation.id} />
                          </SettingsForm>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </Surface>
        </div>
      </div>
    </>
  );
}
