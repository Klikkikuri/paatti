"use strict";

/**
 * The one place the worker issues a fetch for a URL it did not build from its own configuration.
 *
 * A page can put any URL in front of the extension -- a `link[rel=icon]` is enough -- and the worker
 * requests it from inside the user's network, with no page to refuse the response. So the address is
 * classified before the request leaves, no redirect is followed, and both the wait and the response
 * size are bounded.
 *
 * The residual, stated plainly: an extension cannot see the address a name resolves to. A public
 * hostname with an `A` record inside RFC 1918 passes every check here, and nothing downstream catches
 * it -- CORS governs what a page may *read*, never whether the request was sent. This bounds the
 * careless and the naive case, not a determined one.
 *
 * `allowLoopback` is the one deliberate exception: a caller who has the user's own opt-in may re-admit
 * loopback addresses alone, for a provider the user chose to reach on their own machine. Every other
 * reserved range, and loopback itself without the option, stays refused.
 */

/** How long a request may take before it is abandoned. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Names that resolve to this host or to this link by definition: RFC 6761 for localhost, mDNS for .local. */
const BLOCKED_NAMES = new Set(["localhost"]);
const BLOCKED_NAME_SUFFIXES = [".localhost", ".local"];

/**
 * The 4 bytes of a dotted-decimal IPv4 literal, or null for anything that is not one.
 *
 * `new URL()` has already canonicalised every other spelling -- `2130706433`, `0177.0.0.1`, `127.1` and
 * `0x7f.1` all arrive here as `127.0.0.1` -- so this parser only has to read the one form.
 *
 * @param {string} host
 * @returns {number[]|null}
 */
function parseIPv4(host) {
    const parts = host.split(".");
    if (parts.length !== 4) return null;

    const bytes = [];
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const value = Number(part);
        if (value > 255) return null;
        bytes.push(value);
    }
    return bytes;
}

/**
 * The 16 bytes of a bracketed IPv6 literal, or null for anything that is not one.
 *
 * The canonical form `new URL()` produces is compressed lowercase hex with no dotted tail, so
 * `[::ffff:127.0.0.1]` arrives as `[::ffff:7f00:1]` and both spellings parse to the same bytes.
 *
 * @param {string} host
 * @returns {number[]|null}
 */
function parseIPv6(host) {
    if (!host.startsWith("[") || !host.endsWith("]")) return null;

    const groups = host.slice(1, -1).split("::");
    if (groups.length > 2) return null;

    const toWords = (group) => (group === "" ? [] : group.split(":").map((hex) => Number.parseInt(hex, 16)));
    const head = toWords(groups[0]);
    const tail = groups.length === 2 ? toWords(groups[1]) : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;

    const words = [...head, ...Array(missing).fill(0), ...tail];
    if (words.length !== 8 || words.some((word) => !Number.isInteger(word))) return null;

    return words.flatMap((word) => [word >> 8, word & 0xff]);
}

/** Whether `bytes` falls inside `network/prefixBits`, compared numerically rather than as text. */
function inRange(bytes, [network, prefixBits]) {
    for (let index = 0; index < bytes.length; index++) {
        const bits = Math.min(8, Math.max(0, prefixBits - index * 8));
        if (bits === 0) return true;

        const mask = (0xff << (8 - bits)) & 0xff;
        if ((bytes[index] & mask) !== (network[index] & mask)) return false;
    }
    return true;
}

/** The loopback CIDRs, named once so the block table and `LOOPBACK_V4`/`LOOPBACK_V6` below can't drift apart. */
const LOOPBACK_V4_CIDR = ["127.0.0.0", 8];
const LOOPBACK_V6_CIDR = ["::1", 128];

/** Ranges that never hold a public server. Parsed through the same parsers, so a typo in the table shows up here. */
const BLOCKED_V4 = [
    ["0.0.0.0", 8],         // unspecified, and "this host on this network"
    ["10.0.0.0", 8],        // private
    ["100.64.0.0", 10],     // carrier-grade NAT
    LOOPBACK_V4_CIDR,
    ["169.254.0.0", 16],    // link-local
    ["172.16.0.0", 12],     // private
    ["192.0.0.0", 24],      // IETF protocol assignments
    ["192.0.2.0", 24],      // documentation
    ["192.88.99.0", 24],    // 6to4 relay anycast
    ["192.168.0.0", 16],    // private
    ["198.18.0.0", 15],     // benchmarking
    ["198.51.100.0", 24],   // documentation
    ["203.0.113.0", 24],    // documentation
    ["224.0.0.0", 4],       // multicast
    ["240.0.0.0", 4],       // reserved, and the 255.255.255.255 broadcast inside it
].map(([network, bits]) => [parseIPv4(network), bits]);

const BLOCKED_V6 = [
    ["::", 128],            // unspecified
    LOOPBACK_V6_CIDR,
    ["64:ff9b::", 96],      // NAT64, which reaches an IPv4 address through a v6 spelling
    ["100::", 64],          // discard-only
    ["2001::", 32],         // Teredo, which carries an IPv4 address
    ["2001:db8::", 32],     // documentation
    ["2002::", 16],         // 6to4, which carries an IPv4 address
    ["fc00::", 7],          // unique local
    ["fe80::", 10],         // link-local
    ["ff00::", 8],          // multicast
].map(([network, bits]) => [parseIPv6(`[${network}]`), bits]);

