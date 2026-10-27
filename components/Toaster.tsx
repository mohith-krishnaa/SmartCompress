import React, {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AlertCircle, AlertTriangle, Check, Info, Loader2 } from "lucide-react";
import { toast, type ToastId, type ToastItem } from "../helpers/toast";
import styles from "./Toaster.module.css";

// THE TOASTER: the app's only notification surface. Show a notice with
// `toast(...)` from helpers/toast; this component renders it. It is already
// mounted once in components/_globalContextProviders, so do not render it
// again.
//
// One compact capsule, top-centre, under the status bar, in the theme's
// inverse colours (foreground as background) so it reads as the app speaking
// over any screen. The one action (Undo / Retry / Open) uses --primary.
//
// SEVERAL AT ONCE, as a stack: the newest in front, up to two older ones
// peeking out underneath, smaller and with their text hidden. Tap the stack,
// or hover it with a mouse, and it fans out into a list where each notice can
// be read, tapped, actioned or swiped away on its own. Nothing expires while
// it is fanned out or hovered. Tap a single notice to dismiss it; swipe up to
// dismiss with the finger.
//
// ON A DYNAMIC ISLAND IPHONE (native iOS build, portrait) it becomes the
// hardware island growing downward, the way iOS's own alerts do: pure black,
// with a hidden "neck" reaching up into the camera pill so the join is the
// hardware's own black. Everywhere else it is the plain capsule.

const EMPTY: ToastItem[] = [];
// A little longer than the longest exit animation (260ms in Dynamic Island
// mode), so the node is never removed on the animation's last frame.
const LEAVE_MS = 300;

/** Cards visible when folded: the front one plus two peeking. */
const MAX_COLLAPSED = 3;
/** Cards visible when fanned out. Older live notices wait their turn. */
const MAX_EXPANDED = 5;
/** How far each folded card peeks out below the one in front of it. */
const PEEK = 8;
/** Each folded card is this much smaller than the one in front. */
const SCALE_STEP = 0.05;
/** Space between fanned-out cards. */
const GAP = 8;
/** Height used for a card before it has been measured (the one-line capsule). */
const DEFAULT_HEIGHT = 34;

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

/** True inside the native iOS build (Capacitor injects its bridge before the bundle runs). */
function isNativeIos(): boolean {
  try {
    const cap = (globalThis as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    return cap?.isNativePlatform?.() === true && cap.getPlatform?.() === "ios";
  } catch {
    return false;
  }
}

/** iOS-style resistance: follows almost 1:1 at first, then ever more reluctantly, never past `dim`. */
function rubberBand(over: number, dim: number, c = 0.55): number {
  if (dim <= 0 || over === 0) return 0;
  const sign = over < 0 ? -1 : 1;
  const a = Math.abs(over);
  return sign * (1 - 1 / ((a * c) / dim + 1)) * dim;
}

/** The real top safe-area inset in CSS px, which env() knows and JS doesn't. */
function measureSafeTop(): number {
  if (typeof document === "undefined" || !document.body) return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-top, 0px)";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
}

/**
 * Where the hardware Dynamic Island's top edge is, or null when this isn't a
 * Dynamic Island iPhone held upright. There is no API for the island itself,
 * but the inset gives it away: Dynamic Island phones report 59pt+ in portrait,
 * notched ones 44–50pt, and landscape reports 0. The pill sits ~48pt above the
 * bottom of that inset.
 */
