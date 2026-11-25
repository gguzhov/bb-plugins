// Что остаётся видимым над полем ввода, пока стоит карточка плана: всё, на что владельцу нужно ответить.

/**
 * What must stay visible whatever the rule: anything the owner has to answer.
 * Live in bb's composer stack: the question form of the agent is a section
 * with data-testid="user-question-banner" (inside it data-question-form and
 * radio/checkbox inputs); permission, plan-review and plugin requests are
 * banners with their own data-testid. The allow/deny buttons have no marker
 * of their own, so the banner's testid is the sign, and the button texts
 * (English only) are a last resort.
 */
export const NEEDS_ANSWER_SELECTOR = [
  "[data-child-question-row]",
  "[data-question-form]",
  "[data-question-tabs]",
  '[aria-label="Needs input"]',
  '[data-testid="user-question-banner"]',
  '[data-testid="approval-banner"]',
  '[data-testid="plan-review-banner"]',
  '[data-testid="plugin-request-banner"]',
  '[data-testid="plugin-interaction-shell"]',
  "input:not([type=hidden])",
  "textarea",
  "select",
  '[role="radio"]',
  '[role="radiogroup"]',
  '[role="checkbox"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
].join(",");
const PERMISSION_BUTTONS = /^(Allow once|Allow for session|Deny)$/;

export function needsOwnerAnswer(item: Element): boolean {
  if (item.matches(NEEDS_ANSWER_SELECTOR) || item.querySelector(NEEDS_ANSWER_SELECTOR) !== null) return true;
  return Array.from(item.querySelectorAll("button")).some((button) => PERMISSION_BUTTONS.test(button.textContent?.trim() ?? ""));
}

