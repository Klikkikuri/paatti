import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { blockReason, safeFetch, readCapped, DEFAULT_TIMEOUT_MS } from '../src/safe-fetch.js';

/** A table over *spellings*, not hosts: one blocked address reached several ways is several cases. */
const BLOCKED = [
    ['http://127.0.0.1/', 'loopback, dotted'],
    ['http://2130706433/', 'loopback as one decimal'],
    ['http://0177.0.0.1/', 'loopback with an octal octet'],
    ['http://127.1/', 'loopback, two parts'],
    ['http://0x7f.1/', 'loopback with a hex octet'],
    ['http://127.0.0.1./', 'loopback with a trailing dot'],
    ['http://[::1]/', 'loopback, v6'],
    ['http://[::ffff:127.0.0.1]/', 'loopback, IPv4-mapped'],
    ['http://[::ffff:7f00:1]/', 'loopback, IPv4-mapped in hex'],
    ['http://0.0.0.0/', 'unspecified'],
    ['http://1/', 'unspecified range, one decimal'],
    ['http://[::]/', 'unspecified, v6'],
    ['http://192.168.1.1/api/shutdown', 'private, the router case'],
    ['http://10.0.0.1/', 'private'],
    ['http://172.16.0.1/', 'private'],
    ['http://[::ffff:192.168.1.1]/', 'private, IPv4-mapped'],
    ['https://100.64.0.1/', 'carrier-grade NAT'],
    ['http://169.254.169.254/', 'link-local, the metadata case'],
    ['https://[fe80::1]/', 'link-local, v6'],
    ['https://[fc00::1]/', 'unique local'],
    ['http://224.0.0.1/', 'multicast'],
    ['http://255.255.255.255/', 'broadcast'],
    ['http://[ff02::1]/', 'multicast, v6'],
    ['http://[64:ff9b::1.2.3.4]/', 'NAT64'],
    ['http://[2001:db8::1]/', 'documentation, v6'],
    ['http://192.0.2.1/', 'documentation'],
    ['http://192.0.0.1/', 'IETF protocol assignments'],
    ['http://192.88.99.1/', '6to4 relay anycast'],
    ['http://198.18.0.1/', 'benchmarking'],
    ['http://198.19.255.255/', 'benchmarking, top of the range'],
    ['http://[2002:c0a8:101::]/', '6to4 carrying a private IPv4 address'],
    ['http://[2001:0:1:2:3:4:5:6]/', 'Teredo'],
    ['http://localhost/', 'localhost'],
    ['http://LOCALHOST/', 'localhost, upper case'],
    ['http://localhost./', 'localhost, fully qualified'],
    ['http://foo.localhost/', 'a localhost subdomain'],
    ['http://printer.local/', 'mDNS'],
    ['http://printer.local./', 'mDNS, fully qualified'],
    ['file:///etc/passwd', 'a scheme that is not http(s)'],
    ['ftp://example.test/a', 'another scheme'],
    ['data:text/plain,hello', 'a data URL'],
    ['not a url', 'not a URL at all'],
];

/** Public addresses and names next to the blocked ranges, which must stay fetchable. */
const ALLOWED = [
    'https://example.test/favicon.ico',
    'http://example.test./favicon.ico',
    'https://localhost.example.test/favicon.ico',
    'https://notlocal.test/favicon.ico',
    'https://9.255.255.255/',
    'https://11.0.0.1/',
    'https://100.63.255.255/',
    'https://100.128.0.1/',
    'https://172.15.255.255/',
    'https://172.32.0.1/',
    'https://169.253.255.255/',
    'https://126.255.255.255/',
    'https://128.0.0.1/',
    'https://223.255.255.255/',
    'https://198.17.255.255/',
    'https://198.20.0.1/',
    'https://192.0.1.1/',
    'https://[2003::1]/',
    'https://[2606:4700::1]/',
    'https://[fbff::1]/',
    'https://[fec0::1]/',
];

