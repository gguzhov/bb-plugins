// Values shared by the server and the frontend bundle (kept free of server imports).

/** Realtime channel: the server publishes it after every change. */
export const CHANGED = "changed";

/**
 * Extra pictures an icon may have: eyes left, eyes right, puzzled face (waiting),
 * scared face (error: wide eyes, open mouth), happy face (done: arc eyes, smile).
 */
export const FRAME_NAMES = ["left", "right", "puzzled", "alert", "happy"] as const;
export type FrameName = (typeof FRAME_NAMES)[number];

export function isFrameName(value: string): value is FrameName {
  return (FRAME_NAMES as readonly string[]).includes(value);
}

/** Frame picture URLs of one icon; a missing key means the icon has no such frame. */
export type IconFrames = Partial<Record<FrameName, string>>;

/** Name of the boolean plugin setting that turns sidebar animation on and off. */
export const ANIMATION_SETTING = "animation";

/** Name of the boolean plugin setting that lets the plugin pick an icon for a new project. */
export const AUTO_ASSIGN_SETTING = "autoAssign";
