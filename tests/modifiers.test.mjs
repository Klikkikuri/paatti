import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

const fake = createFakeBrowser({
    sync: { modifiers: { aiSlop: true, video: true } },
    messages: {
        modifierAiSlopTitle: 'AI Content Marker',
        modifierAiSlopDesc: 'Displays an indicator on headlines for content exhibiting characteristics typical of AI-generated or AI-translated material.',
        modifierAiSlopLabel: 'AI',
        modifierAiSlopTooltip: 'Content exhibits characteristics typical of AI-generated or AI-translated material.',
        modifierVideoTitle: 'Video Content Marker',
        modifierVideoDesc: 'Shows a video icon next to headlines when the link is mostly video rather than a written article.',
        modifierVideoLabel: 'Video',
        modifierVideoTooltip: 'This link is mostly video rather than a written article.'
    }
});
globalThis.browser = fake.browser;

const { applyModifiers } = await import('../src/modifiers.js');

/** Writing the key for real is what invalidates the config cache, as it does at runtime. */
const setModifiers = (modifiers) => fake.browser.storage.sync.set({ modifiers });

test('the video modifier applies a badge when enabled and the label matches', async () => {
    await setModifiers({ aiSlop: false, video: true });

    const result = await applyModifiers('Test Video Title', { labels: ['com.github.klikkikuri/type=video'] });

    assert.equal(result.text, 'Test Video Title');
    assert.equal(result.badges.length, 1);
    assert.equal(result.badges[0].tagName, 'klikkikuri-video-badge');
    assert.equal(result.badges[0].badgeText, 'Video');
    assert.equal(result.badges[0].tooltip, 'This link is mostly video rather than a written article.');
});

test('the video modifier is ignored when disabled in settings', async () => {
    await setModifiers({ aiSlop: false, video: false });

    const result = await applyModifiers('Test Video Title', { labels: ['com.github.klikkikuri/type=video'] });

    assert.equal(result.text, 'Test Video Title');
    assert.equal(result.badges.length, 0);
});

test('multiple active modifiers apply badges in sequence', async () => {
    await setModifiers({ aiSlop: true, video: true });

    const result = await applyModifiers('Combined Title', {
        labels: ['com.github.klikkikuri/ai-slop=true', 'com.github.klikkikuri/type=video']
    });

    assert.equal(result.text, 'Combined Title');
    assert.deepEqual(result.badges.map((badge) => badge.tagName), ['klikkikuri-ai-badge', 'klikkikuri-video-badge']);
});

test('unlabeled entries receive no modifier badges', async () => {
    const result = await applyModifiers('Normal Title', { labels: ['com.github.klikkikuri/article-type=article'] });

    assert.equal(result.text, 'Normal Title');
    assert.equal(result.badges.length, 0);
});
