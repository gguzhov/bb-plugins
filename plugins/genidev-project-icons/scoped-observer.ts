// Watches the page for DOM changes without waking up on the chat stream.
//
// A MutationObserver on document.body with subtree:true fires on every streamed
// token. Here the chat timeline is left out: on the chain of its ancestors only
// direct children are watched (to notice a remount), every other branch is watched
// in full, and the timeline itself is never observed. Same idea as in the
// «Цвета проектов» plugin, written out for reading.

const TIMELINE = '[data-panel-id="thread-detail-timeline-panel"]';

export function watchDocument(onChange: () => void, signal?: AbortSignal): () => void {
  let observer: MutationObserver | null = null;
  let skipped = new Set<Node>();
  let ancestors = new Set<Node>();
  let stopped = false;

  const timelineMoved = () => {
    const now = Array.from(document.querySelectorAll(TIMELINE));
    return now.length !== skipped.size || now.some((node) => !skipped.has(node));
  };

  const observe = (node: Node) => {
    if (skipped.has(node)) return;
    if (ancestors.has(node)) {
      observer!.observe(node, { childList: true });
      node.childNodes.forEach(observe);
    } else {
      observer!.observe(node, { childList: true, subtree: true });
    }
  };

  const attach = () => {
    observer?.disconnect();
    skipped = new Set(Array.from(document.querySelectorAll(TIMELINE)));
    ancestors = new Set();
    for (const timeline of skipped) {
      for (let node = timeline.parentNode; node; node = node.parentNode) ancestors.add(node);
    }
    observer = new MutationObserver((records) => {
      const touchesAncestors = records.some((record) => ancestors.has(record.target));
      if ((touchesAncestors || skipped.size === 0) && timelineMoved()) attach();
      onChange();
    });
    observe(document);
  };

  attach();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
    observer = null;
  };
  signal?.addEventListener("abort", stop, { once: true });
  return stop;
}
