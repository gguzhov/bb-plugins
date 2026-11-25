// Contents of the side window: one icon grid («Без иконки», bundled, custom, «+»), upload and delete.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { LibraryIcon } from "./server";
import { fileToIcon, iconNameFromFile, PickError } from "./client-image";
import { pickerCells, PHASE_CAPTION, previewPhases } from "./cells";
import type { CSSProperties } from "react";

export interface PickerActions {
  select(iconId: string | null): Promise<void>;
  add(name: string, data: string): Promise<void>;
  remove(iconId: string): Promise<void>;
}

interface PickerProps {
  icons: LibraryIcon[] | null;
  selected: string | null;
  loadError: string;
  actions: PickerActions;
  /** Arrow left from the first column: give focus back to the menu item. */
  onExitLeft?: () => void;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Moves focus between grid cells by their position on screen. */
function moveInGrid(root: HTMLElement, from: HTMLElement, key: string): HTMLElement | null | "edge" {
  const cells = Array.from(root.querySelectorAll<HTMLElement>("[data-cell]"));
  const index = cells.indexOf(from);
  if (index < 0) return null;
  const box = from.getBoundingClientRect();
  const sameRow = (cell: HTMLElement) => Math.abs(cell.getBoundingClientRect().top - box.top) < 4;
  if (key === "ArrowRight") return cells[index + 1] ?? null;
  if (key === "ArrowLeft") {
    const previous = cells[index - 1];
    return previous && sameRow(previous) ? previous : "edge";
  }
  const down = key === "ArrowDown";
  const rows = cells.filter((cell) => {
    const top = cell.getBoundingClientRect().top;
    return down ? top > box.top + 4 : top < box.top - 4;
  });
  if (!rows.length) return null;
  const rowTop = down
    ? Math.min(...rows.map((cell) => cell.getBoundingClientRect().top))
    : Math.max(...rows.map((cell) => cell.getBoundingClientRect().top));
  const row = rows.filter((cell) => Math.abs(cell.getBoundingClientRect().top - rowTop) < 4);
  const centre = box.left + box.width / 2;
  return row.reduce((best, cell) => {
    const distance = (c: HTMLElement) => Math.abs(c.getBoundingClientRect().left + c.getBoundingClientRect().width / 2 - centre);
    return distance(cell) < distance(best) ? cell : best;
  });
}

function Cell(props: {
  label: string;
  pressed?: boolean;
  busy: boolean;
  onPick(): void;
  onDeleteKey?(): void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-cell=""
      className={`pi-cell${props.className ? ` ${props.className}` : ""}`}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.pressed}
      aria-disabled={props.busy || undefined}
      onClick={() => {
        if (!props.busy) props.onPick();
      }}
      onKeyDown={(event) => {
        if ((event.key === "Delete" || event.key === "Backspace") && props.onDeleteKey) {
          event.preventDefault();
          props.onDeleteKey();
        }
      }}
    >
      {props.children}
    </button>
  );
}

/**
 * Icon art in a cell. While the pointer is over the cell (or it has keyboard
 * focus) an icon with frames plays its loop: one phase per state it has frames
 * for (works, waits, error, done). The frame pictures are only put into the page then.
 */
function IconArt({ icon, live }: { icon: LibraryIcon; live: boolean }) {
  const phases = live ? previewPhases(icon) : [];
  const { frames } = icon;
  const slot = (index: number) => ({ "--k": index }) as CSSProperties;
  return (
    <span className="pi-stack pi-cell-art" data-pi-anim={phases.length ? "preview" : undefined} data-pi-n={phases.length || undefined}>
      <img className="pi-frame pi-frame-base" src={icon.url} alt="" draggable={false} loading="lazy" />
      {phases.map((phase, index) => {
        if (phase === "work") {
          const has = frames.left && frames.right ? "lr" : frames.left ? "l" : "r";
          return (
            <span key={phase} className="pi-phase pi-phase-work" data-pi-has={has} style={slot(index)}>
              <img className="pi-frame pi-frame-base" src={icon.url} alt="" draggable={false} />
              {frames.left && <img className="pi-frame pi-frame-left" src={frames.left} alt="" draggable={false} />}
              {frames.right && <img className="pi-frame pi-frame-right" src={frames.right} alt="" draggable={false} />}
            </span>
          );
        }
        const src = phase === "wait" ? frames.puzzled : phase === "error" ? frames.alert : frames.happy;
        return (
          <span key={phase} className={`pi-phase pi-phase-${phase}`} style={slot(index)}>
            <img className={`pi-frame pi-frame-${phase}`} src={src} alt="" draggable={false} />
          </span>
        );
      })}
    </span>
  );
}

