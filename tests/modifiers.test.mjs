import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

const fake = createFakeBrowser({
    sync: { modifiers: { aiSlop: true, video: true, converted: false } },
    messages: {
        modifierAiSlopTitle: 'AI Content Marker',
        modifierAiSlopDesc: 'Displays an indicator on headlines for content exhibiting characteristics typical of AI-generated or AI-translated material.',
        modifierAiSlopLabel: 'AI',
        modifierAiSlopTooltip: 'Content exhibits characteristics typical of AI-generated or AI-translated material.',
        modifierVideoTitle: 'Video Content Marker',
        modifierVideoDesc: 'Shows a video icon next to headlines when the link is mostly video rather than a written article.',
        modifierVideoLabel: 'Video',
        modifierVideoTooltip: 'This link is mostly video rather than a written article.',
        modifierConvertedTitle: 'Converted Headline Marker',
        modifierConvertedDesc: 'Shows an indicator next to headlines whose text Paatti has replaced with the aligned version.',
        modifierConvertedLabel: 'Converted',
        modifierConvertedTooltip: 'Paatti replaced this headline with an aligned version.',
        modifierConvertedAction: 'Converted headline feedback'
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

test('the converted modifier applies a badge when the headline was swapped', async () => {
    await setModifiers({ aiSlop: false, video: false, converted: true });

    const result = await applyModifiers('Aligned Title', { labels: ['com.github.klikkikuri/converted=true'] });

    assert.equal(result.text, 'Aligned Title');
    assert.equal(result.badges.length, 1);
    assert.equal(result.badges[0].tagName, 'klikkikuri-converted-badge');
    assert.equal(result.badges[0].badgeText, 'Converted');
    assert.equal(result.badges[0].tooltip, 'Paatti replaced this headline with an aligned version.');
});

test('only the converted badge claims an action, which is what makes it a button', async () => {
    await setModifiers({ aiSlop: true, video: true, converted: true });

    const result = await applyModifiers('Aligned Title', {
        labels: [
            'com.github.klikkikuri/converted=true',
            'com.github.klikkikuri/ai-slop=true',
            'com.github.klikkikuri/type=video'
        ]
    });

    const actions = Object.fromEntries(result.badges.map((badge) => [badge.tagName, badge.action]));
    assert.deepEqual(actions, {
        'klikkikuri-converted-badge': 'Converted headline feedback',
        'klikkikuri-ai-badge': undefined,
        'klikkikuri-video-badge': undefined
    });
});

test('the converted modifier is ignored when disabled in settings', async () => {
    await setModifiers({ aiSlop: false, video: false, converted: false });

    const result = await applyModifiers('Aligned Title', { labels: ['com.github.klikkikuri/converted=true'] });

    assert.equal(result.badges.length, 0);
});

test('a headline left as the publisher wrote it gets no converted badge', async () => {
    await setModifiers({ aiSlop: false, video: false, converted: true });

    const result = await applyModifiers('Original Title', { labels: ['com.github.klikkikuri/article-type=article'] });

    assert.equal(result.text, 'Original Title');
    assert.equal(result.badges.length, 0);
});

test('the converted badge leads the badges of the content behind the link', async () => {
    await setModifiers({ aiSlop: true, video: false, converted: true });

    const result = await applyModifiers('Aligned AI Title', {
        labels: ['com.github.klikkikuri/ai-slop=true', 'com.github.klikkikuri/converted=true']
    });

    assert.deepEqual(result.badges.map((badge) => badge.tagName),
        ['klikkikuri-converted-badge', 'klikkikuri-ai-badge']);
});

test('unlabeled entries receive no modifier badges', async () => {
    const result = await applyModifiers('Normal Title', { labels: ['com.github.klikkikuri/article-type=article'] });

    assert.equal(result.text, 'Normal Title');
    assert.equal(result.badges.length, 0);
});
