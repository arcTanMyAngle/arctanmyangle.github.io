/**
 * The URL rule every published link must pass (PLAN §3.3). The schemas' `HttpsUrl` pattern is the first gate; this
 * adds what a regex can't say cleanly. The M2 publish RPC mirrors it in SQL, so keep the two in step.
 *
 * Accepted: `https:` only, a dotted DNS host name, default port, no credentials. Rejected: other schemes
 * (`javascript:`, `data:`, `http:`), `user:pass@`, IPv4/IPv6 literals, punycode (`xn--`) labels — which also catches
 * unicode lookalike hosts, since the URL parser converts them to punycode — single-label hosts such as `localhost`,
 * explicit ports, and any whitespace or control character in the raw string.
 */
export interface SafeUrlOptions {
  /** When given, the host must equal an entry, or be a subdomain of a `*.example.com` entry. */
  allowHosts?: readonly string[];
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function hostAllowed(host: string, allowHosts: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowHosts.some((entry) => {
    const e = entry.toLowerCase();
    if (e.startsWith("*.")) return h.endsWith(e.slice(1)) && h.length > e.length - 1;
    return h === e;
  });
}

export function isSafeUrl(raw: unknown, options: SafeUrlOptions = {}): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return false;
  // Whitespace and control characters (the URL parser would silently strip some of them).
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return false;
  // Lowercase scheme only, exactly as the schemas' HttpsUrl pattern says.
  if (!raw.startsWith("https://")) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.port !== "") return false;

  const host = url.hostname.toLowerCase();
  if (host.startsWith("[") || host.includes(":")) return false; // IPv6 literal
  if (IPV4.test(host)) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (!LABEL.test(label)) return false;
    if (label.startsWith("xn--")) return false;
  }
  // A numeric top-level label means the parser read an IP in some other notation (e.g. `0x7f.1`).
  if (/^\d+$/.test(labels[labels.length - 1])) return false;

  if (options.allowHosts && !hostAllowed(host, options.allowHosts)) return false;
  return true;
}
