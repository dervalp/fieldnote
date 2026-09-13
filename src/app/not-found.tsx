import Link from 'next/link';
import { dashboardPath } from '../lib/app-routes';
export default function NotFound() {
  return (
    <div className="unavailable-panel" role="status">
      <h1>Page unavailable</h1>
      <p>This page is unavailable or you do not have access.</p>
      <Link href={dashboardPath()}>Return to overview →</Link>
    </div>
  );
}
