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

/** Ranges that never hold a public server. Parsed through the same parsers, so a typo in the table shows up here. */
const BLOCKED_V4 = [
    ["0.0.0.0", 8],         // unspecified, and "this host on this network"
    ["10.0.0.0", 8],        // private
    ["100.64.0.0", 10],     // carrier-grade NAT
    ["127.0.0.0", 8],       // loopback
    ["169.254.0.0", 16],    // link-local
    ["172.16.0.0", 12],     // private
    ["192.0.2.0", 24],      // documentation
    ["192.168.0.0", 16],    // private
    ["198.51.100.0", 24],   // documentation
    ["203.0.113.0", 24],    // documentation
    ["224.0.0.0", 4],       // multicast
    ["240.0.0.0", 4],       // reserved, and the 255.255.255.255 broadcast inside it
].map(([network, bits]) => [parseIPv4(network), bits]);

const BLOCKED_V6 = [
    ["::", 128],            // unspecified
    ["::1", 128],           // loopback
    ["64:ff9b::", 96],      // NAT64, which reaches an IPv4 address through a v6 spelling
    ["100::", 64],          // discard-only
    ["2001:db8::", 32],     // documentation
    ["fc00::", 7],          // unique local
    ["fe80::", 10],         // link-local
    ["ff00::", 8],          // multicast
].map(([network, bits]) => [parseIPv6(`[${network}]`), bits]);

/** IPv4-mapped IPv6 is `::ffff:0:0/96`; the address it carries is the last 4 bytes. */
const IPV4_MAPPED = [parseIPv6("[::ffff:0:0]"), 96];

/**
 * Why `url` must not be requested, or null when nothing here objects to it.
 *
 * @param {string|URL} url
 * @returns {string|null}
 */
export function blockReason(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return "not a URL";
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return `scheme ${parsed.protocol}`;

    const host = parsed.hostname;

    const v6 = parseIPv6(host);
    if (v6) {
        const address = inRange(v6, IPV4_MAPPED) ? v6.slice(12) : v6;
        const blocked = address.length === 4 ? BLOCKED_V4 : BLOCKED_V6;
        if (blocked.some((range) => inRange(address, range))) return `reserved address ${host}`;
        return null;
    }

    const v4 = parseIPv4(host);
    if (v4) {
        if (BLOCKED_V4.some((range) => inRange(v4, range))) return `reserved address ${host}`;
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
 * `redirect: "error"` is not negotiable and overrides the caller: filtering the URL written is not
 * filtering the URL reached, and a 302 into `192.168.0.0/16` would otherwise be followed.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {RequestInit} [options.init] - Laid over the defaults below.
 * @param {number} [options.timeoutMs]
 * @returns {Promise<Response>}
 */
export async function safeFetch(url, { init = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const reason = blockReason(url);
    if (reason) throw new Error(`Refused to fetch: ${reason}`);

    return fetch(url, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        ...init,
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