/** IPv4-mapped IPv6 is `::ffff:0:0/96`; the address it carries is the last 4 bytes. */
const IPV4_MAPPED = [parseIPv6("[::ffff:0:0]"), 96];

/** The loopback rows of the tables above, addressed on their own so `allowLoopback` can re-admit exactly them. */
const LOOPBACK_V4 = [parseIPv4(LOOPBACK_V4_CIDR[0]), LOOPBACK_V4_CIDR[1]];
const LOOPBACK_V6 = [parseIPv6(`[${LOOPBACK_V6_CIDR[0]}]`), LOOPBACK_V6_CIDR[1]];

/**
 * `hostname` as address bytes, with an IPv4-mapped IPv6 literal unwrapped to the IPv4 it carries -- the
 * one classification step every address-range check here needs before it can compare against a table.
 *
 * @param {string} hostname
 * @returns {number[]|null} 4 bytes for IPv4 (mapped or bare), 16 for IPv6, null for a name.
 */
function parseAddress(hostname) {
    const v6 = parseIPv6(hostname);
    if (v6) return inRange(v6, IPV4_MAPPED) ? v6.slice(12) : v6;
    return parseIPv4(hostname);
}

/**
 * Whether `hostname` is a loopback spelling: `127.0.0.0/8`, `::1`, an IPv4-mapped form of either, or
 * the names `localhost` and `*.localhost`. Not `.local` -- mDNS, not loopback -- and not the
 * unspecified addresses, which stay refused even where loopback is allowed.
 *
 * @param {string} hostname - Already lowercased and canonicalised, e.g. via `new URL().hostname`; this
 *   does no normalisation of its own, so an uppercase-spelled name would not match `localhost` here.
 * @returns {boolean}
 */
export function isLoopbackHost(hostname) {
    const address = parseAddress(hostname);
    if (address) return inRange(address, address.length === 4 ? LOOPBACK_V4 : LOOPBACK_V6);

    const name = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
    return name === "localhost" || name.endsWith(".localhost");
}

/**
 * Why `url` must not be requested, or null when nothing here objects to it.
 *
 * @param {string|URL} url
 * @param {object} [options]
 * @param {boolean} [options.allowLoopback] - Re-admit loopback addresses, for a provider the user opted
 *   into reaching on their own machine. Every other reserved range stays refused.
 * @returns {string|null}
 */
export function blockReason(url, { allowLoopback = false } = {}) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return "not a URL";
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return `scheme ${parsed.protocol}`;

    const host = parsed.hostname;
    if (allowLoopback && isLoopbackHost(host)) return null;

    const address = parseAddress(host);
    if (address) {
        const blocked = address.length === 4 ? BLOCKED_V4 : BLOCKED_V6;
        if (blocked.some((range) => inRange(address, range))) return `reserved address ${host}`;
        return null;
    }

    // A fully qualified name keeps its trailing dot here, and `localhost.` is still localhost.
    const name = host.endsWith(".") ? host.slice(0, -1) : host;
    if (BLOCKED_NAMES.has(name) || BLOCKED_NAME_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
        return `local name ${host}`;
    }

    return null;
}

/**
 * Fetch `url`, refusing it outright unless `blockReason` passes it.
 *
 * The redirect mode, the credentials, the referrer policy and the timeout all overrule the caller's
 * init rather than defaulting under it. `redirect: "error"` because filtering the URL written is not
 * filtering the URL reached, and a 302 into `192.168.0.0/16` would otherwise be followed; the other
 * two because a URL a page chose must not be sent the user's cookies or told where they came from.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {RequestInit} [options.init] - Laid *under* the four fields above, which it cannot relax.
 * @param {number} [options.timeoutMs]
 * @param {boolean} [options.allowLoopback] - See `blockReason`.
 * @returns {Promise<Response>}
 */
export async function safeFetch(url, { init = {}, timeoutMs = DEFAULT_TIMEOUT_MS, allowLoopback = false } = {}) {
    const reason = blockReason(url, { allowLoopback });
    if (reason) throw new Error(`Refused to fetch: ${reason}`);

    return fetch(url, {
        ...init,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs)
    });
}

/**
 * The response body, up to `maxBytes`, read as bytes.
 *
 * Streamed rather than buffered whole: `content-length` is the server's claim and a chunked response
 * carries none at all, so the cap has to hold while the body arrives.
 *
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<Uint8Array>}
 */
export async function readCapped(response, maxBytes) {
    const claimed = Number(response.headers.get("content-length"));
    if (Number.isFinite(claimed) && claimed > maxBytes) {
        throw new Error(`Response too large: ${claimed} bytes claimed, ${maxBytes} allowed`);
    }

    if (!response.body) return new Uint8Array(0);

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new Error(`Response too large: over ${maxBytes} bytes`);
        }
        chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}
