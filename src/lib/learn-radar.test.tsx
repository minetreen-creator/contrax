import { expect,test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CourseOpportunity } from "~/components/CourseOpportunity";
import { learnBusinessSearch,learnRadarHref,learnNextCourseHref,isLearnRadarVisit,LEARN_RADAR_COURSES,introductoryRadarTrade } from "./learn-radar";
test("course handoff preserves state, keyword/NAICS and origin with safe encoding",()=>{
 const url=new URL(learnRadarHref("construction-v1",{state:" va ",trade:"electrical & HVAC"}),"https://www.contrax.company");
 expect(url.pathname).toBe("/radar");expect(url.searchParams.get("state")).toBe("VA");expect(url.searchParams.get("trade")).toBe("electrical & HVAC");expect(url.searchParams.get("source")).toBe("learn");
 expect(learnBusinessSearch({state:"bad",trade:{}})).toEqual({state:"",trade:""});expect(learnBusinessSearch({trade:"x".repeat(200)}).trade.length).toBe(120);
 expect(new URL(learnNextCourseHref("/learn/advanced-government-contracting",{state:"NE",trade:"561720"}),"https://www.contrax.company").searchParams.get("trade")).toBe("561720");
});
test("learner save invitation is scoped to known course handoffs",()=>{
 for(const course of LEARN_RADAR_COURSES)expect(isLearnRadarVisit({source:"learn",course})).toBe(true);
 expect(isLearnRadarVisit({source:"other",course:"construction-v1"})).toBe(false);expect(isLearnRadarVisit({source:"learn",course:"unknown"})).toBe(false);
});
test("each course offers an ungated accessible search with contextual fields",()=>{
 for(const courseId of LEARN_RADAR_COURSES){
  const html=renderToStaticMarkup(<CourseOpportunity courseId={courseId} initialState="NE" initialTrade="janitorial"/>);
  expect(html).toContain('action="/radar"');expect(html).toContain('name="trade"');expect(html).toContain('value="janitorial"');expect(html).toContain('value="NE" selected=""');expect(html).toContain(`value="${courseId}"`);expect(html).toContain("before completing the course");expect(html).toContain("These courses remain free");
 }
});

test("introductory course sectors hand off as searchable words; specialties retain NAICS",()=>{
 expect(introductoryRadarTrade({id:"all",naics:"23",label:"All construction"})).toBe("construction");
 expect(introductoryRadarTrade({id:"building",naics:"236",label:"Building construction"})).toBe("Building construction");
 expect(introductoryRadarTrade({id:"electrical",naics:"238210",label:"Electrical"})).toBe("238210");
});
