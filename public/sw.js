/* Contrax app — service worker: bid notifications for members. */
// Same-site paths only. /admin is allowed on purpose: this worker shares the "/"
// scope with the owner's Mission Control alerts, so it must open those too.
const safePath = (u) => (typeof u === "string" && u.startsWith("/") && !u.startsWith("//") ? u.slice(0, 200) : "/app");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { p = {}; }
  const title = typeof p.title === "string" ? p.title.slice(0, 100) : "Contrax";
  const body = typeof p.body === "string" ? p.body.slice(0, 240) : "New bids for you.";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/app-icon-192.png",
    badge: "/app-icon-192.png",
    tag: typeof p.tag === "string" ? p.tag.slice(0, 64) : undefined,
    data: { url: safePath(p.url) },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if ("focus" in w) { await w.focus(); if ("navigate" in w) return w.navigate(target); return; }
    }
    return self.clients.openWindow(target);
  })());
});
