import test, { describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const dom = installDom();
const fake = createFakeBrowser({
    messages: {
        invitationEmailRequired: 'Please enter an email address',
        invitationEmailSending: 'Sending...',
        invitationEmailSent: 'Sent',
        invitationEmailSuccess: 'Registered',
        invitationEmailError: 'Error registering email',
    },
});
globalThis.browser = fake.browser;

await import('../src/options/components/paid-invitation-setting.js');

after(() => dom.teardown());

const realFetch = globalThis.fetch;
let posted;

beforeEach(() => {
    posted = [];
    globalThis.fetch = async (url, init) => { posted.push({ url, init }); };
    document.body.replaceChildren();
});

after(() => { globalThis.fetch = realFetch; });

const settled = () => new Promise((r) => setTimeout(r, 0));

async function mount() {
    const el = document.createElement('paid-invitation-setting');
    document.body.append(el);
    await settled();
    return el;
}

function type(el, value) {
    const input = el.querySelector('input');
    input.value = value;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

function record() {
    const seen = [];
    const fn = (e) => seen.push(e.detail);
    document.addEventListener('setting-saved', fn);
    return { seen, stop: () => document.removeEventListener('setting-saved', fn) };
}

describe('paid-invitation-setting', () => {
    test('Send waits for a valid address', async () => {
        const el = await mount();
        const button = el.querySelector('.email-submit-btn');
        assert.equal(button.disabled, true);

        type(el, 'reader@example.com');
        assert.equal(button.disabled, false);

        type(el, '');
        assert.equal(button.disabled, true);
    });

    test('a submit posts the address, announces the save and shows the sent state', async () => {
        const el = await mount();
        const events = record();
        type(el, 'reader@example.com');

        el.querySelector('.email-submit-btn').click();
        await settled();
        await settled();
        events.stop();

        assert.equal(posted.length, 1);
        assert.equal(posted[0].init.body.get('emailAddress'), 'reader@example.com');
        assert.equal(el.querySelector('.email-submit-btn').textContent, 'Sent');
        assert.equal(el.querySelector('.invitation-status').textContent, 'Registered');
        assert.deepEqual(events.seen.map(({ key, value, success }) => ({ key, value, success })),
            [{ key: 'email', value: 'reader@example.com', success: true }]);
    });

    test('a network failure shows the error in the component and announces nothing', async () => {
        globalThis.fetch = async () => { throw new TypeError('network down'); };
        const el = await mount();
        const events = record();
        type(el, 'reader@example.com');

        el.querySelector('.email-submit-btn').click();
        await settled();
        await settled();
        events.stop();

        const status = el.querySelector('.invitation-status');
        assert.equal(status.textContent, 'Error registering email');
        assert.ok(status.classList.contains('error'));
        assert.equal(el.querySelector('.email-submit-btn').disabled, false);
        assert.equal(events.seen.length, 0);
    });

    test('Enter in the field submits', async () => {
        const el = await mount();
        type(el, 'reader@example.com');

        el.querySelector('input').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await settled();

        assert.equal(posted.length, 1);
    });

    test('a detached component leaves no listener on the document', async () => {
        const el = await mount();
        el.remove();
        const input = el.querySelector('input');
        type(el, 'reader@example.com');
        input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await settled();

        assert.equal(posted.length, 0);
    });
});
