// The benchmark: realistic requests across categories, single- and
// multi-turn. Structural checks say what a complete answer must contain;
// `intent` is what a semantic judge grades against.

import type { Check } from "./rubric.ts";

/** Bump when scenarios or checks change: baselines and cassettes record it. */
export const BENCH_VERSION = 3;

/** Simulated interaction with the UI the previous turn produced. */
export interface Act {
  /** "form": submit the first form. "button": press a button (optionally matching `label`). */
  target: "form" | "button";
  /** Regex (case-insensitive) choosing the button by label. */
  label?: string;
  /** Values by field: keys are regexes matched against a field's label or bind path. */
  fill?: Record<string, unknown>;
}

export interface Turn {
  say?: string;
  act?: Act;
  expect: Check[];
}

export interface Scenario {
  id: string;
  category: "comparison" | "dashboard" | "form" | "planning" | "information" | "interaction";
  intent: string;
  turns: Turn[];
}

const count = (types: string | string[], min = 1, max?: number): Check => ({ kind: "count", types: Array.isArray(types) ? types : [types], min, ...(max !== undefined ? { max } : {}) });
const text = (pattern: string, flags?: string): Check => ({ kind: "text", pattern, ...(flags ? { flags } : {}) });
const anyOf = (...checks: Check[]): Check => ({ kind: "anyOf", checks });
const prop = (type: string, path: string[], value: unknown): Check => ({ kind: "prop", type, path, value });
const actionable: Check = { kind: "actionable" };
const bound: Check = { kind: "bound" };
const changed: Check = { kind: "changed" };

/** Several options side by side: cards, or a table. */
// A comparison component (with its options side by side) answers these as well as cards or a table.
const options = (n: number): Check => anyOf(count("card", n), count("table"), count("compare"));

