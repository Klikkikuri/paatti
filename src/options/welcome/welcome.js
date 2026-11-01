import browser from '../../browser-api.js';
import { getConfig, onConfigValue } from '../../config.js';
import { Clickbaitiness, model } from '../../model.js';
import { controller } from '../../controller.js';
import { localizeDocument, getClickbaitLevelInfo, isSiteEnabled } from '../utils.js';
import { markWizardDone } from '../../welcome-state.js';
import {
    SLIDES, clampIndex, createNavigator, flowIds, fragmentOf, indexOfFragment, modeOf, nextInFlow,
    previousInFlow, slideAtLine, slideIds,
} from './deck.js';
import '../components/clickbait-level-horizontal.js';
import '../components/title-modifier-setting.js';
import '../components/site-list-setting.js';
import '../components/paid-invitation-setting.js';
import '../components/favicon-img.js';
import './step-indicator.js';

/** Level of each sample headline in the strictness figure: all five of the slider. */
const SAMPLE_LEVELS = [0, 1, 2, 3, 4];
const DEFAULT_LEVEL = 2;

/** How many enabled sites the last slide offers. */
const NEWS_SITE_LIMIT = 3;

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

/** Put a copy of the how-it-works drawing into each figure that shows it, named by the figure's own caption. */
function drawHowFigures() {
    const drawing = document.getElementById('how-drawing');
    for (const figure of document.querySelectorAll('.how-figure')) {
        const svg = drawing.content.firstElementChild.cloneNode(true);
        svg.setAttribute('aria-labelledby', figure.querySelector('figcaption').id);
        figure.prepend(svg);
    }
}

/** Give every rewritten box of a drawing its tick, so the markup only says "rewritten". */
function drawRewriteTicks() {
    for (const box of document.querySelectorAll('.wf rect.box.on')) {
        const right = Number(box.getAttribute('x')) + Number(box.getAttribute('width')) - 10;
        const height = Number(box.getAttribute('height'));
        const middle = Number(box.getAttribute('y')) + Math.min(height / 2, 12);
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tick.setAttribute('class', 'tick');
        tick.setAttribute('d', `M${right - 5} ${middle} L${right - 2} ${middle + 3} L${right + 4} ${middle - 4}`);
        box.parentNode.append(tick);

        // A line of the box that runs into the tick stops short of it.
        const top = Number(box.getAttribute('y'));
        for (const line of box.parentNode.querySelectorAll('line.tl')) {
            const y = Number(line.getAttribute('y1'));
            const inside = y >= top && y <= top + height && Number(line.getAttribute('x1')) >= Number(box.getAttribute('x'))
                && Number(line.getAttribute('x1')) < right;
            if (inside && Number(line.getAttribute('x2')) > right - 9) line.setAttribute('x2', right - 9);
        }
    }
}

/**
 * The info dot of a folded block is as tall as its title: one line or two. Only the layout knows how many lines
 * the title wraps to, so it is measured, and measured again when the width changes.
 */
function fitInfoDots() {
    const observer = new ResizeObserver((entries) => {
        for (const { target } of entries) {
            const lines = Math.round(target.offsetHeight / parseFloat(getComputedStyle(target).lineHeight));
            target.closest('summary').dataset.lines = String(Math.min(Math.max(lines, 1), 2));
        }
    });
    document.querySelectorAll('.more-title').forEach((title) => observer.observe(title));
}

/**
 * The deck: one entry for each slide of `SLIDES`, with its section and its title, and a number for each figure.
 *
 * The order comes from `SLIDES`, not from the document, so that the deck cannot disagree with the flow or with
 * the fragment of a slide. The figure numbers follow the document, and are the same in both modes.
 *
 * @returns {Array<{id: string, tourOnly: boolean, title: string, element: Element}>}
 */
