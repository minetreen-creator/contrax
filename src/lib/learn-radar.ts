import { US_STATES } from "./states";
export const LEARN_RADAR_COURSES = ["construction-v1", "government-bids-intermediate-v1", "government-strategy-advanced-v1"] as const;
export function learnBusinessSearch(search: Record<string, unknown>): {state:string;trade:string} {
  const state=typeof search.state === "string" ? search.state.trim().toUpperCase() : "";
  return {state:(US_STATES as readonly string[]).includes(state)?state:"",trade:typeof search.trade === "string"?search.trade.trim().slice(0,120):""};
}
export function learnRadarHref(course: string, search: Record<string,unknown>): string {
  const {state,trade}=learnBusinessSearch(search);
  return `/radar?${new URLSearchParams({source:"learn",course,state,trade})}`;
}
export function learnNextCourseHref(href: string, search: Record<string,unknown>): string {
  const {state,trade}=learnBusinessSearch(search);
  return `${href}?${new URLSearchParams({state,trade})}`;
}
export function isLearnRadarVisit(search: Record<string,unknown>): boolean {
  return search.source === "learn" && (LEARN_RADAR_COURSES as readonly unknown[]).includes(search.course);
}
/** Radar accepts six-digit NAICS or trade words; broad 2/3-digit sectors use words. */
export function introductoryRadarTrade(trade: {id:string;naics:string;label:string}): string {
  return trade.id === "all" ? "construction" : /^\d{6}$/.test(trade.naics) ? trade.naics : trade.label;
}
