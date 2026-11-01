import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { registerInvitation } from '../src/options/invitation.js';

describe('registerInvitation', () => {
    test('posts the address as a form, without credentials or a referrer', async () => {
        const calls = [];
        await registerInvitation('reader@example.com', { fetch: async (url, init) => { calls.push({ url, init }); } });

        assert.equal(calls.length, 1);
        const { url, init } = calls[0];
        assert.match(url, /^https:\/\/docs\.google\.com\/forms\/d\/e\/.+\/formResponse$/);
        assert.equal(init.method, 'POST');
        assert.equal(init.mode, 'no-cors');
        assert.equal(init.credentials, 'omit');
        assert.equal(init.referrerPolicy, 'no-referrer');
        assert.equal(init.body.get('emailAddress'), 'reader@example.com');
        assert.equal(init.body.get('pageHistory'), '0');
        assert.ok(Number(init.body.get('submissionTimestamp')) > 0);
    });

    test('rejects when the network fails', async () => {
        const failing = async () => { throw new TypeError('network down'); };
        await assert.rejects(registerInvitation('reader@example.com', { fetch: failing }), TypeError);
    });
});
