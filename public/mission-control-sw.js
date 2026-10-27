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
    data: { url: typeof payload.url === "string" && /^\/admin\//.test(payload.url) ? payload.url : "/admin/journeys" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const path = event.notification.data && event.notification.data.url ? event.notification.data.url : "/admin/journeys";
    const target = new URL(path, self.location.origin).href;
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