export const SCENARIOS: Scenario[] = [
  // --- comparison ----------------------------------------------------------------
  {
    id: "hotels-compare",
    category: "comparison",
    intent: "Three plausible Kyoto hotels for a November week, comparable at a glance, with a way to book one.",
    turns: [{ say: "Compare three hotels in Kyoto for a week in November and let me book one", expect: [options(3), actionable, text("kyoto")] }],
  },
  {
    id: "laptops-compare",
    category: "comparison",
    intent: "MacBook Air, Dell XPS 13 and ThinkPad X1 Carbon compared on price, weight and battery life.",
    turns: [
      {
        say: "Compare the MacBook Air, Dell XPS 13 and ThinkPad X1 Carbon on price, weight and battery life",
        expect: [options(3), text("xps"), text("thinkpad"), text("battery|hours")],
      },
    ],
  },
  {
    id: "phone-plans",
    category: "comparison",
    intent: "Three mobile plans with price and allowance, and a way to choose one.",
    turns: [{ say: "Show me three mobile phone plans and let me pick one", expect: [anyOf(options(3), count("select")), actionable] }],
  },
  {
    id: "restaurants",
    category: "comparison",
    intent: "Four date-night restaurants in Lisbon, each with cuisine and price level.",
    turns: [{ say: "Recommend four restaurants for a date night in Lisbon with price level and cuisine", expect: [options(4), text("cuisine|portuguese|seafood|italian|french")] }],
  },
  {
    id: "flights",
    category: "comparison",
    intent: "Several London→New York flight options next Friday, sorted cheapest first.",
    turns: [{ say: "Find me flight options from London to New York next Friday, cheapest first", expect: [options(2), text("london|lhr|lgw"), text("new york|jfk|ewr|nyc")] }],
  },
  // --- dashboard -----------------------------------------------------------------
  {
    id: "sales-q3",
    category: "dashboard",
    intent: "A Q3 sales dashboard: several KPIs, a monthly revenue chart and the top five products.",
    turns: [{ say: "Show a Q3 sales dashboard: KPIs, a monthly revenue chart and top 5 products", expect: [count("stat", 2), count("chart"), anyOf(count("table"), count("list"), count("card", 5))] }],
  },
  {
    id: "web-analytics",
    category: "dashboard",
    intent: "Last week's website analytics: visitors, bounce rate, daily traffic chart, top pages.",
    turns: [
      {
        say: "Show website analytics for last week: visitors, bounce rate, a daily traffic chart and top pages",
        expect: [count("stat", 2), count("chart"), anyOf(count("table"), count("list")), text("bounce")],
      },
    ],
  },
  {
    id: "budget-pie",
    category: "dashboard",
    intent: "A $4,000 monthly budget split into categories, shown as a pie chart.",
    turns: [{ say: "Break down my monthly budget of $4,000 into categories with a pie chart", expect: [text("\\[pie chart\\]"), text("4,?000|4k")] }],
  },
  {
    id: "server-health",
    category: "dashboard",
    intent: "Health of three servers: CPU, memory, and any alerts.",
    turns: [{ say: "Give me a server health overview for 3 servers with CPU, memory and any alerts", expect: [anyOf(count("stat", 3), count("table"), count("card", 3)), text("cpu"), text("memory|ram")] }],
  },
  {
    id: "running-week",
    category: "dashboard",
    intent: "This week's running: totals plus distance per day.",
    turns: [{ say: "Show my running stats for this week with distance per day", expect: [count("chart"), count(["stat", "table"])] }],
  },
  // --- form --------------------------------------------------------------------------
  {
    id: "newsletter",
    category: "form",
    intent: "A newsletter signup with name, email, topic choices and frequency.",
    turns: [{ say: "Make a newsletter signup form with name, email, topics and frequency", expect: [count("input", 2), count(["select", "checkbox"]), actionable, bound, text("email")] }],
  },
  {
    id: "job-application",
    category: "form",
    intent: "A frontend developer job application: contact details, experience, portfolio or resume.",
    turns: [{ say: "Create a job application form for a frontend developer role", expect: [count(["input", "textarea"], 3), count("form"), bound, text("portfolio|resume|cv|experience|cover")] }],
  },
  {
    id: "bug-report",
    category: "form",
    intent: "A bug report form with a severity choice and steps to reproduce.",
    turns: [{ say: "Give me a form to report a bug with severity and steps to reproduce", expect: [count("form"), count("select"), text("severity"), text("steps?"), bound] }],
  },
  {
    id: "wedding-rsvp",
    category: "form",
    intent: "An RSVP for a June 14 wedding with a meal choice and a plus-one option.",
    turns: [{ say: "Make an RSVP form for a wedding on June 14 with meal choice and plus-one", expect: [actionable, count(["select", "checkbox"]), text("meal|dinner|dish|menu|entr[eé]e"), text("plus.?one|guest"), bound] }],
  },
  {
    id: "csat-survey",
    category: "form",
    intent: "A short customer-satisfaction survey with four questions.",
    turns: [{ say: "Build a short customer satisfaction survey with 4 questions", expect: [count(["input", "textarea", "select", "checkbox", "date"], 4), actionable, bound] }],
  },
  // --- planning -----------------------------------------------------------------------
  {
    id: "workout-tabs",
    category: "planning",
    intent: "A 5-day beginner workout routine, one tab per day.",
    turns: [{ say: "Plan a 5-day beginner workout routine, one tab per day", expect: [anyOf(count("tabs"), count(["section", "card"], 5)), text("day")] }],
  },
  {
    id: "rome-itinerary",
    category: "planning",
    intent: "A 3-day Rome itinerary organised by day with real landmarks.",
    turns: [{ say: "Plan a 3-day itinerary for Rome", expect: [anyOf(count("tabs"), count(["section", "card"], 3)), text("colosseum|vatican|trevi|pantheon|forum")] }],
  },
  {
    id: "recipe",
    category: "planning",
    intent: "A vegetarian lasagna recipe with an ingredient list and numbered steps.",
    turns: [{ say: "Give me a recipe for vegetarian lasagna with ingredients and steps", expect: [count("list"), text("ingredient"), text("(^|\\n)\\s*1\\. "), text("bake|oven")] }],
  },
  {
    id: "sql-study-plan",
    category: "planning",
    intent: "A 4-week plan for learning SQL, organised by week.",
    turns: [{ say: "Create a 4-week study plan for learning SQL", expect: [anyOf(count("tabs"), count(["section", "card"], 4), count("table")), text("week"), text("sql|select|join")] }],
  },
  {
    id: "onboarding-checklist",
    category: "planning",
    intent: "A first-week onboarding checklist for a new engineer.",
    turns: [{ say: "Create an onboarding checklist for a new engineer's first week", expect: [anyOf(count("checkbox", 3), count("list")), text("laptop|access|account|repo|setup")] }],
  },
  // --- information ---------------------------------------------------------------------
  {
    id: "rest-vs-graphql",
    category: "information",
    intent: "REST and GraphQL compared on the dimensions that matter.",
    turns: [{ say: "Compare REST and GraphQL", expect: [options(2), text("rest"), text("graphql")] }],
  },
  {
    id: "paris-weather",
    category: "information",
    intent: "A 7-day weather forecast for Paris.",
    turns: [{ say: "Show a 7-day weather forecast for Paris", expect: [anyOf(count("card", 7), count("table"), count("chart"), count("stat", 7)), text("paris")] }],
  },
  // These supplied facts exercise the extended catalog without network access.
  // Record with tools/extended/examples/inline; the default 4B plan is core-only.
  {
    id: "release-timeline",
    category: "information",
    intent: "A timeline preserving three supplied release milestones in order, with their dates.",
    turns: [{
      say: "Show a timeline of these project milestones in order: 2026-01-10 Prototype; 2026-02-20 Beta; 2026-03-30 Launch. Use the timeline component.",
      expect: [count("timeline"), prop("timeline", ["items", "length"], 3), prop("timeline", ["items", "0", "date"], "2026-01-10"), prop("timeline", ["items", "0", "title"], "Prototype"), prop("timeline", ["items", "1", "title"], "Beta"), prop("timeline", ["items", "2", "title"], "Launch"), text("2026-02-20"), text("2026-03-30")],
    }],
  },
  {
    id: "team-graph",
    category: "information",
    intent: "A graph preserving three supplied people and their two labelled reporting relations.",
    turns: [{
      say: "Show how my team connects as a graph: Asha manages Ravi; Asha manages Meera.",
      expect: [count("graph"), prop("graph", ["nodes", "length"], 3), prop("graph", ["edges", "length"], 2), text("Asha"), text("Ravi"), text("Meera"), text("manages")],
    }],
  },
  // Everyday components (2026-10-26), phrased as people ask; the request names
  // the component, so small models keep it in their vocabulary.
  {
    id: "meal-calendar",
    category: "planning",
    intent: "A calendar holding three supplied meals on their dates and times.",
    turns: [{
      say: "Put my meal plan on a calendar: 2026-11-02 19:00 Pasta; 2026-11-03 08:00 Oatmeal; 2026-11-04 19:30 Curry.",
      expect: [count("calendar"), prop("calendar", ["events", "length"], 3), prop("calendar", ["events", "0", "date"], "2026-11-02"), prop("calendar", ["events", "0", "start"], "19:00"), text("Pasta"), text("Oatmeal"), text("Curry")],
    }],
  },
  {
    id: "job-board",
    category: "planning",
    intent: "A board with stages Applied, Interview, Offer and three companies in their stages.",
    turns: [{
      say: "Make a kanban board for my job hunt with columns Applied, Interview, Offer. Acme is in Interview, Globex and Initech are in Applied.",
      expect: [count("board"), prop("board", ["columns", "length"], 3), prop("board", ["cards", "length"], 3), text("Acme"), text("Globex"), text("Initech"), text("Offer")],
    }],
  },
  {
    id: "budget-progress",
    category: "dashboard",
    intent: "Progress bars for two supplied budgets with their spent and limit amounts.",
    turns: [{
      say: "Show progress bars for my budgets: Food $420 of $600, Fun $90 of $150.",
      expect: [count("progress", 2), text("Food"), text("Fun"), text("420"), text("600"), text("150")],
    }],
  },
  {
    id: "survey-inputs",
    category: "form",
    intent: "A form with a time picker, a 0-10 slider and a star rating, all bound and submittable.",
    turns: [{
      say: "Make a short feedback form with a time picker for the visit time, a slider from 0 to 10 for wait time, and a star rating for service.",
      expect: [count("form"), anyOf(prop("input", ["kind"], "time"), count("date")), prop("input", ["kind"], "range"), prop("input", ["kind"], "rating"), actionable, bound],
    }],
  },
  {
    id: "stacked-spend",
    category: "dashboard",
    intent: "A stacked bar chart of two supplied categories over three months.",
    turns: [{
      say: "Stacked bar chart of my spending: Rent 30, 30, 32 and Food 12, 14, 11 for Jan, Feb, Mar.",
      expect: [count("chart"), prop("chart", ["kind"], "stacked"), prop("chart", ["series", "length"], 2), text("Rent"), text("Food"), text("Mar")],
    }],
  },
  {
    id: "faq-accordion",
    category: "information",
    intent: "An accordion FAQ with the two supplied questions and answers.",
    turns: [{
      say: "Make an FAQ accordion: Can I get a refund? Yes, within 30 days. Do you ship abroad? Yes, to 40 countries.",
      expect: [count("accordion"), text("refund"), text("30 days"), text("abroad"), text("40 countries")],
    }],
  },
  {
    id: "phone-compare",
    category: "comparison",
    intent: "A side-by-side comparison of two supplied phones with pros and cons and the pick highlighted.",
    turns: [{
      say: "Compare these two phones with pros and cons and highlight the best pick: Pixel 9, $699, great camera, runs warm; iPhone 16, $799, long updates, pricey. Pixel 9 is the best pick.",
      expect: [count("compare"), prop("compare", ["options", "length"], 2), prop("compare", ["options", "0", "best"], true), text("Pixel 9"), text("iPhone 16"), text("camera")],
    }],
  },
  {
    id: "egg-timer",
    category: "interaction",
    intent: "A timer labelled for eggs set to six minutes thirty seconds.",
    turns: [{
      say: "Give me a timer for soft-boiled eggs, 6 minutes 30 seconds.",
      expect: [count("timer"), prop("timer", ["duration"], 390), text("egg")],
    }],
  },
  {
    id: "file-tree",
    category: "information",
    intent: "A tree of the supplied files nested under their folders.",
    turns: [{
      say: "Show this project as a file tree: src/app/main.ts, src/app/util.ts, src/lib/db.ts, README.md.",
      expect: [count("tree"), text("main.ts"), text("util.ts"), text("db.ts"), text("README.md")],
    }],
  },
  {
    id: "launch-gantt",
    category: "planning",
    intent: "A Gantt roadmap of three supplied phases with their start and end dates.",
    turns: [{
      say: "Make a Gantt chart: Design 2026-11-01 to 2026-11-14; Build 2026-11-10 to 2026-12-10; Launch 2026-12-15 to 2026-12-16.",
      expect: [count("gantt"), prop("gantt", ["tasks", "length"], 3), prop("gantt", ["tasks", "0", "start"], "2026-11-01"), text("Design"), text("Build"), text("Launch")],
    }],
  },
  {
    id: "delivery-steps",
    category: "planning",
    intent: "A delivery stepper: Payment done, Packing current, Shipping todo, in that order.",
    turns: [{
      say: "Show my delivery progress with the steps component: Payment is done, Packing is current, Shipping is todo. Keep that order.",
      expect: [count("steps"), prop("steps", ["items", "length"], 3), prop("steps", ["items", "0", "title"], "Payment"), prop("steps", ["items", "0", "status"], "done"), prop("steps", ["items", "1", "title"], "Packing"), prop("steps", ["items", "1", "status"], "current"), prop("steps", ["items", "2", "title"], "Shipping"), prop("steps", ["items", "2", "status"], "todo")],
    }],
  },
  {
    id: "javascript-snippet",
    category: "information",
    intent: "A copyable JavaScript code block preserving the supplied multiline snippet.",
    turns: [{
      say: 'Show this exact JavaScript in a copyable code component titled greet.js, preserving the newline:\nconst name = "Ada";\nconsole.log(`Hello, ${name}!`);',
      expect: [count("code"), prop("code", ["title"], "greet.js"), prop("code", ["language"], "javascript"), anyOf(prop("code", ["code"], 'const name = "Ada";\nconsole.log(`Hello, ${name}!`);'), prop("code", ["code"], 'const name = "Ada";\nconsole.log(`Hello, ${name}!`);\n')), text("Hello")],
    }],
  },
  {
    id: "london-places",
    category: "planning",
    intent: "A map with both supplied London places and their addresses, without inventing coordinates.",
    turns: [{
      say: "Use the map component to show these two places in this order: British Museum, Great Russell Street, London; Tate Modern, Bankside, London. Use the supplied addresses; coordinates are not needed.",
      expect: [count("map"), prop("map", ["places", "length"], 2), prop("map", ["places", "0", "name"], "British Museum"), prop("map", ["places", "0", "address"], "Great Russell Street, London"), prop("map", ["places", "1", "name"], "Tate Modern"), prop("map", ["places", "1", "address"], "Bankside, London"), text("openstreetmap")],
    }],
  },
  {
    id: "photo-gallery",
    category: "information",
    intent: "A gallery preserving two supplied image URLs and captions in order; no fetching is required.",
    turns: [{
      say: "Make a gallery component with these two supplied images, in order. URL https://example.com/coast.jpg, caption Coast; URL https://example.com/forest.jpg, caption Forest. Just display the supplied URLs; do not search for images.",
      expect: [count("gallery"), prop("gallery", ["images", "length"], 2), prop("gallery", ["images", "0", "src"], "https://example.com/coast.jpg"), prop("gallery", ["images", "0", "alt"], "Coast"), prop("gallery", ["images", "1", "src"], "https://example.com/forest.jpg"), prop("gallery", ["images", "1", "alt"], "Forest"), text("Coast"), text("Forest")],
    }],
  },
  {
    id: "invoice-totals",
    category: "dashboard",
    intent: "An invoice table with engine-computed totals: 9 units and $65 revenue; percentage rates are not summed.",
    turns: [{
      say: "Show an invoice table with columns Item, Units, Revenue, Margin. Rows: Pens, 3, $15, 10%; Notebooks, 2, $30, 20%; Folders, 4, $20, 15%. Enable the table's computed totals option; do not write a total row yourself.",
      expect: [count("table"), prop("table", ["totals"], true), prop("table", ["totalsRow"], true), prop("table", ["rows", "length"], 4), text("Pens"), text("Notebooks"), text("Folders"), text("^\\s*Total\\s*\\|\\s*9\\s*\\|", "im"), text("^\\s*Total\\s*\\|[^|\\n]*\\|\\s*\\$?65(?:\\.00)?\\s*\\|", "im"), text("^\\s*Total\\s*\\|[^|\\n]*\\|\\s*\\$", "im"), text("^\\s*Total\\s*\\|[^|\\n]*\\|[^|\\n]*\\|\\s*$", "im")],
    }],
  },
  // --- interaction (multi-turn) ----------------------------------------------------------
  {
    id: "hotel-booking-flow",
    category: "interaction",
    intent: "Pick a Kyoto hotel, then book it: the booking is confirmed on screen.",
    turns: [
      { say: "Compare three hotels in Kyoto for a week in November and let me book one", expect: [options(3), actionable] },
      { act: { target: "form", fill: { name: "Alex Doe", email: "alex@example.com" } }, expect: [changed, text("confirm|booked|booking|reserv|thank")] },
    ],
  },
  {
    id: "beta-signup-flow",
    category: "interaction",
    intent: "Sign up for a beta, then see a confirmation.",
    turns: [
      { say: "Let me sign up for your beta program", expect: [count("form"), count("input"), bound] },
      { act: { target: "form", fill: { name: "Alex Doe", email: "alex@example.com" } }, expect: [changed, text("thank|welcome|confirm|you're in|signed up|registered")] },
    ],
  },
  {
    id: "dashboard-filter",
    category: "interaction",
    intent: "A Q3 sales dashboard, then narrowed to September only.",
    turns: [
      { say: "Show a Q3 sales dashboard with KPIs and a monthly revenue chart", expect: [count("stat", 2), count("chart")] },
      { say: "Now show only September", expect: [changed, count(["stat", "chart"]), text("sep")] },
    ],
  },
  {
    id: "todo-add",
    category: "interaction",
    intent: "A to-do list with an add form; adding a task makes it appear.",
    turns: [
      { say: "Show my to-do list with a way to add a task", expect: [actionable, count(["input", "textarea"]), bound] },
      { act: { target: "form", fill: { "task|title|name|todo|item": "Buy oat milk" } }, expect: [changed, text("oat milk")] },
    ],
  },
  {
    id: "quiz",
    category: "interaction",
    intent: "One multiple-choice solar-system question; answering gives feedback.",
    turns: [
      { say: "Quiz me with one multiple-choice question about the solar system", expect: [anyOf(count("select"), count("button", 2)), actionable] },
      { act: { target: "form" }, expect: [changed, text("correct|incorrect|wrong|right|answer")] },
    ],
  },
  {
    id: "pizza-order",
    category: "interaction",
    intent: "Configure a pizza (size, toppings, crust), then see an order summary with a price.",
    turns: [
      { say: "Help me order a custom pizza: choose size, toppings and crust", expect: [count(["select", "checkbox"], 2), actionable, bound] },
      { act: { target: "form" }, expect: [changed, text("total|price|\\$|order")] },
    ],
  },
  {
    id: "bug-ticket-flow",
    category: "interaction",
    intent: "File a bug through a form, then see the ticket confirmation.",
    turns: [
      { say: "Give me a form to report a bug with severity and steps to reproduce", expect: [count("form"), count("select")] },
      { act: { target: "form", fill: { "title|summary": "Login button does nothing", "steps?": "1. Open app 2. Tap login" } }, expect: [changed, text("ticket|#\\d+|bug-\\d+|submitted|thank|received")] },
    ],
  },
  {
    id: "itinerary-edit",
    category: "interaction",
    intent: "A 3-day Tokyo plan, then day 2 replaced with a museum day.",
    turns: [
      { say: "Plan a 3-day trip to Tokyo", expect: [anyOf(count("tabs"), count(["section", "card"], 3))] },
      { say: "Replace day 2 with a museum day", expect: [changed, text("museum")] },
    ],
  },
];
