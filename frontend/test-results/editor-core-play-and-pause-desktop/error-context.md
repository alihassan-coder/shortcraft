# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor-core.spec.ts >> play and pause
- Location: tests\e2e\editor-core.spec.ts:16:5

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Play' }) resolved to 2 elements:
    1) <button aria-label="Play" class="mx-1 grid size-9 place-items-center rounded-full bg-ink text-white hover:bg-ink-2 focus-visible:ring-2 focus-visible:ring-rec/40 focus-visible:outline-none">…</button> aka getByRole('button', { name: 'Play', exact: true })
    2) <button data-state="closed" data-slot="tooltip-trigger" aria-label="Split at playhead" class="grid size-8 shrink-0 place-items-center rounded-[10px] text-ink-2 transition-colors hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-rec/40 focus-visible:outline-none disabled:opacity-35 disabled:hover:bg-transparent">…</button> aka getByRole('button', { name: 'Split at playhead' })

Call log:
  - waiting for getByRole('button', { name: 'Play' })

```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - button "Open Next.js Dev Tools" [ref=f1e7] [cursor=pointer]
  - alert [ref=f1e11]
  - generic [ref=f1e12]:
    - banner [ref=f1e13]:
      - link "Back to projects" [ref=f1e14] [cursor=pointer]:
        - /url: /
      - menubar [ref=f1e18]:
        - menuitem "File" [ref=f1e19]
        - menuitem "Edit" [ref=f1e20]
        - menuitem "View" [ref=f1e21]
        - menuitem "Help" [ref=f1e22]
      - textbox "Project name" [ref=f1e24]: Morning tip — first three seconds
      - status [ref=f1e25]: Saved
      - generic [ref=f1e27]:
        - button "Undo" [disabled] [ref=f1e28]
        - button "Redo" [disabled] [ref=f1e32]
        - button "Search actions" [ref=f1e37]:
          - text: Search or ask…
          - generic [ref=f1e41]: Ctrl+K
        - button "Export" [ref=f1e42]
    - generic [ref=f1e46]:
      - generic [ref=f1e49]:
        - complementary [ref=f1e50]:
          - navigation "Assets" [ref=f1e51]:
            - button "Media" [ref=f1e52]
            - button "Transcript" [pressed] [ref=f1e58]
            - button "Captions" [ref=f1e63]
            - button "Cuts" [ref=f1e67]
            - button "Zoom" [ref=f1e74]
            - button "Hook" [ref=f1e78]
            - button "Text" [ref=f1e81]
            - button "Audio" [ref=f1e84]
            - button "Elements" [ref=f1e88]
            - button "Filters" [ref=f1e93]
            - button "Transitions" [ref=f1e100]
        - generic [ref=f1e104]:
          - generic [ref=f1e109]:
            - generic [ref=f1e110]:
              - generic [ref=f1e111]:
                - heading "Transcript" [level=2] [ref=f1e112]
                - paragraph [ref=f1e113]: Click a word, press Delete to cut it. Right-click for more.
              - button "Hide assets" [ref=f1e115]
            - paragraph [ref=f1e120]:
              - button "So" [ref=f1e121]
              - button "um," [ref=f1e122]
              - generic [ref=f1e123]: 0.4s
              - button "if" [ref=f1e124]
              - button "your" [ref=f1e125]
              - button "videos" [ref=f1e126]
              - button "are" [ref=f1e127]
              - button "not" [ref=f1e128]
              - button "getting—" [ref=f1e129]
              - button "if" [ref=f1e130]
              - button "your" [ref=f1e131]
              - button "videos" [ref=f1e132]
              - button "aren't" [ref=f1e133]
              - button "getting" [ref=f1e134]
              - button "👀views," [ref=f1e135]
              - button "it's" [ref=f1e136]
              - button "probably" [ref=f1e137]
              - button "the" [ref=f1e138]
              - button "first" [ref=f1e139]
              - button "three" [ref=f1e140]
              - button "⏱️seconds." [ref=f1e141]
              - generic [ref=f1e142]: 0.9s
              - button "Uh," [ref=f1e144]
              - button "people" [ref=f1e145]
              - button "decide" [ref=f1e146]
              - button "to" [ref=f1e147]
              - button "📱scroll" [ref=f1e148]
              - button "super" [ref=f1e149]
              - button "fast." [ref=f1e150]
              - button "So" [ref=f1e152]
              - button "here's" [ref=f1e153]
              - button "the" [ref=f1e154]
              - button "💡trick:" [ref=f1e155]
              - button "start" [ref=f1e156]
              - button "with" [ref=f1e157]
              - button "your" [ref=f1e158]
              - button "strongest" [ref=f1e159]
              - button "line," [ref=f1e160]
              - button "add" [ref=f1e161]
              - button "big" [ref=f1e162]
              - button "captions," [ref=f1e163]
              - button "and" [ref=f1e164]
              - button "like," [ref=f1e165]
              - button "cut" [ref=f1e166]
              - button "every" [ref=f1e167]
              - button "pause." [ref=f1e168]
              - generic [ref=f1e169]: 0.7s
              - button "That's" [ref=f1e171]
              - button "it." [ref=f1e172]
              - button "Try" [ref=f1e174]
              - button "it" [ref=f1e175]
              - button "🔥today." [ref=f1e176]
          - separator "Drag to resize. Double-click to reset." [ref=f1e178]
          - main [ref=f1e181]:
            - generic [ref=f1e183]:
              - generic [ref=f1e186]:
                - generic [ref=f1e190]:
                  - generic: So
                  - generic: Your first 3 seconds are killing your views
                - button "Select clip on screen" [ref=f1e196]
              - generic [ref=f1e197]:
                - generic [ref=f1e198]:
                  - generic [ref=f1e199]: 0:00.0
                  - generic [ref=f1e200]: / 0:12.0
                - button "Back to start" [ref=f1e201]
                - button "Previous frame" [ref=f1e204]
                - button "Play" [ref=f1e207]
                - button "Next frame" [ref=f1e210]
                - button "Split at playhead" [ref=f1e213]
                - generic [ref=f1e220]:
                  - button "Preview zoom" [ref=f1e221]: Fit
                  - group "Preview mode" [ref=f1e224]:
                    - button "Edited" [pressed] [ref=f1e225]
                    - button "Original" [ref=f1e226]
            - generic [ref=f1e229]:
              - textbox "Describe a change" [ref=f1e233]:
                - /placeholder: Describe a change, like “make it calmer”
              - button "Send" [disabled] [ref=f1e234]
          - separator "Drag to resize. Double-click to reset." [ref=f1e237]
          - generic [ref=f1e240]:
            - generic [ref=f1e241]:
              - generic [ref=f1e242]:
                - paragraph [ref=f1e243]: Project
                - paragraph [ref=f1e244]: 1080×1920 · 30 fps
              - button "Hide inspector" [ref=f1e245]
            - generic [ref=f1e249]:
              - generic [ref=f1e250]:
                - button "Canvas" [expanded] [ref=f1e252]
                - generic [ref=f1e255]:
                  - group "Aspect ratio" [ref=f1e256]:
                    - button "Aspect 9:16" [pressed] [ref=f1e257]: 9:16
                    - button "Aspect 1:1" [ref=f1e259]: 1:1
                    - button "Aspect 4:5" [ref=f1e261]: 4:5
                    - button "Aspect 16:9" [ref=f1e263]: 16:9
                    - button "Custom size" [ref=f1e265]: Custom
                  - generic [ref=f1e267]:
                    - generic [ref=f1e268]:
                      - generic [ref=f1e269]: W
                      - textbox "W" [ref=f1e270]: "1080"
                    - generic [ref=f1e271]: ×
                    - generic [ref=f1e272]:
                      - generic [ref=f1e273]: H
                      - textbox "H" [ref=f1e274]: "1920"
                  - paragraph [ref=f1e275]: 1080×1920 is the standard size for 9:16.
                  - generic [ref=f1e276]:
                    - generic [ref=f1e277]: Frame rate
                    - group "Frame rate" [ref=f1e278]:
                      - button "24" [ref=f1e279]
                      - button "25" [ref=f1e280]
                      - button "30" [pressed] [ref=f1e281]
                      - button "60" [ref=f1e282]
              - generic [ref=f1e283]:
                - button "Background" [expanded] [ref=f1e285]
                - generic [ref=f1e288]:
                  - paragraph [ref=f1e289]: Shows where the video doesn't fill the canvas.
                  - group "Background" [ref=f1e290]:
                    - button "Blurred video" [pressed] [ref=f1e291]
                    - button "Color" [ref=f1e292]
              - generic [ref=f1e293]:
                - button "Progress bar" [expanded] [ref=f1e295]
                - generic [ref=f1e299] [cursor=pointer]:
                  - generic [ref=f1e300]: Show progress bar
                  - switch "Show progress bar" [ref=f1e302]
      - separator "Drag to resize. Double-click to reset." [ref=f1e303]
      - generic [ref=f1e306]:
        - button "Hide timeline" [expanded] [ref=f1e307]:
          - text: Timeline
          - generic [ref=f1e308]: \
        - generic [ref=f1e314]:
          - generic [ref=f1e315]:
            - paragraph [ref=f1e316]: Text
            - paragraph [ref=f1e317]: Video
            - paragraph [ref=f1e318]: Captions
            - paragraph [ref=f1e319]: Zoom
            - paragraph [ref=f1e320]: Music
          - generic [ref=f1e321] [cursor=pointer]:
            - generic [ref=f1e322]:
              - generic [ref=f1e323]: 0s
              - generic [ref=f1e326]: 2s
              - generic [ref=f1e329]: 4s
              - generic [ref=f1e332]: 6s
              - generic [ref=f1e335]: 8s
              - generic [ref=f1e338]: 10s
              - generic [ref=f1e341]: 12s
              - generic [ref=f1e344]: 14s
              - generic [ref=f1e347]: 16s
            - generic [ref=f1e349]:
              - generic [ref=f1e351]:
                - generic "silence" [ref=f1e357]
                - generic "filler" [ref=f1e358]
                - generic "silence" [ref=f1e359]
                - generic "You said this line twice. Kept the second, clearer take." [ref=f1e360]
                - generic "silence" [ref=f1e361]
                - generic "filler" [ref=f1e362]
                - generic "filler" [ref=f1e363]
                - generic "silence" [ref=f1e364]
              - generic [ref=f1e406]:
                - button "Zoom at 5.0 seconds" [ref=f1e407]:
                  - generic [ref=f1e408]: 120%
                - button "Zoom at 9.6 seconds" [ref=f1e409]:
                  - generic [ref=f1e410]: 125%
                - button "Zoom at 10.6 seconds" [ref=f1e411]:
                  - generic [ref=f1e412]: 112%
                - button "Zoom at 15.7 seconds" [ref=f1e413]:
                  - generic [ref=f1e414]: 118%
              - generic [ref=f1e415]: Summer Fun · lowers under voice
    - generic [ref=f1e417]:
      - heading "Command palette" [level=2] [ref=f1e418]
      - paragraph [ref=f1e419]: Search editor actions or ask the agents for a change
    - region "Notifications alt+T"
```

