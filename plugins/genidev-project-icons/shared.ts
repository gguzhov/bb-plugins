// Values shared by the server and the frontend bundle (kept free of server imports).

/** Realtime channel: the server publishes it after every change. */
export const CHANGED = "changed";

/** Extra pictures an icon may have for animation: eyes left, eyes right, puzzled face. */
export const FRAME_NAMES = ["left", "right", "puzzled"] as const;
export type FrameName = (typeof FRAME_NAMES)[number];

export function isFrameName(value: string): value is FrameName {
  return (FRAME_NAMES as readonly string[]).includes(value);
}

/** Frame picture URLs of one icon; a missing key means the icon has no such frame. */
export type IconFrames = Partial<Record<FrameName, string>>;

/** Name of the boolean plugin setting that turns sidebar animation on and off. */
export const ANIMATION_SETTING = "animation";
