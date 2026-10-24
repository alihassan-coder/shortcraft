# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor-layout.spec.ts >> desktop >> [ ]  collapse and expand the panels
- Location: tests\e2e\editor-layout.spec.ts:26:7

# Error details

```
Error: console errors

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 38

- Array []
+ Array [
+   "console: %o
+
+ %s TypeError: Cannot read properties of undefined (reading 'texts')
+     at ShortVideo (http://localhost:3001/_next/static/chunks/remotion_short-video_tsx_1mvtu-mn4ifw_._.js:99:40)
+     at Object.react_stack_bottom_frame (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:15013:24)
+     at renderWithHooks (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:4451:24)
+     at updateFunctionComponent (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:5923:21)
+     at beginWork (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:6549:24)
+     at runWithFiberInDEV (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:777:74)
+     at performUnitOfWork (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:9440:97)
+     at workLoopSync (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:9334:40)
+     at renderRootSync (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:9318:13)
+     at performWorkOnRoot (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:8984:47)
+     at performSyncWorkOnRoot (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:10148:9)
+     at flushSyncWorkAcrossRoots_impl (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:10064:316)
+     at flushPassiveEffects (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:9893:13)
+     at http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:9609:13
+     at MessagePort.performWorkUntilDeadline (http://localhost:3001/_next/static/chunks/node_modules_next_dist_compiled_1amofcmz--cdp._.js:1864:64) The above error occurred in the <ShortVideo> component. It was handled by the <ErrorBoundary> error boundary.",
+   "console: %o
+
+ %s TypeError: Cannot read properties of undefined (reading 'texts')
+     at ShortVideo (http://localhost:3001/_next/static/chunks/remotion_short-video_tsx_1mvtu-mn4ifw_._.js:99:40)
+     at Object.react_stack_bottom_frame (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:15013:24)
+     at renderWithHooks (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:4451:24)
+     at updateFunctionComponent (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:5923:21)
+     at beginWork (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:6549:24)
+     at runWithFiberInDEV (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:777:74)
+     at performUnitOfWork (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:9440:97)
+     at workLoopSync (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:9334:40)
+     at renderRootSync (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:9318:13)
+     at performWorkOnRoot (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:8984:47)
+     at performSyncWorkOnRoot (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:10148:9)
+     at flushSyncWorkAcrossRoots_impl (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:10064:316)
+     at flushPassiveEffects (http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:9893:13)
+     at http://localhost:3001/_next/static/chunks/1daa_next_dist_compiled_react-dom_cjs_react-dom-client_development_0mp0cp_t-ezj9.js:9609:13
+     at MessagePort.performWorkUntilDeadline (http://localhost:3001/_next/static/chunks/node_modules_next_dist_compiled_1amofcmz--cdp._.js:1864:64) The above error occurred in the <ShortVideo> component. It was handled by the <ErrorBoundary> error boundary.",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - generic [ref=f1e6] [cursor=pointer]:
    - button "Open Next.js Dev Tools" [ref=f1e7]
    - generic [ref=f1e11]:
      - button "Open issues overlay" [ref=f1e12]:
        - generic [ref=f1e13]:
          - generic [aria-hidden] [ref=f1e14]: "0"
          - generic [ref=f1e15]: "1"
        - generic [ref=f1e16]: Issue
      - button "Collapse issues badge" [ref=f1e17]
  - alert [ref=f1e20]
  - generic [ref=f1e21]:
    - banner [ref=f1e22]:
      - link "Back to projects" [ref=f1e23] [cursor=pointer]:
        - /url: /
      - menubar [ref=f1e27]:
        - menuitem "File" [ref=f1e28]
        - menuitem "Edit" [ref=f1e29]
        - menuitem "View" [ref=f1e30]
        - menuitem "Help" [ref=f1e31]
      - textbox "Project name" [ref=f1e33]: Morning tip — first three seconds
      - status [ref=f1e34]: Saved
      - generic [ref=f1e36]:
        - button "Undo" [disabled] [ref=f1e37]
        - button "Redo" [disabled] [ref=f1e41]
        - button "Search actions" [ref=f1e46]
        - button "Export" [ref=f1e50]
    - generic [ref=f1e54]:
      - main [ref=f1e57]:
        - generic [ref=f1e59]:
          - generic [ref=f1e62]:
            - generic [ref=f1e63]: ⚠️
            - button "Select clip on screen" [ref=f1e67]
          - generic [ref=f1e68]:
            - generic [ref=f1e69]:
              - generic [ref=f1e70]: 0:00.0
              - generic [ref=f1e71]: / 0:12.0
            - button "Back to start" [ref=f1e72]
            - button "Previous frame" [ref=f1e75]
            - button "Play" [ref=f1e78]
            - button "Next frame" [ref=f1e81]
            - button "Split at playhead" [ref=f1e84]
            - generic [ref=f1e91]:
              - button "Preview zoom" [ref=f1e92]: Fit
              - group "Preview mode" [ref=f1e95]:
                - button "Edited" [pressed] [ref=f1e96]
                - button "Original" [ref=f1e97]
        - generic [ref=f1e100]:
          - textbox "Describe a change" [ref=f1e104]:
            - /placeholder: Describe a change, like “make it calmer”
          - button "Send" [disabled] [ref=f1e105]
      - separator "Drag to resize. Double-click to reset." [ref=f1e108]
      - generic [ref=f1e111]:
        - tablist "Editor sections" [ref=f1e112]:
          - tab "Assets" [selected] [ref=f1e113]
          - tab "Inspector" [ref=f1e114]
          - tab "Timeline" [ref=f1e115]
        - generic [ref=f1e117]:
          - navigation "Assets" [ref=f1e119]:
            - button "Media" [ref=f1e120]
            - button "Transcript" [pressed] [ref=f1e126]
            - button "Captions" [ref=f1e131]
            - button "Cuts" [ref=f1e135]
            - button "Zoom" [ref=f1e142]
            - button "Hook" [ref=f1e146]
            - button "Text" [ref=f1e149]
            - button "Audio" [ref=f1e152]
            - button "Elements" [ref=f1e156]
            - button "Filters" [ref=f1e161]
            - button "Transitions" [ref=f1e168]
          - generic [ref=f1e174]:
            - generic [ref=f1e176]:
              - heading "Transcript" [level=2] [ref=f1e177]
              - paragraph [ref=f1e178]: Click a word, press Delete to cut it. Right-click for more.
            - paragraph [ref=f1e180]:
              - button "So" [ref=f1e181]
              - button "um," [ref=f1e182]
              - generic [ref=f1e183]: 0.4s
              - button "if" [ref=f1e184]
              - button "your" [ref=f1e185]
              - button "videos" [ref=f1e186]
              - button "are" [ref=f1e187]
              - button "not" [ref=f1e188]
              - button "getting—" [ref=f1e189]
              - button "if" [ref=f1e190]
              - button "your" [ref=f1e191]
              - button "videos" [ref=f1e192]
              - button "aren't" [ref=f1e193]
              - button "getting" [ref=f1e194]
              - button "👀views," [ref=f1e195]
              - button "it's" [ref=f1e196]
              - button "probably" [ref=f1e197]
              - button "the" [ref=f1e198]
              - button "first" [ref=f1e199]
              - button "three" [ref=f1e200]
              - button "⏱️seconds." [ref=f1e201]
              - generic [ref=f1e202]: 0.9s
              - button "Uh," [ref=f1e204]
              - button "people" [ref=f1e205]
              - button "decide" [ref=f1e206]
              - button "to" [ref=f1e207]
              - button "📱scroll" [ref=f1e208]
              - button "super" [ref=f1e209]
              - button "fast." [ref=f1e210]
              - button "So" [ref=f1e212]
              - button "here's" [ref=f1e213]
              - button "the" [ref=f1e214]
              - button "💡trick:" [ref=f1e215]
              - button "start" [ref=f1e216]
              - button "with" [ref=f1e217]
              - button "your" [ref=f1e218]
              - button "strongest" [ref=f1e219]
              - button "line," [ref=f1e220]
              - button "add" [ref=f1e221]
              - button "big" [ref=f1e222]
              - button "captions," [ref=f1e223]
              - button "and" [ref=f1e224]
              - button "like," [ref=f1e225]
              - button "cut" [ref=f1e226]
              - button "every" [ref=f1e227]
              - button "pause." [ref=f1e228]
              - generic [ref=f1e229]: 0.7s
              - button "That's" [ref=f1e231]
              - button "it." [ref=f1e232]
              - button "Try" [ref=f1e234]
              - button "it" [ref=f1e235]
              - button "🔥today." [ref=f1e236]
    - generic [ref=f1e238]:
      - heading "Command palette" [level=2] [ref=f1e239]
      - paragraph [ref=f1e240]: Search editor actions or ask the agents for a change
    - region "Notifications alt+T"
```