function buildDeck() {
    document.querySelectorAll('.slide-figure .fig-number').forEach((el, index) => { el.textContent = String(index + 1); });

    return SLIDES.map((slide) => {
        const element = document.getElementById(`slide-${slide.id}`);
        if (!element) throw new Error(`The wizard has no section for the slide "${slide.id}".`);

        return { ...slide, element, title: browser.i18n.getMessage(`welcomeStep_${slide.id}`) || slide.id };
    });
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

/** The site that a tab of this URL is on, or null. */
async function siteDomainOf(url) {
    try {
        return await model.read.getMatchingSiteDomain(new URL(url).hostname);
    } catch {
        return null;
    }
}

/** At most NEWS_SITE_LIMIT sites that this browser can run, those with an open tab first. */
async function offerSites(config) {
    const domains = [];
    for (const domain of Object.keys(config.siteConfigs || {})) {
        if (await isSiteEnabled(domain, config)) domains.push(domain);
    }
    if (domains.length === 0) return [];

    const openDomains = new Set();
    for (const tab of await browser.tabs.query({})) {
        const domain = await siteDomainOf(tab.url);
        if (domain) openDomains.add(domain);
    }

    const rank = (domain) => (openDomains.has(domain) ? 0 : 1);
    return domains.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, NEWS_SITE_LIMIT);
}

/** One site as a list item with an external link. The arrow is part of the label, as on every detail link. */
function siteItem(domain) {
    const icon = document.createElement('favicon-img');
    icon.setAttribute('domain', domain);
    icon.setAttribute('size', '16');

    const link = document.createElement('a');
    link.className = 'detail-button news-button';
    link.href = `https://${domain}/`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(icon, `${domain} ↗`);

    const item = document.createElement('li');
    item.appendChild(link);
    return item;
}

/** Fill the last slide with the sites that work here, most relevant first. */
function followNewsSites() {
    const container = document.querySelector('.news-buttons');
    const open = document.getElementById('news-sites-open');
    const empty = document.getElementById('news-sites-empty');
    let generation = 0;

    const render = async () => {
        const current = ++generation;
        try {
            const domains = await offerSites(await getConfig());
            if (current !== generation) return;

            const hasSites = domains.length > 0;
            container.replaceChildren(...domains.map(siteItem));
            container.hidden = !hasSites;
            open.hidden = !hasSites;
            empty.hidden = hasSites;
        } catch (err) {
            console.error('Failed to list the sites that the setup offers:', err);
        }
    };
    const refresh = () => { render(); };

    onConfigValue((config) => JSON.stringify(Object.entries(config.siteConfigs ?? {})
        .map(([domain, site]) => [domain, site.enabled])), render);
    // A site that the sites slide turns on asks for permission. The answer changes which sites work here and no
    // config value, so the config subscription above does not fire again.
    browser.permissions.onAdded.addListener(refresh);
    browser.permissions.onRemoved.addListener(refresh);
}

