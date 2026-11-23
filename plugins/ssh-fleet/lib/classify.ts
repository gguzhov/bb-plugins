import { t } from "./i18n.ts";

export const HOST_KEY_FIXTURE = "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED";
export const AUTH_FIXTURE = "Permission denied (publickey";

export type FailureCode =
  | "host_key_changed"
  | "auth"
  | "ssh_error"
  | "timeout"
  | "dns"
  | "blocked_target"
  | "truncated";

export function classifyFailure(input: {
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}): FailureCode {
  if (input.truncated) return "truncated";
  if (input.timedOut) return "timeout";
  if (input.stderr.includes(HOST_KEY_FIXTURE)) return "host_key_changed";
  if (input.stderr.includes(AUTH_FIXTURE)) return "auth";
  return "ssh_error";
}

/** The stored error text, in the language current when the check ran; the panel re-translates by code. */
export function errorSentence(code: FailureCode | "partial"): string {
  return t(`probe.${code}`);
}
