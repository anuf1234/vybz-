/** "42m left", "3h left", "2d left". Server-rendered; the page refreshes itself while a battle is live. */
export function timeLeft(until: Date, now = new Date()): string {
  const ms = until.getTime() - now.getTime();
  if (ms <= 0) return "closing";
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60 ? `${m % 60}m ` : ""}left`;
  return `${Math.floor(h / 24)}d left`;
}
