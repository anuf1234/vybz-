export const metadata = { title: "Offline" };

export default function Offline() {
  return (
    <section className="py-24 text-center">
      <h1 className="font-display text-3xl font-bold tracking-wide">You're offline</h1>
      <p className="mt-3 text-muted">Battles and votes need a connection. Reconnect and try again.</p>
    </section>
  );
}