describe('blockReason', () => {
    for (const [url, what] of BLOCKED) {
        test(`refuses ${what}: ${url}`, () => {
            assert.notEqual(blockReason(url), null, `${url} was allowed`);
        });
    }

    for (const url of ALLOWED) {
        test(`allows ${url}`, () => {
            assert.equal(blockReason(url), null, `${url} was refused`);
        });
    }

    test('names the reason it refused', () => {
        assert.match(blockReason('http://192.168.1.1/'), /reserved address/);
        assert.match(blockReason('http://printer.local/'), /local name/);
        assert.match(blockReason('ftp://example.test/'), /scheme/);
    });

    test('takes a URL object as well as a string', () => {
        assert.equal(blockReason(new URL('https://example.test/')), null);
        assert.notEqual(blockReason(new URL('http://127.0.0.1/')), null);
    });
});

describe('safeFetch', () => {
    /** Replaces the global fetch for one test and records what it was asked. */
    function recordFetch(response = new Response('')) {
        const calls = [];
        const original = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            calls.push({ url, init });
            return response;
        };
        return { calls, restore: () => { globalThis.fetch = original; } };
    }

    test('issues no request at all for a blocked URL', async () => {
        const { calls, restore } = recordFetch();
        try {
            await assert.rejects(
                safeFetch('http://192.168.1.1/api/shutdown'),
                /Refused to fetch/
            );
            assert.deepEqual(calls, [], 'a request left for a blocked address');
        } finally {
            restore();
        }
    });

    test('forbids redirects and sends no credentials or referrer', async () => {
        const { calls, restore } = recordFetch();
        try {
            await safeFetch('https://example.test/favicon.ico');

            assert.equal(calls.length, 1);
            assert.equal(calls[0].init.redirect, 'error');
            assert.equal(calls[0].init.credentials, 'omit');
            assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
            assert.ok(calls[0].init.signal, 'no timeout signal');
        } finally {
            restore();
        }
    });

    test('lets the caller add to the init but never relax what this function owns', async () => {
        const { calls, restore } = recordFetch();
        try {
            await safeFetch('https://example.test/', {
                init: {
                    method: 'POST',
                    body: 'x',
                    redirect: 'follow',
                    credentials: 'include',
                    referrerPolicy: 'unsafe-url'
                }
            });

            assert.equal(calls[0].init.method, 'POST', 'the caller could not add a method');
            assert.equal(calls[0].init.body, 'x', 'the caller could not add a body');
            assert.equal(calls[0].init.redirect, 'error', 'the caller relaxed the redirect mode');
            assert.equal(calls[0].init.credentials, 'omit', 'the caller sent the user credentials');
            assert.equal(calls[0].init.referrerPolicy, 'no-referrer', 'the caller leaked the referrer');
        } finally {
            restore();
        }
    });

    test('has a timeout by default', () => {
        assert.ok(DEFAULT_TIMEOUT_MS > 0 && DEFAULT_TIMEOUT_MS <= 30_000);
    });
});

describe('readCapped', () => {
    /** A response whose body arrives in chunks, so the cap is tested while it streams. */
    function chunked(chunks, headers = {}) {
        const body = new ReadableStream({
            start(controller) {
                for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
                controller.close();
            }
        });
        return new Response(body, { headers });
    }

    test('returns a body inside the cap', async () => {
        const bytes = await readCapped(chunked([[1, 2, 3], [4, 5]]), 100);
        assert.deepEqual([...bytes], [1, 2, 3, 4, 5]);
    });

    test('refuses a body that exceeds the cap while it streams', async () => {
        await assert.rejects(readCapped(chunked([[1, 2, 3], [4, 5, 6]]), 4), /too large/);
    });

    test('refuses a claimed content-length over the cap without reading the body', async () => {
        // The distinct message is the evidence: this rejection comes from the header check, before the
        // stream is touched, rather than from the running total.
        await assert.rejects(
            readCapped(chunked([[1]], { 'content-length': '5000' }), 100),
            /5000 bytes claimed/
        );
    });

    test('holds the cap when the body arrives without a content-length', async () => {
        await assert.rejects(readCapped(chunked([[1, 2, 3, 4, 5]]), 4), /over 4 bytes/);
    });

    test('reads an empty body as no bytes', async () => {
        const bytes = await readCapped(new Response(null, { status: 204 }), 100);
        assert.equal(bytes.byteLength, 0);
    });
});
