// The «Icon» item inside the project menu and its side window.
//
// bb has no slot for project menu items, so the item is drawn into a host element
// that menu-watch.ts keeps inside the Radix menu. To look exactly like the native
// items in any theme, the item copies the class list of a native submenu item
// (Organize / Sort by / Filter) and the window copies the class list of the menu.
// Radix does not know about this item, so arrow keys, hover hand-off and Escape
// are handled here.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { MenuTarget } from "./store";
import { Picker, type PickerActions } from "./picker";
import type { LibraryIcon } from "./server";

const GAP = 4;
const EDGE = 8;
const HOVER_GRACE_MS = 300;
/** Classes used when no native item can be copied (bb changed its markup). */
const FALLBACK_ITEM_CLASS = "flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-[0.3125rem] text-xs outline-none";

/** Look of the window when the menu is a drawer list without its own popover look. */
const FALLBACK_FLYOUT_CLASS = "rounded-md border bg-popover p-1 text-popover-foreground shadow-md";

/** Class list of a native item that opens a submenu (it has a trailing chevron). */
function nativeItemClass(menu: HTMLElement): string {
  const items = Array.from(menu.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]'));
  const submenu =
    items.find((item) => item.getAttribute("aria-haspopup") === "menu") ??
    items.find((item) => item.querySelectorAll(":scope > svg").length === 2);
  return (submenu ?? items[0])?.className || FALLBACK_ITEM_CLASS;
}

/** Menu items keyboard focus can move through, in screen order. */
function navigableItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
    (item) => !item.closest(".pi-flyout, .pc-flyout") && !item.hasAttribute("data-disabled") && item.getClientRects().length > 0,
  );
}


type Side = "right" | "left" | "below";

interface Point {
  x: number;
  y: number;
}

/** True when p lies inside the triangle a-b-c (the path from the item to the window). */
function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const cross = (o: Point, u: Point, v: Point) => (u.x - o.x) * (v.y - o.y) - (u.y - o.y) * (v.x - o.x);
  const d1 = cross(p, a, b);
  const d2 = cross(p, b, c);
  const d3 = cross(p, c, a);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

interface Props {
  target: MenuTarget;
  icons: LibraryIcon[] | null;
  selected: string | null;
  loadError: string;
  actions: PickerActions;
}

