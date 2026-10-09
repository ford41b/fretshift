import type { Page } from "@playwright/test";

/**
 * Test-harness fix, not an app workaround.
 *
 * Playwright 1.55 auto-attaches to new targets with `waitForDebuggerOnStart`
 * but filters attachment to iframe/worker targets. Chromium therefore starts
 * every worklet (AudioWorklet, CSS paint worklet) paused for a debugger that
 * never resumes it, so `audioWorklet.addModule()` stays pending forever. The
 * same headless Chromium binary resolves `addModule()` immediately when no
 * Playwright session is attached (see docs/handoffs/IMMERSIVE_RELEASE_HANDOFF.md).
 *
 * A test-owned CDP session resumes worklet targets as they appear. It does not
 * touch the page, the worklet code or the audio path. No-op outside Chromium.
 * Call before the page creates its AudioContext.
 */
export async function resumeChromiumWorklets(page: Page) {
  if (page.context().browser()?.browserType().name() !== "chromium") return;
  const cdp = await page.context().newCDPSession(page);
  cdp.on("Target.attachedToTarget", ({ sessionId, targetInfo }) => {
    if (targetInfo.type !== "worklet") return;
    void cdp
      .send("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({
          id: 1,
          method: "Runtime.runIfWaitingForDebugger",
        }),
      })
      .catch(() => {});
  });
  await cdp.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: false,
  });
}
