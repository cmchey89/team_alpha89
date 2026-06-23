// app/page.tsx
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="zone-detail">
      <h1>DigClear</h1>
      <p>Underground utility clearance for working zones.</p>
      <p>
        <Link href="/login">Sign in</Link>
      </p>
    </main>
  );
}