document.addEventListener('DOMContentLoaded', () => {
    const mode = modeOf(location.search);
    // The page owns the scroll position, so the browser must not restore a second one of its own.
    history.scrollRestoration = 'manual';
    document.documentElement.dataset.mode = mode;
    document.documentElement.dataset.browser = browserKind();
    drawHowFigures();
    drawRewriteTicks();
    localizeDocument();

    const deck = buildDeck();
    const ids = slideIds();
    const flow = flowIds(mode).map((id) => deck.findIndex((slide) => slide.id === id));
    const indicator = document.getElementById('steps');
    const back = document.getElementById('back');
    const next = document.getElementById('next');
    let settleTimer = 0;

    const start = indexOfFragment(ids, location.hash);
    const cursor = createNavigator({ count: deck.length, initial: start >= 0 ? start : 0, onChange: render });

    /** Show one slide in the address, in the buttons and in the indicator. Runs when the index changes. */
    function render(index) {
        writeAddress(index);

        const nextIndex = nextInFlow(flow, index);
        back.hidden = previousInFlow(flow, index) === null;
        next.textContent = browser.i18n.getMessage(nextIndex === null ? 'welcomeFinish' : 'welcomeNext')
            || (nextIndex === null ? 'Finish' : 'Next');
        indicator.update({ deck, flow, current: index });
    }

    /** Make the address name the slide that the page shows. Nothing to do when it already does. */
    function writeAddress(index) {
        const fragment = fragmentOf(ids, index);
        if (location.hash !== fragment) history.replaceState(null, '', fragment);
    }

    /** Put one slide at the top of the viewport. Changes neither the index, the address nor the focus. */
    function align(index, animate) {
        deck[index].element.scrollIntoView({ behavior: animate ? 'smooth' : 'auto', block: 'start' });
    }

    /** Start the lock's fallback timer. A `scrollend` ends the lock sooner. */
    function settle() {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => cursor.settled(), SCROLL_SETTLE_MS);
    }

    /**
     * Show one slide.
     *
     * A move that the code starts pushes a history entry; a scroll of the page does not. A move to the slide
     * that is already current scrolls but does not push and does not lock, so a segment click on the current
     * slide adds nothing to the history and blocks nothing.
     *
     * @param {number} index - A deck index. Out-of-range values stop at the ends.
     * @param {{animate: boolean, push: boolean, focus?: boolean}} options - `focus` defaults to true.
     */
    function moveTo(index, { animate, push, focus = true }) {
        const chosen = clampIndex(deck.length, index);

        if (chosen !== cursor.index) {
            if (push) history.pushState(null, '', fragmentOf(ids, chosen));
            cursor.request(chosen);
            settle();
        }

        align(chosen, animate);
        writeAddress(chosen);
        if (focus) deck[chosen].element.querySelector('.slide-heading').focus({ preventScroll: true });
    }

    /** Show the flow step that the reader asked for. A call with no step, at an end of the flow, does nothing. */
    const go = (target) => {
        if (target !== null) moveTo(target, { animate: !reducedMotion(), push: true });
    };

    // The browser scrolls to the fragment itself, and it scrolls again after `load`, when the figures and the
    // bars have their real heights. Neither position is a slide that the reader chose, so the page follows the
    // scroll position only from the reader's own input, or from the frame after the page has loaded.
    let followsScroll = false;
    const follow = () => { followsScroll = true; };
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
        addEventListener(type, follow, { capture: true, passive: true, once: true });
    }
    addEventListener('load', () => {
        if (!followsScroll) align(cursor.index, false);
        requestAnimationFrame(follow);
    }, { once: true });

    // The scroll position leads when the reader scrolls by hand, and it asks the navigator to follow.
    let frame = 0;
    addEventListener('scroll', () => {
        if (!followsScroll) return;

        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            cursor.scrolled(slideAtLine(deck.map(({ element }) => element.getBoundingClientRect()), innerHeight / 2));
        });
    }, { passive: true });
    addEventListener('scrollend', () => {
        clearTimeout(settleTimer);
        cursor.settled();
    });

    // Every entry of this page differs from its neighbour only in the fragment, so a Back, a Forward and a
    // hand-edited address all arrive here. The page's own writes fire no event, so there is no loop.
    addEventListener('hashchange', () => {
        const index = indexOfFragment(ids, location.hash);
        moveTo(index >= 0 ? index : 0, { animate: false, push: false });
    });

    back.addEventListener('click', () => go(previousInFlow(flow, cursor.index)));
    next.addEventListener('click', () => {
        const target = nextInFlow(flow, cursor.index);
        if (target === null) finish();
        else go(target);
    });
    indicator.addEventListener('step-select', (event) => go(event.detail));
    document.getElementById('skip').addEventListener('click', finish);
    document.getElementById('all-settings').addEventListener('click', () => browser.runtime.openOptionsPage());
    document.querySelector('.news-buttons').addEventListener('click', (event) => {
        const link = event.target.closest('.news-button');
        if (!link) return;
        event.preventDefault();
        openNewsSite(link.href);
    });

    // Arrow keys move through the flow. A move hands the focus to a heading, so the target is not the body: only
    // a control that uses the arrows itself (a slider, a field, a link, a folded block) keeps them.
    document.addEventListener('keydown', (event) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.target.closest('input, select, textarea, button, a, summary, [contenteditable]')) return;
        if (event.key === 'ArrowRight') go(nextInFlow(flow, cursor.index));
        if (event.key === 'ArrowLeft') go(previousInFlow(flow, cursor.index));
    });

    followNewsSites();
    reserveBarSpace();
    fitInfoDots();
    followStrictness();
    followMarkers();

    // Last: the bars and the figures set the heights that the start slide lands against. The index is already
    // right, so this only draws and scrolls; it does not lock, and a reader who scrolls at once is not ignored.
    render(cursor.index);
    align(cursor.index, false);
});
