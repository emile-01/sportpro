/*!
 * menya-stability.js
 * -------------------------------------------------------------------------
 * A drop-in companion script for index.html. It does NOT touch or replace
 * index.html — it just runs after it and patches one function in place:
 *
 *   window.render()  →  wrapped so that a full re-render (which does
 *   `document.getElementById("root").innerHTML = ...`) no longer costs you
 *   your cursor position, text selection, or focused element.
 *
 * WHY THIS IS NEEDED
 * -------------------------------------------------------------------------
 * Your app already has good protections for the main feed: renderFeedOnly()
 * diffs cards in place, patchFeedStatsOnly() updates numbers without
 * touching the DOM structure, and full render() restores window scrollY
 * when you're still on the same feed. That part of your app is solid.
 *
 * The remaining gap: many other call sites (background Firebase listener
 * ticks, notification updates, chat updates, etc.) still call the *full*
 * render(), which rebuilds #root's entire innerHTML from a string template.
 * When that happens while someone is mid-keystroke in a textarea/input
 * (the answer composer, chat box, comment box, link field...), the old
 * element is destroyed and a brand-new one is created in its place. The
 * text itself survives (it's driven by state), but the browser has no idea
 * the new node is "the same" input, so focus is dropped, the cursor jumps
 * to the end (or the on-screen keyboard closes on mobile), and any text
 * selection is lost.
 *
 * WHAT THIS FILE ACTUALLY DOES
 * -------------------------------------------------------------------------
 * 1. Before render() runs, if the focused element is a TEXTAREA or INPUT
 *    inside #root, record its structural position (tag/class/index path),
 *    its selectionStart/End, and its own scrollTop.
 * 2. Let render() run exactly as it always has — no behavior is changed,
 *    nothing is skipped or delayed.
 * 3. After render() finishes, walk back down the same structural path in
 *    the new DOM, and if a matching input exists, refocus it and restore
 *    the selection/scroll.
 * 4. If the screen (state.screen) is unchanged before/after, also restore
 *    window scroll position — a no-op on the home feed (already handled)
 *    but a real fix on other screens (chat, detail, profile, etc.).
 *
 * WHAT THIS FILE DOES NOT DO
 * -------------------------------------------------------------------------
 * - It does not reduce how often render() is called, patch renderFeedOnly(),
 *   or change any state/data logic.
 * - It does not solve mobile on-screen-keyboard viewport jumping — that's a
 *   separate, browser-level behavior tied to visualViewport and would need
 *   its own listener if it turns out to still be a problem after this.
 * - It cannot help if render() itself throws before finishing — errors are
 *   surfaced to the console exactly as before.
 *
 * HOW TO LOAD IT
 * -------------------------------------------------------------------------
 * Add ONE line near the end of index.html, right before </body>, after your
 * existing app script has already defined window.render():
 *
 *   <script src="menya-stability.js"></script>
 *
 * That's it — no other edits to index.html are required.
 * -------------------------------------------------------------------------
 */
(function () {
  "use strict";

  function whenReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  whenReady(function () {
    if (typeof window.render !== "function") {
      console.warn(
        "[menya-stability] window.render() was not found on the page — " +
        "nothing was patched. Make sure this script loads AFTER index.html's own <script>."
      );
      return;
    }

    var originalRender = window.render;
    var FOCUSABLE = { TEXTAREA: true, INPUT: true };

    function describeFocus() {
      var el = document.activeElement;
      if (!el || !FOCUSABLE[el.tagName]) return null;
      var root = document.getElementById("root");
      if (!root || !root.contains(el)) return null;

      var path = [];
      var node = el;
      while (node && node !== root) {
        var parent = node.parentElement;
        if (!parent) return null;
        var siblings = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === node.tagName;
        });
        path.unshift({ tag: node.tagName, cls: node.className || "", idx: siblings.indexOf(node) });
        node = parent;
      }

      var selStart, selEnd;
      try { selStart = el.selectionStart; selEnd = el.selectionEnd; } catch (e) { /* some input types don't support selection */ }

      return { path: path, selStart: selStart, selEnd: selEnd, scrollTop: el.scrollTop };
    }

    function relocate(desc) {
      var root = document.getElementById("root");
      if (!root) return null;
      var node = root;
      for (var i = 0; i < desc.path.length; i++) {
        if (!node) return null;
        var step = desc.path[i];
        var candidates = Array.prototype.filter.call(node.children, function (c) {
          return c.tagName === step.tag && (c.className || "") === step.cls;
        });
        node = candidates[step.idx] || null;
      }
      return node;
    }

    window.render = function patchedRender() {
      var focusDesc = describeFocus();
      var screenBefore = window.state && window.state.screen;
      var scrollBefore = { x: window.scrollX, y: window.scrollY };

      var result = originalRender.apply(this, arguments);

      // Restore focus/cursor/selection on the same logical input, if it still exists.
      if (focusDesc) {
        var el = relocate(focusDesc);
        if (el && FOCUSABLE[el.tagName]) {
          el.focus({ preventScroll: true });
          if (typeof focusDesc.selStart === "number") {
            try { el.setSelectionRange(focusDesc.selStart, focusDesc.selEnd); } catch (e) {}
          }
          el.scrollTop = focusDesc.scrollTop;
        }
      }

      // Restore page scroll position on screens where render() doesn't already do it,
      // as long as we didn't actually navigate to a different screen.
      var screenAfter = window.state && window.state.screen;
      if (screenBefore && screenAfter && screenBefore === screenAfter) {
        window.scrollTo(scrollBefore.x, scrollBefore.y);
      }

      return result;
    };

    console.log("[menya-stability] render() patched — focus, cursor position, and scroll now survive background re-renders.");
  });
})();
