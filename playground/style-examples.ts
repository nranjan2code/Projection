// Fixed examples make the web theme review repeatable without model
// calls. Gallery uses HTTPS placeholders; the other illustrations are local.
// Keep every catalog component represented.
import { basicCatalog, type RenderArgs } from "@vak/core";

let next = 0;
const node = (type: string, props: Record<string, unknown> = {}, children?: unknown[]) => ({
  id: `sample-${++next}`, type, props, ...(children ? { children } : {}),
});
const section = (title: string, children: unknown[]) => node("section", { title }, children);
const grid = (children: unknown[]) => node("grid", { columns: 2 }, children);
const art = (sky: string, ground: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360"><rect width="600" height="360" fill="${sky}"/><path d="M0 280L180 110 340 270 470 150 600 280V360H0Z" fill="${ground}"/></svg>`)}`;
const image = art("#d8e3e2", "#7d9891");

export const styleExamples: RenderArgs[] = [
  ...basicCatalog.examples.map((ex) => ({ ...ex.render, title: ex.render.title ?? (ex.render.surface === "trips" ? "Cards and actions" : "Forms") })),
  {
    surface: "components", title: "Component reference", data: { form: { volume: 40, rating: 3 } },
    nodes: [{ ...node("stack", { gap: "lg" }, [
      section("Content and feedback", [
        node("text", { content: "A clear heading", variant: "heading" }),
        node("text", { content: "Body text with **emphasis**, a [link](https://example.com) and `inline code`." }),
        node("text", { content: "Supporting information uses a quieter voice.", variant: "caption" }),
        node("divider"),
        grid(["info", "success", "warning", "danger"].map((tone) => node("alert", { title: tone[0]!.toUpperCase() + tone.slice(1), body: "A short message with the next step.", tone }))),
        node("list", { items: ["Readable labels", "Consistent spacing", "Clear focus feedback"] }),
        node("stack", { direction: "horizontal" }, ["primary", "secondary", "danger", "link"].map((style) => node("button", { label: style[0]!.toUpperCase() + style.slice(1), style, action: "preview" }))),
      ]),
      section("Cards and comparisons", [
        grid([
          node("card", { title: "Project overview", subtitle: "Updated today", badge: "Draft", body: "Short content should feel comfortable, with room to breathe." }, [node("button", { label: "View details", action: "preview" })]),
          node("card", { title: "With an image", subtitle: "Local illustration", image, body: "The same spacing and type scale apply to media cards." }),
        ]),
        node("compare", { action: "preview", options: [{ name: "Essential", price: "$12", pros: ["Core features", "Email support"], cons: ["One workspace"] }, { name: "Team", price: "$24", best: true, pros: ["Shared workspaces", "Priority support"], note: "For small teams." }] }),
      ]),
      section("Progress and navigation", [
        node("split", { ratio: "1:1" }, [
          node("steps", { items: [{ title: "Details received", status: "done" }, { title: "Review in progress", status: "current" }, { title: "Ready to publish", status: "todo" }] }),
          node("timeline", { items: [{ date: "26 Oct", title: "Review started", description: "The first draft is ready." }, { date: "27 Oct", title: "Feedback", description: "Collect comments from the team." }] }),
        ]),
        grid([node("progress", { label: "Storage", value: 62, max: 100, unit: "GB" }), node("progress", { label: "Completion", value: 72, kind: "ring" })]),
        node("tabs", {}, [section("Overview", [node("text", { content: "Selected tab content." })]), section("Details", [node("text", { content: "The second tab panel." })])]),
        node("accordion", { items: [{ title: "Can an app bring its own branding?", body: "Yes. Set public CSS tokens on the app wrapper or on each surface." }, { title: "Does a local action call a model?", body: "Filtering, sorting and widget interactions run locally." }] }),
        node("tree", { items: [{ label: "Workspace", children: [{ label: "Documents" }, { label: "Assets" }] }] }),
      ]),
      section("Input controls", [node("form", { submit: "preview", submitLabel: "Save changes" }, [
        node("input", { label: "Project name", bind: "/form/project", placeholder: "Enter a name", checks: ["required"] }),
        node("date", { label: "Start date", bind: "/form/start" }),
        node("input", { label: "Volume", kind: "range", min: 0, max: 100, bind: "/form/volume" }),
        node("input", { label: "Rating", kind: "rating", bind: "/form/rating" }),
        node("input", { label: "Attachment", kind: "file", bind: "/form/file" }),
        node("textarea", { label: "Notes", bind: "/form/notes", placeholder: "Add a little context" }),
        node("select", { label: "Tags", bind: "/form/tags", options: ["Design", "Engineering", "Research"], multiple: true }),
        node("checkbox", { label: "Share with the team", bind: "/form/share" }),
      ])]),
      section("Work and schedules", [
        node("calendar", { date: "2026-10-26", events: [{ date: "2026-10-26", start: "10:00", title: "Design review", tone: "info" }, { date: "2026-10-28", start: "14:00", title: "Team check-in" }] }),
        node("board", { columns: ["Planned", "In progress", "Done"], cards: [{ id: "a", title: "Review typography", column: "Planned", tag: "Design" }, { id: "b", title: "Theme tokens", column: "In progress", note: "Support app-level overrides." }, { id: "c", title: "Local preview", column: "Done" }] }),
        node("gantt", { tasks: [{ title: "Design", start: "2026-10-26", end: "2026-10-28", progress: 65, group: "Review" }, { title: "Validation", start: "2026-10-28", end: "2026-10-30", progress: 20, group: "Build" }] }),
        node("timer", { label: "Focus session", duration: "5m" }),
      ]),
      section("Code and data", [
        node("code", { title: "hello.ts", language: "typescript", code: 'const greeting = "Hello";\nconsole.log(greeting);' }),
        node("diff", { title: "Change preview", before: 'const size = 16;\nconst weight = 700;', after: 'const size = 14;\nconst weight = 550;' }),
        node("math", { tex: "E = mc^2", caption: "Native math rendering" }),
        node("graph", { nodes: [{ id: "app", label: "App", group: "host" }, { id: "surface", label: "Surface", group: "view" }, { id: "theme", label: "Theme", group: "host" }], edges: [{ from: "app", to: "surface", label: "renders" }, { from: "theme", to: "surface", label: "styles" }] }),
      ]),
      section("Places and media", [
        node("map", { places: [{ name: "City library", address: "Central square", note: "A quiet place to work." }] }),
        node("image", { src: image, alt: "Abstract mountain landscape" }),
        node("gallery", { images: [{ src: "https://placehold.co/600x360/d8e3e2/53665f.png?text=Morning", alt: "Morning" }, { src: "https://placehold.co/600x360/eadfce/766954.png?text=Evening", alt: "Evening" }] }),
      ]),
    ]), id: "root" } as RenderArgs["nodes"][number]],
  },
];