function useDynamicIslandTop(): number | null {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    if (!isNativeIos()) return;
    const update = () => {
      const inset = measureSafeTop();
      setTop(inset >= 51 ? Math.min(16, Math.max(10, Math.round(inset - 48))) : null);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return top;
}

const toneIcon = (item: ToastItem): React.ReactNode => {
  if (item.icon) return item.icon;
  switch (item.tone) {
    case "success":
      return <Check size={12} strokeWidth={3} />;
    case "error":
      return <AlertCircle size={13} strokeWidth={2.5} />;
    case "warning":
      return <AlertTriangle size={12} strokeWidth={2.5} />;
    case "info":
      return <Info size={13} strokeWidth={2.5} />;
    case "loading":
      return <Loader2 size={13} className={styles.spin} />;
    default:
      return null;
  }
};

type Layout = { y: number; scale: number; opacity: number; z: number };

export interface ToasterViewProps {
  /** Live notices, oldest first (the toast store's order). */
  items: ToastItem[];
  /** Notices just dismissed, kept mounted while they animate out. */
  leavingItems?: ToastItem[];
  /** Dynamic Island shape (native iOS, portrait). */
  dynamic?: boolean;
  /** Top edge of the hardware pill in CSS px (Dynamic Island mode only). */
  islandTop?: number;
  /** Lay out where it is rendered instead of pinned to the top of the screen. */
  inline?: boolean;
  /** Start fanned out (a stack is otherwise folded until tapped or hovered). */
  defaultExpanded?: boolean;
}

/**
 * The Toaster's presentation: the given notices as a stack, in the plain
 * capsule or Dynamic Island shape. `Toaster` feeds it from the toast store;
 * it is exported so notices can be shown in a given state on their own.
 *
 * Each card sits in a "slot" that carries its place in the stack (a CSS
 * transition moves it when the stack changes). The card inside the slot
 * carries only the swipe gesture, so the two transforms never fight.
 */
export const ToasterView = ({
  items,
  leavingItems = EMPTY,
  dynamic = false,
  islandTop = 11,
  inline = false,
  defaultExpanded = false,
}: ToasterViewProps) => {
  const regionRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [hovered, setHovered] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});

  const shown = items.slice(-MAX_EXPANDED).reverse(); // newest first
  const stacked = shown.length > 1;
  const open = stacked && (expanded || hovered);
  const holding = hovered || open;
  const holdingRef = useRef(holding);
  holdingRef.current = holding;

  const heightOf = (id: ToastId) => heights[String(id)] ?? DEFAULT_HEIGHT;
  const frontHeight = shown.length ? heightOf(shown[0].id) : 0;

  // Where every visible card goes. Folded, each older card hides behind the
  // front one, scaled down, with just its bottom edge showing. Fanned out,
  // they simply list downward.
  const layouts = new Map<string, Layout>();
  let listed = 0;
  shown.forEach((it, i) => {
    const h = heightOf(it.id);
    const z = MAX_EXPANDED - i;
    if (open) {
      layouts.set(String(it.id), { y: listed, scale: 1, opacity: 1, z });
      listed += h + GAP;
    } else {
      const k = Math.min(i, MAX_COLLAPSED - 1);
      const scale = 1 - SCALE_STEP * k;
      layouts.set(String(it.id), {
        y: i === 0 ? 0 : frontHeight + PEEK * k - h * scale,
        scale,
        opacity: i < MAX_COLLAPSED ? 1 : 0,
        z,
      });
    }
  });
  const stackHeight = open
    ? Math.max(0, listed - GAP)
    : frontHeight + PEEK * Math.max(0, Math.min(shown.length, MAX_COLLAPSED) - 1);

  // A dismissed card animates out from wherever it last stood.
  const lastLayout = useRef(new Map<string, Layout>());
  layouts.forEach((l, id) => lastLayout.current.set(id, l));
  useEffect(() => {
    const keep = new Set([...items, ...leavingItems].map((i) => String(i.id)));
    lastLayout.current.forEach((_, id) => {
      if (!keep.has(id)) lastLayout.current.delete(id);
    });
  });

  // Measure every card (offsetHeight ignores the stack's scale). Only commits
  // when something actually changed, so it settles after one pass.
  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    const next: Record<string, number> = {};
    let changed = false;
    region.querySelectorAll<HTMLElement>("[data-toast-slot]").forEach((slot) => {
      const id = slot.dataset.toastSlot!;
      const card = slot.firstElementChild as HTMLElement | null;
      if (!card) return;
      next[id] = card.offsetHeight;
      if (heights[id] !== next[id]) changed = true;
    });
    if (changed) setHeights((prev) => ({ ...prev, ...next }));
  });

  // Nothing expires while the reader is looking at the stack. Resume only on
  // the way out of holding, so a timer a swipe has paused isn't restarted.
  const wasHolding = useRef(false);
  useEffect(() => {
    if (holding) toast._store.pauseAll();
    else if (wasHolding.current) toast._store.resumeAll();
    wasHolding.current = holding;
  }, [holding, items.length]);

  useEffect(() => {
    if (!stacked) setExpanded(false);
  }, [stacked]);

  // Fanned out by a tap: a tap anywhere else folds it back up.
  useEffect(() => {
    if (!expanded) return;
    const onDown = (e: PointerEvent) => {
      if (!regionRef.current?.contains(e.target as Node)) setExpanded(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [expanded]);

  const entries = [
    ...shown.map((it, i) => ({ it, i, leaving: false, layout: layouts.get(String(it.id))! })),
    ...leavingItems
      .filter((it) => lastLayout.current.has(String(it.id)))
      .map((it) => ({ it, i: -1, leaving: true, layout: lastLayout.current.get(String(it.id))! })),
  ];

  return (
    <div
      ref={regionRef}
      className={[
        styles.region,
        dynamic ? styles.dynamic : "",
        inline ? styles.inline : "",
        open ? styles.open : "",
      ].join(" ")}
      style={
        {
          ...(dynamic ? { "--toast-island-top": `${islandTop}px` } : {}),
          // Inline, the region is sized to the stack; in Dynamic Island mode it
          // also keeps the room above the card where the neck reaches the pill.
          ...(inline ? { height: stackHeight + (dynamic ? islandTop + 34 : 0) } : {}),
        } as React.CSSProperties
      }
      aria-live="polite"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setHovered(false);
      }}
    >
      {entries.map(({ it, i, leaving, layout }) => (
        <div
          key={`${it.id}:${it.version}`}
          data-toast-slot={String(it.id)}
          className={styles.slot}
          style={{
            transform: `translateY(${layout.y}px) scale(${layout.scale})`,
            opacity: layout.opacity,
            zIndex: layout.z,
          }}
        >
          <ToastCard
            item={it}
            leaving={leaving}
            dynamic={dynamic}
            front={i === 0}
            behind={!leaving && !open && i > 0}
            interactive={!leaving && (open || i === 0) && layout.opacity > 0}
            title={i === 0 && stacked && !open ? "Show all" : "Dismiss"}
            onTap={() => {
              if (stacked && !open) setExpanded(true);
              else toast.dismiss(it.id);
            }}
            held={() => holdingRef.current}
          />
        </div>
      ))}
    </div>
  );
};