# Test source

```ts
  1  | import { test as base, expect, type Page } from "@playwright/test";
  2  | 
  3  | type ConsoleGuard = {
  4  |   /** Ignore console errors matching this pattern for the rest of the test. */
  5  |   allow: (pattern: RegExp) => void;
  6  |   errors: string[];
  7  | };
  8  | 
  9  | /**
  10 |  * `test` with an automatic console guard: any `console.error` or uncaught page
  11 |  * error fails the test when it finishes.
  12 |  */
  13 | export const test = base.extend<{ consoleGuard: ConsoleGuard }>({
  14 |   consoleGuard: [
  15 |     async ({ page }, use) => {
  16 |       const allowed: RegExp[] = [];
  17 |       const errors: string[] = [];
  18 |       page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  19 |       page.on("console", (m) => {
  20 |         if (m.type() === "error") errors.push(`console: ${m.text()}`);
  21 |       });
  22 |       await use({ allow: (p) => allowed.push(p), errors });
  23 |       const unexpected = errors.filter((e) => !allowed.some((p) => p.test(e)));
> 24 |       expect(unexpected, "console errors").toEqual([]);
     |                                            ^ Error: console errors
  25 |     },
  26 |     { auto: true },
  27 |   ],
  28 | });
  29 | 
  30 | export { expect };
  31 | 
  32 | /* ---------- Editor helpers ---------- */
  33 | 
  34 | export const PLAN_KEY = "shortcraft:plan:demo";
  35 | 
  36 | /** Wait until the client-only editor has mounted. */
  37 | export async function waitForEditor(page: Page) {
  38 |   await expect(page.getByText("Opening editor…")).toHaveCount(0, { timeout: 30_000 });
  39 |   await expect(page.locator("[data-preview-frame]")).toBeVisible();
  40 | }
  41 | 
  42 | /** Open the demo editor with empty storage. */
  43 | export async function openEditor(page: Page) {
  44 |   await page.goto("/editor/demo");
  45 |   await page.evaluate(() => localStorage.clear());
  46 |   await page.reload();
  47 |   await waitForEditor(page);
  48 | }
  49 | 
  50 | export async function reloadEditor(page: Page) {
  51 |   await page.reload();
  52 |   await waitForEditor(page);
  53 | }
  54 | 
  55 | type SavedPlan = {
  56 |   clips: unknown[];
  57 |   canvas: { aspect: string; width: number; height: number };
  58 |   captions: { presetId: string };
  59 | };
  60 | 
  61 | /** The autosaved plan, or null before the first save. */
  62 | export const savedPlan = (page: Page) =>
  63 |   page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), PLAN_KEY) as Promise<SavedPlan | null>;
  64 | 
  65 | /** Width / height of the preview frame. */
  66 | export const frameRatio = (page: Page) =>
  67 |   page.locator("[data-preview-frame]").evaluate((el) => {
  68 |     const b = el.getBoundingClientRect();
  69 |     return b.width / b.height;
  70 |   });
  71 | 
  72 | /** Total output duration in seconds, from the "/ 0:12.0" label next to the playhead time. */
  73 | export async function totalSeconds(page: Page) {
  74 |   const text = (await page.locator("[data-time] + span").textContent()) ?? "";
  75 |   const m = text.match(/(\d+):(\d+(?:\.\d+)?)/);
  76 |   if (!m) throw new Error(`no duration in "${text}"`);
  77 |   return Number(m[1]) * 60 + Number(m[2]);
  78 | }
  79 | 
  80 | /** Move focus off inputs so editor shortcuts reach the window handler. */
  81 | export async function focusStage(page: Page) {
  82 |   await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  83 | }
  84 | 
```