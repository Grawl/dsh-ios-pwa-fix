/**
 * dsh-ios-pwa-fix — Browser half.
 *
 * Keeps the DSH web GUI usable as an iOS/iPadOS Home Screen app.
 *
 * 1. Status bar. The app uses standalone display mode, so iOS may draw the status
 *    bar over the page. If the page spans the screen, reserve a strip at the top
 *    and paint it with the app background. If the platform already insets the
 *    page, reserve nothing.
 *
 * 2. Keyboard. iOS shrinks the visual viewport but not the layout viewport. While
 *    the keyboard covers the layout viewport, pin the shell to the visible band,
 *    so the composer stays above the keyboard.
 *
 * 3. Geometry. The layout height is `documentElement.clientHeight`, not
 *    `window.innerHeight`: on iOS, `innerHeight` moves with the keyboard and
 *    scroll. `visualViewport.offsetTop` can be the document scroll; when it
 *    matches `scrollY`, the visible band starts at the top of the layout
 *    viewport.
 *
 * 4. Text fields. Keep the font size at 16px or more, so WebKit does not apply
 *    its automatic focus zoom.
 *
 * 5. Safe area. The page ships without `viewport-fit=cover`, so the browser
 *    reports the safe-area insets as zero. The patch adds the cover value and
 *    pads the bottom by the Home indicator.
 *
 * The patch changes layout only. It runs inside try/catch and removes every
 * change on dispose. It is inert outside iOS and iPadOS standalone display mode.
 */
/*
 * One IIFE keeps every helper out of the global scope. Generic top-level names
 * can collide with other client bundles. Top-level const declarations would also
 * fail when HMR executes the bundle again.
 */