/**
 * Renders every notice raised with `toast(...)`. Already mounted in
 * components/_globalContextProviders: do not render it again.
 */
export const Toaster = ({ inline = false }: { inline?: boolean }) => {
  const items = useSyncExternalStore(toast._store.subscribe, toast._store.getSnapshot, () => EMPTY);

  // Keep each dismissed notice mounted for its exit animation. Decided DURING
  // render: storing the leaving notice in state from an effect commits one
  // frame without it before the exit starts, a visible blink.
  const prevItems = useRef<ToastItem[]>(EMPTY);
  const leaving = useRef(new Map<string, { item: ToastItem; since: number }>());
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  const liveIds = new Set(items.map((i) => String(i.id)));
  const now = Date.now();
  for (const p of prevItems.current) {
    const id = String(p.id);
    if (!liveIds.has(id) && !leaving.current.has(id)) leaving.current.set(id, { item: p, since: now });
  }
  leaving.current.forEach((v, id) => {
    if (liveIds.has(id) || now - v.since >= LEAVE_MS) leaving.current.delete(id);
  });
  prevItems.current = items;
  const leavingItems = [...leaving.current.values()].map((v) => v.item);
  useEffect(() => {
    if (!leavingItems.length) return;
    const t = setTimeout(bump, LEAVE_MS);
    return () => clearTimeout(t);
  }, [leavingItems.length, tick]);

  const islandTop = useDynamicIslandTop();

  return (
    <ToasterView
      items={items}
      leavingItems={leavingItems}
      dynamic={islandTop !== null}
      islandTop={islandTop ?? undefined}
      inline={inline}
    />
  );
};

