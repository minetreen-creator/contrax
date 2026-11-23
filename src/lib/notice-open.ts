/** Tell the server a member tapped a bid's official notice link. Fire-and-forget: it never delays or blocks the link. */
export function noteNoticeOpen(bidId: number | string | null | undefined): void {
  const id = Number(bidId);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof navigator === "undefined") return;
  try {
    const body = JSON.stringify({ bid_id: id });
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/bid-notice-open", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/bid-notice-open", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* the link still opens */
  }
}
