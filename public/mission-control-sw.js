/* Contrax Mission Control — owner web push service worker. */
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = typeof payload.title === "string" ? payload.title.slice(0, 100) : "Contrax · Visitor online";
  const body = typeof payload.body === "string" ? payload.body.slice(0, 240) : "A visitor started a session.";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/logo.png",
    badge: "/logo.png",
    tag: typeof payload.tag === "string" ? payload.tag : undefined,
    data: { url: "/admin/journeys" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL("/admin/journeys", self.location.origin).href;
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