(() => {
  const STORAGE_KEY = "dsh-ios-pwa-fix";
  const STYLE_ID = "dsh-ios-pwa-fix-style";
  /**
   * Layout sheet. Source of truth: lib/layout.css; `npm run build-css` copies it
   * here and `npm test` fails when the two drift apart.
   */
  const LAYOUT_CSS = String.raw`
/* build-css:start */
/*
 * Layout of the GUI as a Home Screen app on iOS.
 *
 * The client inserts this sheet at the top of <head> and removes it on dispose.
 * A stylesheet linked later in the head wins on equal specificity: a deployment
 * can serve its own overrides from a URL without touching the plugin.
 *
 * The dsh-ios-pwa-fix plugin puts the class dsh-ios-pwa on <html>, adds
 * dsh-ios-keyboard while the software keyboard covers the screen, and writes
 * the custom property --dsh-ios-vvh with the height of the visible band left.
 */

html.dsh-ios-pwa {
  color-scheme: light dark;
  position: fixed;
  inset: 0;

  &,
  body {
    height: 100dvh;
    overflow: hidden;

    &,
    #root,
    [data-conversation-scroll] {
      overscroll-behavior: none;
    }
  }

  /* A body in flow keeps a screen of scrollable page around the visible band,
	 * and iOS uses it when the keyboard opens or a gesture misses the scroller. A
	 * fixed body has nothing to scroll. */
  body {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    margin: 0;
    &::before {
      content: "";
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: env(safe-area-inset-top, 0px);
      background-color: light-dark(#fff, #151416);
      pointer-events: none;
      z-index: 2147483000;
    }
  }

  #root {
    box-sizing: border-box;
    height: 100%;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    overflow: hidden;
  }

  input,
  textarea,
  [contenteditable="true"] {
    font-size: max(16px, 1em);
  }

  &.dsh-ios-locked {
    &,
    body {
      overflow: hidden;
    }
  }

  /* The header bar of the shell paints its own frosted band: on iOS it sits over
	 * the status bar and reads as a blur. The band belongs to the page, not to the
	 * header. */
  header,
  header::before,
  header::after,
  [data-plugin-bar],
  [data-plugin-bar]::before,
  [data-plugin-bar]::after,
  [data-phase] > header,
  [class*="pageBar"],
  [class*="pageBar"]::before,
  [class*="pageBar"]::after {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  [class*="_sidebarCol"] {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  /* The chrome carries the vertical insets, so the shell itself stays exactly the
	 * size of the screen and nothing overflows: the status bar sits over the header
	 * and the home indicator under the composer, not over the shell. */
  header {
    padding-top: env(safe-area-inset-top, 0px);
    height: auto;
  }

  [class*="_sidebarCol"] > div > [class*="_root"] {
    height: unset;
    min-height: 100%;
  }

  [class*="_tabHostBody"] [class*="_tabBody"] {
    height: unset;
  }

  &.dsh-ios-keyboard {
    #root {
      height: var(--dsh-ios-vvh, 100dvh);
      padding-bottom: 0;
    }
    body {
      height: var(--dsh-ios-vvh, 100dvh);
    }
  }

  [class*="_frame"] {
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    &::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: env(safe-area-inset-left, 0px);
      background: var(--dsw-specific-sidebar-fill, transparent);
      pointer-events: none;
    }
  }

  [class*="_sidebarCol"] > div > [class*="_root"] > [class*="_logoRow"] {
    position: sticky;
    top: 0;
    z-index: 1;
    background-color: var(--dsw-specific-sidebar-fill);
  }
}
/* build-css:end */
`;
  const ROOT_CLASS = "dsh-ios-pwa";
  const KEYBOARD_CLASS = "dsh-ios-keyboard";
  const LOCK_CLASS = "dsh-ios-locked";
  /** Settings card slot key: the bundle package name. */
  const PACKAGE_NAME = "dsh-ios-pwa-fix";
  /** Public hook: `window.dispatchEvent(new Event("dsh-ios-pwa-resync"))` forces a pass. */
  const RESYNC_EVENT = "dsh-ios-pwa-resync";
  /** How long after the last viewport event to keep re-checking (ms). */
  const WATCHDOG_MS = 250;
  /** Hold a closed-looking band this long before releasing the pin (ms). */
  const CLOSE_GRACE_MS = 200;
  /** Ignore the band for this long after a rotation (ms). */
  const ROTATION_GRACE_MS = 350;
  /** Reject a band equal to the other orientation's layout height (ms). */
  const ROTATION_RESIDUE_MS = 3000;

  /**
   * Defaults. Override any of them for a device-local change with:
   *   const stored = JSON.parse(localStorage.getItem("dsh-ios-pwa-fix") || "{}")
   *   localStorage.setItem("dsh-ios-pwa-fix", JSON.stringify({ ...stored, watchdog: false }))
   */
  const DEFAULTS = {
    /** Smallest visual-viewport shortfall treated as the keyboard. */
    minOverlap: 60,
    /** When to normalise iOS's reveal-scroll: "onOpen" | "always" | "off". */
    scrollReset: "onOpen",
    /** Keep re-checking the geometry while the keyboard is open. */
    watchdog: true,
    /** Pin the document's own scroll while the keyboard is open. */
    lockScroll: true,
    /** Log the computed geometry on every sync. */
    debug: false,
  };

  /** Merge the defaults with the localStorage override; never throw on bad JSON. */
  function settings(windowRef) {
    let override = {};
    try {
      override = JSON.parse(windowRef.localStorage.getItem(STORAGE_KEY) || "{}") || {};
    } catch {
      override = {};
    }
    const merged = Object.assign({}, DEFAULTS, override);
    if (typeof merged.minOverlap !== "number" || merged.minOverlap < 0) merged.minOverlap = DEFAULTS.minOverlap;
    if (["onOpen", "always", "off"].indexOf(merged.scrollReset) === -1) merged.scrollReset = DEFAULTS.scrollReset;
    merged.watchdog = merged.watchdog !== false;
    merged.lockScroll = merged.lockScroll !== false;
    return merged;
  }

  /* ------------------------------------------------------------------
   * Environment detection
   *
   * These functions read navigator and matchMedia only. They do not touch
   * the DOM. Future patches can use the platform and version to apply
   * version-specific rules.
   * ---------------------------------------------------------------- */

  /** Return "iphone", "ipad", "ipod", or null. */
  function iosPlatform(ua, nav) {
    if (/iPad/.test(ua)) return "ipad";
    if (/iPhone/.test(ua)) return "iphone";
    if (/iPod/.test(ua)) return "ipod";
    // iPadOS desktop mode reports a Macintosh user agent and has touch.
    if (/Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1) return "ipad";
    return null;
  }

  /** Return { major, minor, patch } from the user agent, or null. */
  function iosVersion(ua) {
    const match = /(?:CPU (?:iPhone )?OS|OS) (\d+)[_.](\d+)(?:[_.](\d+))?/.exec(ua);
    if (!match) return null;
    return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] || 0) };
  }

  /** Return "standalone", "fullscreen", or "browser". */
  function displayMode(windowRef) {
    const nav = windowRef.navigator || {};
    if (nav.standalone === true) return "standalone";
    const mm = windowRef.matchMedia;
    if (typeof mm !== "function") return "browser";
    if (mm("(display-mode: fullscreen)").matches) return "fullscreen";
    if (mm("(display-mode: standalone)").matches) return "standalone";
    return "browser";
  }

  /** Describe the current platform and display mode. */
  function detectEnvironment(windowRef) {
    const nav = windowRef.navigator || {};
    const ua = String(nav.userAgent || "");
    const mode = displayMode(windowRef);
    const platform = iosPlatform(ua, nav);
    const touch = Number(nav.maxTouchPoints) > 1;
    return {
      ios: platform !== null,
      platform,
      version: iosVersion(ua),
      standalone: mode !== "browser",
      displayMode: mode,
      desktopMode: /Macintosh/.test(ua) && touch,
      touch,
    };
  }

  /** Apply only on iOS or iPadOS in a standalone display mode. */
  function shouldApply(env) {
    return env.ios && env.standalone;
  }

  /**
   * Extend the page under the notch and the Home indicator.
   *
   * The app ships a viewport without `viewport-fit=cover`, so the layout
   * viewport stops at the safe area and `env(safe-area-inset-*)` resolves to 0.
   * The cover value makes the layout span the whole screen and the env()
   * variables report the real insets. The status bar strip and the bottom
   * padding then measure the real device.
   */
  function setViewportCover(doc) {
    const meta = doc.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const content = meta.getAttribute("content") || "";
    if (content.includes("viewport-fit=cover")) return;
    const next = content.replace(/\s*viewport-fit\s*=\s*[^,;]*/g, "").replace(/\s*,\s*$/, "");
    meta.setAttribute("content", next ? next + ", viewport-fit=cover" : "viewport-fit=cover");
  }

  /** @param ctx - Browser application context. */
  function apply(ctx) {
    try {
      const windowRef = window;
      const doc = windowRef.document;
      const cfg = settings(windowRef);
      const env = detectEnvironment(windowRef);
      if (cfg.debug) {
        try {
          windowRef.__dshIosPwaEnvironment = env;
        } catch {
          // A read-only window object: the console log still works.
        }
        console.log("[dsh-ios-pwa-fix] environment", env);
      }

      if (!shouldApply(env)) return;
      // Re-materialisation (HMR) must not stack a second patch on top of the first.
      if (doc.getElementById(STYLE_ID)) return;

      setViewportCover(doc);

      const root = doc.documentElement;
      const body = doc.body;
      root.classList.add(ROOT_CLASS);
      const layoutStyle = doc.createElement("style");
      layoutStyle.id = STYLE_ID;
      layoutStyle.textContent = LAYOUT_CSS;
      const head = doc.head;
      if (head) head.insertBefore(layoutStyle, head.firstChild);
      const viewport = windowRef.visualViewport;
      const raf =
        typeof windowRef.requestAnimationFrame === "function"
          ? windowRef.requestAnimationFrame.bind(windowRef)
          : (fn) => windowRef.setTimeout(fn, 16);
      const caf =
        typeof windowRef.cancelAnimationFrame === "function"
          ? windowRef.cancelAnimationFrame.bind(windowRef)
          : () => {};

      let frame = 0;
      let settleTimer = 0;
      let running = false;
      let appliedHeight = -1;
      let keyboardOpen = false;
      let closedAt = -1;
      let closeTimer = 0;
      let rotationUntil = 0;
      let rotationFromHeight = 0;
      let rotationResidueUntil = 0;
      let rotationTimer = 0;
      let lastLayoutHeight = 0;
      let lastWidth = Math.round((viewport && viewport.width) || 0);

      const now = () => {
        const perf = windowRef.performance;
        return perf && typeof perf.now === "function" ? perf.now() : Date.now();
      };

      const resetScroll = () => {
        if (windowRef.scrollX !== 0 || windowRef.scrollY !== 0) windowRef.scrollTo(0, 0);
      };

      /**
       * Resolve the visible band inside the layout viewport.
       *
       * The layout height is `documentElement.clientHeight`. On iOS,
       * `innerHeight` follows the keyboard and scroll, so it cannot be used
       * here.
       *
       * `visualViewport.offsetTop` is the band offset in overlay mode. On iOS
       * it can equal the document scroll when the keyboard resizes the layout
       * viewport. In that case the band starts at 0 and only its height
       * shrinks.
       */
      const geometry = () => {
        const offsetTop = Math.round(viewport.offsetTop);
        const height = Math.round(viewport.height);
        const element = doc.documentElement;
        const clientHeight = element ? element.clientHeight : 0;
        const layoutHeight = Math.round(clientHeight > 0 ? clientHeight : windowRef.innerHeight);
        const scrolled = Math.round(windowRef.scrollY);
        let bandTop = Math.abs(offsetTop - scrolled) <= 2 ? 0 : offsetTop;
        if (bandTop < 0) bandTop = 0;
        if (bandTop > layoutHeight) bandTop = layoutHeight;
        const bandBottom = bandTop + height;
        const overlap = layoutHeight - bandBottom;

        if (overlap <= cfg.minOverlap) {
          return { open: false, bandTop, height, layoutHeight, bandBottom, overlap, pinned: 0 };
        }
        return {
          open: true,
          bandTop,
          height,
          layoutHeight,
          bandBottom,
          overlap,
          pinned: bandBottom - bandTop,
        };
      };

      /** Write the geometry to the DOM. Every write is visible to the next read. */
      const paint = (geo) => {
        root.style.setProperty("--dsh-ios-vvh", geo.bandBottom + "px");
        root.classList.add(KEYBOARD_CLASS);
        if (cfg.lockScroll) root.classList.add(LOCK_CLASS);
      };

      /** Put everything back the way the unpatched shell had it. */
      const release = () => {
        root.classList.remove(KEYBOARD_CLASS, LOCK_CLASS);
        root.style.removeProperty("--dsh-ios-vvh");
        body.style.removeProperty("height");
        appliedHeight = -1;
        keyboardOpen = false;
        closedAt = -1;
        if (closeTimer) {
          windowRef.clearTimeout(closeTimer);
          closeTimer = 0;
        }
      };

      /** Align the layout with the visible band: keyboard open, or full height. */
      const sync = (reason) => {
        if (!viewport) return;

        const stamp = now();
        const geo = geometry();
        const width = Math.round(viewport.width) || 0;

        // A rotation changes only the width. The old pin belongs to the old
        // orientation, so drop it and let the layout settle before pinning
        // again.
        if (width > 0 && lastWidth > 0 && width !== lastWidth) {
          lastWidth = width;
          rotationUntil = stamp + ROTATION_GRACE_MS;
          rotationFromHeight = lastLayoutHeight;
          rotationResidueUntil = stamp + ROTATION_RESIDUE_MS;
          if (keyboardOpen) release();
          if (rotationTimer) windowRef.clearTimeout(rotationTimer);
          rotationTimer = windowRef.setTimeout(() => {
            rotationTimer = 0;
            pass("rotation");
          }, ROTATION_GRACE_MS);
        } else if (width > 0) {
          lastWidth = width;
        }
        lastLayoutHeight = geo.layoutHeight;

        if (stamp < rotationUntil) return;

        if (!geo.open) {
          if (keyboardOpen) {
            // iPadOS reports the full height for a few frames during a scroll
            // or a rotation. Keep the pin until the closed state lasts.
            if (closedAt < 0) closedAt = stamp;
            if (stamp - closedAt >= CLOSE_GRACE_MS) {
              release();
            } else if (!closeTimer) {
              closeTimer = windowRef.setTimeout(
                () => {
                  closeTimer = 0;
                  pass("close");
                },
                CLOSE_GRACE_MS - (stamp - closedAt),
              );
            }
          }
          if (cfg.debug) {
            console.log("[dsh-ios-pwa-fix]", {
              reason,
              open: false,
              bandTop: geo.bandTop,
              viewportHeight: geo.height,
              innerHeight: geo.layoutHeight,
              overlap: geo.overlap,
            });
          }
          return;
        }

        // A band that equals the other orientation's layout height is the
        // stale visual viewport, not a keyboard.
        if (stamp < rotationResidueUntil && rotationFromHeight > 0 && Math.abs(geo.height - rotationFromHeight) <= 8) {
          if (cfg.debug) {
            console.log("[dsh-ios-pwa-fix]", {
              reason,
              open: false,
              stale: rotationFromHeight,
              viewportHeight: geo.height,
              innerHeight: geo.layoutHeight,
            });
          }
          return;
        }

        if (closeTimer) {
          windowRef.clearTimeout(closeTimer);
          closeTimer = 0;
        }
        closedAt = -1;
        rotationFromHeight = 0;
        rotationResidueUntil = 0;

        // The first pass of this keyboard-open episode is what
        // `scrollReset: "onOpen"` normalises; after that iOS is left alone.
        const episode = !keyboardOpen;

        // Only touch the DOM when the number actually moved. The watchdog runs
        // every frame while the keyboard is up, and repainting an unchanged
        // height would keep iOS re-laying out for no reason.
        if (episode || geo.bandBottom !== appliedHeight) {
          paint(geo);
          appliedHeight = geo.bandBottom;
        }
        keyboardOpen = true;

        if (cfg.scrollReset === "always" || (cfg.scrollReset === "onOpen" && episode)) {
          resetScroll();
        }

        if (cfg.debug) {
          console.log("[dsh-ios-pwa-fix]", {
            reason,
            open: true,
            bandTop: geo.bandTop,
            viewportHeight: geo.height,
            bandBottom: geo.bandBottom,
            innerHeight: geo.layoutHeight,
            pinned: geo.pinned,
            overlap: geo.overlap,
            appliedHeight,
          });
        }
      };

      /**
       * Run one pass, then keep checking while the keyboard is open.
       *
       * A watchdog pass runs on each animation frame. A settle pass runs 250ms
       * after the last event and repeats while the keyboard stays open. Both are
       * off when `watchdog` is false.
       */
      const pass = (reason) => {
        sync(reason);
        if (!keyboardOpen) return;
        if (!cfg.watchdog) return;

        if (!frame) {
          frame = raf(() => {
            frame = 0;
            pass("watchdog");
          });
        }
        if (!settleTimer) {
          settleTimer = windowRef.setTimeout(() => {
            settleTimer = 0;
            if (keyboardOpen) pass("settle");
          }, WATCHDOG_MS);
        }
      };

      const onEvent = (reason) => {
        if (!running) return;
        // A fresh event restarts the settle window.
        if (settleTimer) {
          windowRef.clearTimeout(settleTimer);
          settleTimer = 0;
        }
        pass(reason);
      };

      const onResize = () => onEvent("resize");
      const onScroll = () => onEvent("scroll");
      const onResync = () => onEvent("resync");

      if (viewport) {
        viewport.addEventListener("resize", onResize);
        viewport.addEventListener("scroll", onScroll);
      }
      windowRef.addEventListener("resize", onResize);
      windowRef.addEventListener("scroll", onScroll);
      windowRef.addEventListener("orientationchange", onResize);
      windowRef.addEventListener(RESYNC_EVENT, onResync);
      running = true;
      pass("init");

      ctx.effect(() => () => {
        running = false;
        if (viewport) {
          viewport.removeEventListener("resize", onResize);
          viewport.removeEventListener("scroll", onScroll);
        }
        windowRef.removeEventListener("resize", onResize);
        windowRef.removeEventListener("scroll", onScroll);
        windowRef.removeEventListener("orientationchange", onResize);
        windowRef.removeEventListener(RESYNC_EVENT, onResync);
        if (frame) caf(frame);
        if (settleTimer) windowRef.clearTimeout(settleTimer);
        if (closeTimer) windowRef.clearTimeout(closeTimer);
        if (rotationTimer) windowRef.clearTimeout(rotationTimer);
        frame = 0;
        settleTimer = 0;
        closeTimer = 0;
        rotationTimer = 0;
        release();
        layoutStyle.remove();
        root.classList.remove(ROOT_CLASS);
      });
    } catch (error) {
      // Layout-only patch: never take the interface down with it.
      console.warn("[dsh-ios-pwa-fix]", error);
    }
  }

  const exports = {
    apply,
    detectEnvironment,
    shouldApply,
    inject: [],
  };
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

  window.__ModuleLoader__.load({
    id: PACKAGE_NAME,
    factory: () => exports,
  });
})();