export function Picker({ icons, selected, loadError, actions, onExitLeft }: PickerProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<LibraryIcon | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirmButton.current?.focus({ preventScroll: true });
  }, [confirming]);

  const run = async (label: string, work: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setStatus(label);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(errorText(cause, fallback));
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const pick = (iconId: string | null) => {
    if (iconId === selected) return;
    void run("Сохраняю…", () => actions.select(iconId), "Не удалось сохранить иконку.");
  };

  const upload = async (file: File) => {
    await run(
      "Добавляю картинку…",
      async () => {
        const data = await fileToIcon(file);
        await actions.add(iconNameFromFile(file.name), data);
      },
      "Не удалось добавить картинку.",
    );
  };

  const remove = (icon: LibraryIcon) => {
    setConfirming(null);
    void run("Удаляю…", () => actions.remove(icon.id), "Не удалось удалить картинку.");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.hasAttribute("data-cell") || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    event.stopPropagation();
    const next = moveInGrid(root.current!, target, event.key);
    if (next === "edge") onExitLeft?.();
    else next?.focus({ preventScroll: false });
  };

  const liveIcon = icons?.find((icon) => icon.id === live);
  // What the line under the grid says; its words are switched by CSS in step with the frames.
  const phases = liveIcon ? previewPhases(liveIcon) : [];
  const caption = liveIcon ? (phases.length ? "frames" : "none") : "";

  const liveProps = (id: string) => ({
    onPointerEnter: () => setLive(id),
    onPointerLeave: () => setLive((current) => (current === id ? null : current)),
    onFocus: () => setLive(id),
    onBlur: () => setLive((current) => (current === id ? null : current)),
  });

  return (
    <div ref={root} className="pi-picker" aria-busy={busy} onKeyDown={onKeyDown}>
      {icons === null && !loadError && <p className="pi-note">Загружаю иконки…</p>}
      {loadError && <p className="pi-error" role="alert">{loadError}</p>}
      {icons !== null && (
        <div className="pi-grid" role="group" aria-label="Иконки">
          {pickerCells(icons).map((cell) => {
            if (cell.kind === "none") {
              return (
                <Cell key="none" label="Без иконки" pressed={selected === null} busy={busy} onPick={() => pick(null)}>
                  <span className="pi-none" aria-hidden="true" />
                </Cell>
              );
            }
            if (cell.kind === "add") {
              return (
                <Cell key="add" label="Добавить свою картинку" className="pi-add" busy={busy} onPick={() => fileInput.current?.click()}>
                  <Icon name="Plus" aria-hidden="true" className="pi-add-icon" />
                </Cell>
              );
            }
            const { icon } = cell;
            const art = (
              <Cell key={icon.id} label={icon.name} pressed={selected === icon.id} busy={busy} onPick={() => pick(icon.id)} onDeleteKey={icon.kind === "custom" ? () => setConfirming(icon) : undefined}>
                <IconArt icon={icon} live={live === icon.id} />
              </Cell>
            );
            if (icon.kind !== "custom") {
              return (
                <div key={icon.id} className="pi-slot" {...liveProps(icon.id)}>
                  {art}
                </div>
              );
            }
            return (
              <div key={icon.id} className="pi-slot pi-custom" {...liveProps(icon.id)}>
                {art}
                <button
                  type="button"
                  className="pi-remove"
                  title="Удалить картинку"
                  aria-label={`Удалить картинку ${icon.name}`}
                  aria-disabled={busy || undefined}
                  onClick={() => {
                    if (!busy) setConfirming(icon);
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {icons !== null && (
        <p className="pi-caption" data-pi-caption={caption || undefined} data-pi-n={phases.length || undefined} aria-hidden="true">
          {phases.map((phase, index) => (
            <span key={phase} className="pi-cap" style={{ "--k": index } as CSSProperties}>
              {PHASE_CAPTION[phase]}
            </span>
          ))}
          <span className="pi-cap pi-cap-still">без анимации</span>
          <span className="pi-cap pi-cap-reduced">анимация выключена в системе</span>
        </p>
      )}
      {confirming && (
        <div className="pi-confirm" role="alertdialog" aria-label="Удалить картинку?">
          <p>Удалить картинку «{confirming.name}»?</p>
          <div className="pi-confirm-buttons">
            <button type="button" ref={confirmButton} className="pi-button pi-danger" onClick={() => remove(confirming)}>
              Удалить
            </button>
            <button type="button" className="pi-button" onClick={() => setConfirming(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}
      {error && <p className="pi-error" role="alert">{error}</p>}
      <p className="pi-status" aria-live="polite">{status}</p>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="pi-file"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          void upload(file).catch((cause) => setError(cause instanceof PickError ? cause.message : errorText(cause, "Не удалось добавить картинку.")));
        }}
      />
    </div>
  );
}