/** Finger travel (px, upward) that takes a card all the way to its dismissed shape. */
const DRAG_DIST = 64;
/** Movement before a press becomes a drag, so taps on the card and its action still work. */
const DRAG_SLOP = 6;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * One notice. SWIPE UP TO DISMISS, DRIVEN BY THE FINGER: the card's position
 * is a single number, `y` (how far the finger has travelled, negative is up),
 * and its shape is a pure function of it. Release hands `y` to a spring seeded
 * with the finger's velocity: past half way or flicked up, it finishes the
 * dismiss; otherwise it springs home. Transforms are written straight to the
 * element on every frame; React only learns when the drag starts and ends.
 */
const ToastCard = ({
  item,
  leaving,
  dynamic,
  front,
  behind,
  interactive,
  title,
  onTap,
  held,
}: {
  item: ToastItem;
  leaving: boolean;
  dynamic: boolean;
  /** Newest card: in Dynamic Island mode, the one joined to the pill. */
  front: boolean;
  /** Folded behind the front card: just an edge, text hidden. */
  behind: boolean;
  /** Can be tapped and swiped (the front card, or any card when fanned out). */
  interactive: boolean;
  title: string;
  onTap: () => void;
  /** Whether the stack is holding every timer (fanned out / hovered). */
  held: () => boolean;
}) => {
  const icon = toneIcon(item);
  const toneClass = styles[`tone_${item.tone}`] ?? "";
  const ref = useRef<HTMLDivElement>(null);
  /** Once touched, the entrance animation is retired so it can't replay or fight the finger. */
  const [handled, setHandled] = useState(false);
  /** Swiped away: the exit animation must not replay over the spot the finger left it. */
  const [swiped, setSwiped] = useState(false);
  const dynamicRef = useRef(dynamic);
  dynamicRef.current = dynamic;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const heldRef = useRef(held);
  heldRef.current = held;
  const suppressClick = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let y = 0;
    let dismissTarget = -DRAG_DIST;
    let frame: number | null = null;
    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let samples: Array<{ t: number; y: number }> = [];

    /** The whole look of the card as a function of finger travel. */
    const apply = (v: number) => {
      if (dynamicRef.current) {
        if (v <= 0) {
          // Up: shrink back toward the pill, exactly the exit's end state at p = 1.
          const p = clamp01(-v / DRAG_DIST);
          el.style.transform = `translateY(${-34 * p}px) scale(${lerp(1, 0.33, p)}, ${lerp(1, 0.4, p)})`;
          el.style.setProperty("--toast-content-opacity", String(clamp01(1 - p * 2.2)));
        } else {
          // Down: the island stretches out of the pill, ever more reluctantly.
          const k = rubberBand(v, 80) / 80;
          el.style.transform = `translateY(${k * 22}px) scale(${1 + k * 0.06}, ${1 + k * 0.14})`;
          el.style.setProperty("--toast-content-opacity", "1");
        }
        el.style.opacity = "";
      } else {
        if (v <= 0) {
          // Up: follow the finger 1:1, shrinking and fading as it goes.
          const p = clamp01(-v / DRAG_DIST);
          el.style.transform = `translateY(${v}px) scale(${1 - 0.12 * p})`;
          el.style.opacity = String(1 - 0.85 * p);
        } else {
          const r = rubberBand(v, 80) * 0.5;
          el.style.transform = `translateY(${r}px) scale(${1 + (r / 40) * 0.04})`;
          el.style.opacity = "";
        }
        el.style.setProperty("--toast-content-opacity", "1");
      }
    };

    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };

    /** Damped spring from the current y to `target`, starting at `v0` px/ms. */
    const springTo = (target: number, v0: number, zeta: number, onDone: () => void) => {
      stop();
      const k = 420;
      const c = 2 * Math.sqrt(k) * zeta;
      let vel = v0 * 1000;
      let last = performance.now();
      const step = (now: number) => {
        const dt = Math.min(0.032, (now - last) / 1000);
        last = now;
        for (let i = 0; i < 4; i++) {
          const a = -k * (y - target) - c * vel;
          vel += a * (dt / 4);
          y += vel * (dt / 4);
        }
        const arrived = Math.abs(y - target) < 0.5 && Math.abs(vel) < 15;
        // Going away, there is nothing to settle: done the moment it gets there.
        const passed = target < 0 && y <= target + 0.5;
        if (arrived || passed) {
          y = target;
          apply(y);
          frame = null;
          onDone();
          return;
        }
        apply(y);
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    const velocity = () => {
      if (samples.length < 2) return 0;
      const a = samples[0];
      const b = samples[samples.length - 1];
      const dt = b.t - a.t;
      if (dt < 8 || performance.now() - b.t > 60) return 0;
      return (b.y - a.y) / dt;
    };

    const onDown = (e: PointerEvent) => {
      if (pointerId !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (!interactiveRef.current || el.classList.contains(styles.leaving)) return;
      pointerId = e.pointerId;
      stop();
      // Catching it mid-spring continues from where it is, with no slop.
      dragging = y !== 0;
      startX = e.clientX;
      startY = e.clientY - y;
      samples = [{ t: performance.now(), y: e.clientY }];
      if (dragging) el.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dy = e.clientY - startY;
      if (!dragging) {
        const dx = e.clientX - startX;
        if (Math.abs(dy) < DRAG_SLOP || Math.abs(dy) < Math.abs(dx)) return;
        dragging = true;
        // Measured before any transform: how far up "fully off screen" is.
        if (!dynamicRef.current) dismissTarget = -(el.getBoundingClientRect().bottom + 24);
        else dismissTarget = -DRAG_DIST;
        setHandled(true);
        toast._store.pause(item.id);
        try {
          // Captured only now, so a plain tap on the action button still clicks it.
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      suppressClick.current = true;
      y = dy;
      const now = performance.now();
      samples.push({ t: now, y: e.clientY });
      while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
      apply(y);
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!dragging) return;
      dragging = false;
      const vy = e.type === "pointercancel" ? 0 : velocity();
      const p = clamp01(-y / DRAG_DIST);
      if (p > 0.5 || (vy < -0.35 && y < 0)) {
        setSwiped(true);
        springTo(dismissTarget, Math.min(vy, 0), 1, () => toast.dismiss(item.id));
      } else {
        springTo(0, vy, 0.72, () => {
          el.style.transform = "";
          el.style.opacity = "";
          el.style.removeProperty("--toast-content-opacity");
          if (!heldRef.current()) toast._store.resume(item.id);
        });
      }
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      stop();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [item.id]);

  return (
    <div
      ref={ref}
      role={item.tone === "error" ? "alert" : "status"}
      className={[
        styles.toast,
        toneClass,
        item.description ? styles.twoLine : "",
        item.action ? "" : styles.noAction,
        icon ? "" : styles.noIcon,
        leaving ? styles.leaving : "",
        handled ? styles.handled : "",
        swiped ? styles.swiped : "",
        front ? styles.front : "",
        behind ? styles.behind : "",
      ].join(" ")}
      title={title}
      aria-hidden={behind || undefined}
      // A drag ends in a click on whatever it started over; that click is not a tap.
      onClickCapture={(e) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
      onPointerDown={() => {
        suppressClick.current = false;
      }}
      onClick={() => {
        if (interactiveRef.current) onTap();
      }}
    >
      <span className={`${styles.fillet} ${styles.filletLeft}`} aria-hidden />
      <span className={`${styles.fillet} ${styles.filletRight}`} aria-hidden />
      {icon && <span className={styles.icon}>{icon}</span>}
      <span className={styles.text}>
        <span className={styles.title}>{item.title}</span>
        {item.description && <span className={styles.description}>{item.description}</span>}
      </span>
      {item.action && (
        <>
          <span className={styles.divider} />
          <button
            type="button"
            className={styles.action}
            onClick={(e) => {
              e.stopPropagation();
              item.action?.onClick();
              toast.dismiss(item.id);
            }}
          >
            {item.action.label}
          </button>
        </>
      )}
    </div>
  );
};
