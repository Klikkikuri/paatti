import browser from '../../browser-api.js';
import { onConfigValue } from '../../config.js';
import { Clickbaitiness } from '../../model.js';
import { controller } from '../../controller.js';
import { localizeDocument, getClickbaitLevelInfo } from '../utils.js';
import { markWizardDone } from '../../welcome-state.js';
import { buildDeck, modeOf, slideAtLine, createNavigator } from './deck.js';
import '../components/clickbait-level-horizontal.js';
import '../components/title-modifier-setting.js';
import '../components/site-list-setting.js';
import '../components/database-status-setting.js';
import '../components/favicon-img.js';
import './step-indicator.js';

/** Level of each sample headline in the strictness figure: all five of the slider. */
const SAMPLE_LEVELS = [0, 1, 2, 3, 4];
const DEFAULT_LEVEL = 2;

/** How long a move that the code started may take to reach its slide before the scroll position leads again. */
const SCROLL_SETTLE_MS = 900;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Which pin hint applies. Firefox is told apart by an API that only it has; Android by its user agent. */
function browserKind() {
    if (/Android/i.test(navigator.userAgent)) return 'android';
    return typeof browser.runtime.getBrowserInfo === 'function' ? 'firefox' : 'chromium';
}

/** Keep the two bars from hiding a slide: the CSS reserves exactly the height that they have now. */
function reserveBarSpace() {
    const root = document.documentElement;
    const measure = () => {
        root.style.setProperty('--bar-top', `${document.querySelector('.bar-top').offsetHeight}px`);
        root.style.setProperty('--bar-bottom', `${document.querySelector('.bar-bottom').offsetHeight}px`);
    };
    new ResizeObserver(measure).observe(document.querySelector('.bar-top'));
    new ResizeObserver(measure).observe(document.querySelector('.bar-bottom'));
    measure();
}

/** Drop the slides that the chosen mode does not have, and number the figures that are left. */
function buildSlides(mode) {
    const wanted = new Set(buildDeck(mode).map((slide) => slide.id));
    for (const section of document.querySelectorAll('.slide')) {
        if (!wanted.has(section.dataset.slide)) section.remove();
    }

    document.querySelectorAll('.slide-figure .fig-number').forEach((el, index) => { el.textContent = index + 1; });

    return buildDeck(mode).map((slide) => ({
        ...slide,
        element: document.getElementById(`slide-${slide.id}`),
        title: browser.i18n.getMessage(`welcomeStep_${slide.id}`) || slide.id,
    }));
}

/**
 * The strictness figure: one sample headline for each level. A headline never changes; the box around it says
 * whether Klikkikuri rewrites it at the slider's level.
 */
function followStrictness() {
    const { getMessage } = browser.i18n;
    for (const level of SAMPLE_LEVELS) {
        const sample = document.querySelector(`.sample[data-level="${level}"]`);
        sample.querySelector('.sample-level').textContent = getClickbaitLevelInfo(level).title;
        sample.querySelector('.sample-text').textContent = getMessage(`welcomeSample${level}`);
    }

    // The two ends of the slider as presets. Level 1 is "fix more", not 0: level 0 also rewrites headlines that
    // carry no clickbait, which the slider warns about.
    const presets = document.querySelectorAll('.range-end');
    presets.forEach((button) => {
        button.addEventListener('click', () => controller.setClickbaitLevel(Number(button.dataset.level)));
    });

    onConfigValue((config) => config.clickbaitLevel ?? DEFAULT_LEVEL, (slider) => {
        presets.forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.level) === slider)));

        for (const level of SAMPLE_LEVELS) {
            // The same rule that the content script uses to decide whether a headline is rewritten.
            const rewritten = new Clickbaitiness(level).meetsThreshold(slider);

            const sample = document.querySelector(`.sample[data-level="${level}"]`);
            sample.dataset.state = rewritten ? 'rewritten' : 'kept';
            sample.querySelector('.sample-status').textContent = getMessage(
                rewritten ? 'welcomeStatusRewritten' : 'welcomeStatusKept'
            ) || (rewritten ? 'Rewritten' : 'Left as it is');
        }
    });
}

/** The marks figure shows a mark in its slot when the matching switch is on. */
function followMarkers() {
    onConfigValue((config) => JSON.stringify(config.modifiers ?? {}), (json) => {
        const modifiers = JSON.parse(json);
        for (const slot of document.querySelectorAll('.slot')) {
            const on = Boolean(modifiers[slot.dataset.marker]);
            slot.classList.toggle('on', on);
            slot.classList.toggle('off', !on);
        }
    });
}

/**
 * Leave the wizard: the setup counts as done, and this tab closes. The flag is written before the tab goes,
 * so a closed tab cannot lose it.
 */
async function finish() {
    await markWizardDone();
    const tab = await browser.tabs.getCurrent();
    if (tab) await browser.tabs.remove(tab.id);
}

/** Open a news site in a new tab and keep the wizard where it is. The flag is written first. */
async function openNewsSite(url) {
    await markWizardDone();
    await browser.tabs.create({ url, active: true });
}

document.addEventListener('DOMContentLoaded', () => {
    const mode = modeOf(location.search);
    document.documentElement.dataset.mode = mode;
    document.documentElement.dataset.browser = browserKind();
    localizeDocument();

    const slides = buildSlides(mode);
    const indicator = document.getElementById('steps');
    const back = document.getElementById('back');
    const next = document.getElementById('next');
    const last = slides.length - 1;
    let settleTimer = 0;

    const deck = createNavigator({ count: slides.length, onChange: render });

    function render(index) {
        indicator.update(slides, index);
        back.hidden = index === 0;
        const finishing = index === last;
        next.textContent = browser.i18n.getMessage(finishing ? 'welcomeFinish' : 'welcomeNext') || (finishing ? 'Finish' : 'Next');
    }

    /** A move that the user asked for: set the index, scroll to the slide, and hand focus to its heading. */
    function go(target) {
        const index = deck.request(target);
        const slide = slides[index].element;
        slide.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
        slide.querySelector('.slide-heading').focus({ preventScroll: true });

        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => deck.settled(), SCROLL_SETTLE_MS);
    }

    // The scroll position leads when the user scrolls by hand, and it asks the navigator to follow.
    let frame = 0;
    addEventListener('scroll', () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            deck.scrolled(slideAtLine(slides.map(({ element }) => element.getBoundingClientRect()), innerHeight / 2));
        });
    }, { passive: true });
    addEventListener('scrollend', () => {
        clearTimeout(settleTimer);
        deck.settled();
    });

    back.addEventListener('click', () => go(deck.index - 1));
    next.addEventListener('click', () => (deck.index === last ? finish() : go(deck.index + 1)));
    indicator.addEventListener('step-select', (event) => go(event.detail));
    document.getElementById('skip').addEventListener('click', finish);
    document.getElementById('all-settings').addEventListener('click', () => browser.runtime.openOptionsPage());
    document.querySelectorAll('.news-button').forEach((button) => {
        button.addEventListener('click', () => openNewsSite(button.dataset.url));
    });

    // Arrow keys move through the deck. Only when nothing has the focus, so a slider or a button keeps its own keys.
    document.addEventListener('keydown', (event) => {
        if (event.target !== document.body) return;
        if (event.key === 'ArrowRight') go(deck.index + 1);
        if (event.key === 'ArrowLeft') go(deck.index - 1);
    });

    reserveBarSpace();
    followStrictness();
    followMarkers();
    render(0);
});