export function IconMenu({ target, icons, selected, loadError, actions }: Props) {
  const { menu, host } = target;
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<Side>("right");
  const sideRef = useRef<Side>("right");
  /** Last pointer position over the item: the apex of the path toward the window. */
  const pointerOnItem = useRef<Point | null>(null);
  sideRef.current = side;
  const item = useRef<HTMLDivElement>(null);
  const flyout = useRef<HTMLDivElement>(null);
  // Bumped to move focus into the grid; works whether the window is open already or not.
  const [focusRequest, setFocusRequest] = useState(0);
  const itemClass = useMemo(() => nativeItemClass(menu), [menu]);
  const flyoutClass = useMemo(() => (menu.getAttribute("role") === "menu" ? menu.className : FALLBACK_FLYOUT_CLASS), [menu]);

  // Focus returned by Escape must not reopen the window through onFocus.
  const skipFocusOpen = useRef(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (!refocus) return;
    skipFocusOpen.current = true;
    item.current?.focus({ preventScroll: true });
    skipFocusOpen.current = false;
  }, []);

  const openWithFocus = useCallback(() => {
    setOpen(true);
    setFocusRequest((count) => count + 1);
  }, []);

  // Move focus into the grid after a keyboard open.
  useEffect(() => {
    if (!open || !focusRequest || !flyout.current) return;
    const cells = flyout.current.querySelectorAll<HTMLElement>("[data-cell]");
    const pressed = flyout.current.querySelector<HTMLElement>('[data-cell][aria-pressed="true"]');
    (pressed ?? cells[0])?.focus({ preventScroll: true });
    setFocusRequest(0);
  }, [open, focusRequest, icons]);

  // Native siblings may keep their hover look while this item owns the pointer.
  useEffect(() => {
    if (!open) return;
    menu.classList.add("pi-menu-active");
    return () => menu.classList.remove("pi-menu-active");
  }, [open, menu]);

  // Place the window beside the menu, inside the viewport. The menu wrapper is
  // transformed, so position:fixed is relative to it: measure the real origin first.
  useLayoutEffect(() => {
    const panel = flyout.current;
    const anchor = item.current;
    if (!open || !panel || !anchor) return;
    const place = () => {
      panel.style.left = "0px";
      panel.style.top = "0px";
      panel.style.maxHeight = `${window.innerHeight - EDGE * 2}px`;
      const origin = panel.getBoundingClientRect();
      const menuBox = menu.getBoundingClientRect();
      const anchorBox = anchor.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const fitsRight = menuBox.right + GAP + width <= window.innerWidth - EDGE;
      const fitsLeft = menuBox.left - GAP - width >= EDGE;
      let nextSide: Side = "right";
      let left = menuBox.right + GAP;
      let top = anchorBox.top - 5;
      if (!fitsRight && fitsLeft) {
        nextSide = "left";
        left = menuBox.left - GAP - width;
      } else if (!fitsRight) {
        // No room beside the menu (phone drawer): centre the window under the item.
        nextSide = "below";
        left = (window.innerWidth - width) / 2;
        top = anchorBox.bottom + GAP;
      }
      left = Math.max(EDGE, Math.min(left, window.innerWidth - EDGE - width));
      top = Math.max(EDGE, Math.min(top, window.innerHeight - EDGE - height));
      panel.style.left = `${left - origin.left}px`;
      panel.style.top = `${top - origin.top}px`;
      setSide(nextSide);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [open, menu]);

  // Close rules while open: another menu item wins at once, unless the pointer is
  // crossing it on the way to the window; leaving otherwise closes after a short
  // grace period; a click elsewhere closes now.
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastOnItem: Point | null = pointerOnItem.current;
    const cancel = () => clearTimeout(timer);
    const inside = (node: EventTarget | null) => node instanceof Node && host.contains(node);
    const towardWindow = (event: MouseEvent) => {
      const panel = flyout.current;
      if (!lastOnItem || !panel || sideRef.current === "below") return false;
      const box = panel.getBoundingClientRect();
      const edge = sideRef.current === "right" ? box.left : box.right;
      return inTriangle({ x: event.clientX, y: event.clientY }, lastOnItem, { x: edge, y: box.top }, { x: edge, y: box.bottom });
    };
    // While the pointer crosses siblings toward the window, hide those events from
    // bb and other plugins (React builds hover from them) so nothing grabs focus.
    const shield = (event: MouseEvent) => {
      if (event.type === "pointermove" && item.current?.contains(event.target as Node)) {
        lastOnItem = { x: event.clientX, y: event.clientY };
        return;
      }
      // React derives enter/leave from "out" events, whose destination is relatedTarget.
      const destination = event.type.endsWith("out") ? event.relatedTarget : event.target;
      if (destination && !inside(destination) && towardWindow(event)) event.stopPropagation();
    };
    const over = (event: PointerEvent) => {
      if (inside(event.target)) return cancel();
      const other = (event.target as Element | null)?.closest?.('[role="menuitem"]');
      if (other && menu.contains(other) && !towardWindow(event)) {
        cancel();
        close();
        return;
      }
      cancel();
      timer = setTimeout(() => close(), HOVER_GRACE_MS);
    };
    const down = (event: PointerEvent) => {
      if (!inside(event.target)) close();
    };
    const focus = (event: FocusEvent) => {
      const node = event.target as Node;
      if (!inside(node) && node !== menu && menu.contains(node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    };
    const shielded = ["pointermove", "mousemove", "pointerover", "mouseover", "pointerout", "mouseout"] as const;
    for (const type of shielded) document.addEventListener(type, shield, true);
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("focusin", focus, true);
    // Window capture runs before Radix's document-level Escape handler.
    window.addEventListener("keydown", escape, true);
    return () => {
      cancel();
      for (const type of shielded) document.removeEventListener(type, shield, true);
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("focusin", focus, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [open, host, menu, close]);

  // Arrow keys through items Radix does not track (this one and «Colour»).
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const node = event.target as HTMLElement;
      if (!menu.contains(node) || flyout.current?.contains(node)) return;
      const current = node.closest<HTMLElement>('[role="menuitem"]');
      if (!current) return;
      if (current === item.current && (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        event.stopPropagation();
        openWithFocus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = navigableItems(menu);
      const index = items.indexOf(current);
      const next = items[event.key === "ArrowDown" ? index + 1 : index - 1];
      // Items Radix does not track: ours and «Colour». Leave native-to-native moves to bb.
      const custom = (el: Element | undefined) => el === item.current || !!el?.closest(".pc-menu-surface");
      if (!custom(current) && !custom(next)) return;
      event.preventDefault();
      event.stopPropagation();
      next?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, [menu, openWithFocus]);

  return (
    <>
      <div
        ref={item}
        role="menuitem"
        tabIndex={-1}
        className={`${itemClass} pi-menu-item`}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-state={open ? "open" : "closed"}
        data-orientation="vertical"
        onPointerMove={(event) => {
          if (event.pointerType === "touch") return;
          pointerOnItem.current = { x: event.clientX, y: event.clientY };
          if (document.activeElement !== item.current) item.current?.focus({ preventScroll: true });
          show();
        }}
        onFocus={() => {
          if (!skipFocusOpen.current) show();
        }}
        onClick={openWithFocus}
      >
        <Icon name="GridView" fallback="Star" aria-hidden="true" />
        Icon
        <Icon name="ChevronRight" className="ml-auto" aria-hidden="true" />
      </div>
      {open && (
        <div
          ref={flyout}
          className={`${flyoutClass} pi-flyout`}
          role="dialog"
          aria-label="Иконка проекта"
          data-side={side}
        >
          <Picker
            icons={icons}
            selected={selected}
            loadError={loadError}
            actions={actions}
            onExitLeft={side === "right" ? () => close(true) : undefined}
          />
        </div>
      )}
    </>
  );
}
