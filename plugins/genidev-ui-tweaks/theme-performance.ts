const BEAUTIFUL_CHAT = 'link[data-bb-plugin-css="beautiful-chat"], style[data-bb-plugin-css="beautiful-chat"]';
const BB_THEME = 'style#bb-app-theme';
const SELECTOR_WITHOUT_MATCHES = ":not(*)";

function isSupportedTheme(node: Element | null): boolean {
 if (!node) return false;
 if (node.matches(BEAUTIFUL_CHAT)) return true;
 return node.matches(BB_THEME) && (node.textContent ?? "").includes("bb-plugin-chatgpt-skin");
}

/** These two themes add relational rules that invalidate styles across BB on sidebar hover.
 * Keep their colour tokens and simple selectors. Restore original selectors when disabled. */
export function installThemePerformance(doc: Document): () => void {
 const original = new Map<CSSStyleRule, string>();
 const visited = new WeakSet<CSSStyleSheet>();
 const filter = (rules: CSSRuleList) => {
  for (const rule of Array.from(rules)) {
   if ("selectorText" in rule && typeof rule.selectorText === "string" && rule.selectorText.includes(":has(")) {
    const style = rule as CSSStyleRule;
    original.set(style, style.selectorText);
    style.selectorText = SELECTOR_WITHOUT_MATCHES;
   }
   if ("cssRules" in rule) filter((rule as CSSGroupingRule).cssRules);
  }
 };
 const scan = () => {
  for (const [rule] of original) {
   if (!rule.parentStyleSheet?.ownerNode?.isConnected) original.delete(rule);
  }
  for (const node of Array.from(doc.head.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(BEAUTIFUL_CHAT + ", " + BB_THEME))) {
   if (!isSupportedTheme(node)) continue;
   const sheet = node.sheet;
   if (!sheet || visited.has(sheet)) continue;
   try {
    const rules = sheet.cssRules;
    filter(rules);
    visited.add(sheet);
   } catch {
    // Browsers can restrict access to stylesheets served by a different origin.
   }
  }
 };
 const observer = new MutationObserver(scan);
 observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
 doc.head.addEventListener("load", scan, true);
 scan();
 return () => {
  observer.disconnect();
  doc.head.removeEventListener("load", scan, true);
  for (const [rule, selector] of original) {
   if (rule.selectorText === SELECTOR_WITHOUT_MATCHES) rule.selectorText = selector;
  }
 };
}
