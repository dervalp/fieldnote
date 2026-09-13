import { AppShell } from '../../components/app-shell';
// Both settings pages read the signed-in session and the workspace database,
// so neither can be prerendered at build time.
export const dynamic = 'force-dynamic';
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppShell crumbs={[{ label: 'Settings' }]}>{children}</AppShell>;
}