# Test source

```ts
  1   | import {
  2   |   expect,
  3   |   focusStage,
  4   |   frameRatio,
  5   |   openEditor,
  6   |   reloadEditor,
  7   |   savedPlan,
  8   |   test,
  9   |   totalSeconds,
  10  | } from "./fixtures";
  11  | 
  12  | test.beforeEach(async ({ page }) => {
  13  |   await openEditor(page);
  14  | });
  15  | 
  16  | test("play and pause", async ({ page }) => {
  17  |   const time = page.locator("[data-time]");
  18  |   await expect(time).toHaveText("0:00.0");
  19  | 
> 20  |   await page.getByRole("button", { name: "Play" }).click();
      |                                                    ^ Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Play' }) resolved to 2 elements:
  21  |   await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  22  |   await expect.poll(() => time.textContent(), { timeout: 10_000 }).not.toBe("0:00.0");
  23  | 
  24  |   await page.getByRole("button", { name: "Pause" }).click();
  25  |   await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  26  |   const paused = await time.textContent();
  27  |   await page.waitForTimeout(400);
  28  |   await expect(time).toHaveText(paused!);
  29  | });
  30  | 
  31  | test("cut a word with Delete, undo with Ctrl+Z", async ({ page }) => {
  32  |   const word = page.locator('[data-word="w21"]');
  33  |   await word.click();
  34  |   await page.keyboard.press("Delete");
  35  |   await expect(word).toHaveClass(/line-through/);
  36  | 
  37  |   await page.keyboard.press("ControlOrMeta+z");
  38  |   await expect(word).not.toHaveClass(/line-through/);
  39  | });
  40  | 
  41  | test("prompt 'make it calmer' applies and survives a reload", async ({ page }) => {
  42  |   const prompt = page.getByRole("textbox", { name: "Describe a change" });
  43  |   await prompt.fill("make it calmer");
  44  |   await prompt.press("Enter");
  45  |   await expect.poll(async () => (await savedPlan(page))?.captions.presetId, { timeout: 10_000 }).toBe("clean");
  46  | 
  47  |   await reloadEditor(page);
  48  |   expect((await savedPlan(page))?.captions.presetId).toBe("clean");
  49  | });
  50  | 
  51  | test("command palette sets the aspect ratio to 1:1", async ({ page }) => {
  52  |   expect(await frameRatio(page)).toBeCloseTo(9 / 16, 1);
  53  | 
  54  |   await page.keyboard.press("ControlOrMeta+k");
  55  |   const dialog = page.getByRole("dialog");
  56  |   await expect(dialog).toBeVisible();
  57  |   await page.keyboard.type("1:1");
  58  |   await expect(dialog.locator("[cmdk-item][data-selected=true]")).toContainText("1:1");
  59  |   await page.keyboard.press("Enter");
  60  | 
  61  |   await expect(dialog).toBeHidden();
  62  |   await expect.poll(() => frameRatio(page)).toBeCloseTo(1, 1);
  63  |   await expect.poll(async () => (await savedPlan(page))?.canvas.aspect).toBe("1:1");
  64  | });
  65  | 
  66  | test("split from the Edit menu creates a second clip", async ({ page }) => {
  67  |   await focusStage(page);
  68  |   for (let i = 0; i < 3; i++) await page.keyboard.press("l");
  69  |   await expect(page.locator("[data-time]")).toHaveText("0:03.0");
  70  | 
  71  |   await page.getByRole("menuitem", { name: "Edit" }).click();
  72  |   await page.locator('[data-action="split"]').click();
  73  |   await expect.poll(async () => (await savedPlan(page))?.clips.length).toBe(2);
  74  | });
  75  | 
  76  | test("clip speed 2× halves the duration, undo restores it", async ({ page }) => {
  77  |   const before = await totalSeconds(page);
  78  |   expect(before).toBeGreaterThan(1);
  79  | 
  80  |   await page.getByRole("button", { name: "Select clip on screen" }).click();
  81  |   await expect(page.locator("[data-inspector]")).toHaveAttribute("data-inspector", "clip");
  82  |   await page.getByRole("group", { name: "Speed" }).getByRole("button", { name: "2×", exact: true }).click();
  83  |   await expect.poll(() => totalSeconds(page)).toBeCloseTo(before / 2, 0);
  84  | 
  85  |   await focusStage(page);
  86  |   await page.keyboard.press("ControlOrMeta+z");
  87  |   await expect.poll(() => totalSeconds(page)).toBe(before);
  88  | });
  89  | 
  90  | test("custom canvas size 1000×1000", async ({ page }) => {
  91  |   await expect(page.locator("[data-inspector]")).toHaveAttribute("data-inspector", "project");
  92  |   for (const label of ["W", "H"]) {
  93  |     const input = page.getByRole("textbox", { name: label, exact: true });
  94  |     await input.fill("1000");
  95  |     await input.press("Enter");
  96  |   }
  97  | 
  98  |   await expect
  99  |     .poll(async () => {
  100 |       const c = (await savedPlan(page))?.canvas;
  101 |       return c && `${c.width}x${c.height} ${c.aspect}`;
  102 |     })
  103 |     .toBe("1000x1000 custom");
  104 |   await expect.poll(() => frameRatio(page)).toBeCloseTo(1, 1);
  105 | });
  106 | 
```