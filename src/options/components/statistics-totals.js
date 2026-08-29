"use strict";

import browser from '../../browser-api.js';
import { getLogger } from '../../utils.js';
import { model, Clickbaitiness } from '../../model.js';
import { getConfig } from '../../config.js';
import { summarizeLevels, summarizeSites } from '../../stats.js';
import { levelToI18nKey, localizeDocument } from '../utils.js';
import { adoptComponentStyleSheet, ComponentBase, defineComponent } from './component-utils.js';
import './favicon-img.js';

adoptComponentStyleSheet(new URL('./statistics-totals.css', import.meta.url));

const log = getLogger('components/statistics-totals');

const template = document.createElement('template');
template.innerHTML = `
    <div class="totals-body">
        <div class="totals-award raised hidden">
            <span class="totals-award-trophy" aria-hidden="true">🏆</span>
            <div class="totals-award-text">
                <p class="totals-award-title" data-i18n="statsTotalsAwardTitle"></p>
                <p class="totals-award-site">
                    <favicon-img class="totals-award-icon" size="24"></favicon-img>
                    <span class="totals-award-domain"></span>
                    <span class="totals-award-reading"></span>
                </p>
            </div>
        </div>

        <div class="totals-sites">
            <div class="totals-hero">
                <div class="totals-hero-labels">
                    <p class="totals-hero-label" data-i18n="statsTotalsHeadlineLabel"></p>
                    <p class="totals-since hidden"></p>
                </div>
                <div class="totals-meter">
                    <div class="totals-meter-scale" aria-hidden="true">
                        <span class="totals-meter-marker"></span>
                    </div>
                    <p class="totals-meter-caption"></p>
                </div>
                <p class="totals-count">
                    <span class="totals-number">—</span>
                    <span class="totals-of hidden"></span>
                </p>
            </div>

            <div class="totals-sites-head">
                <span data-i18n="statsTotalsPerSiteTitle"></span>
                <span data-i18n="statsviewGroupedByClickbaitinessLabelClickbaitiness"></span>
                <span data-i18n="statsviewGroupedByClickbaitinessLabelAmount"></span>
            </div>
            <ul class="totals-site-list"></ul>
        </div>
    </div>

    <p class="totals-empty hidden" data-i18n="statsTotalsEmpty"></p>
`;

/**
 * Custom element for the options page statistics section: what the extension has done across
 * every site, rather than on the one in front of you.
 *
 * The popup's Stats view already answers the per-site question. This one states the running total,
 * marks how clickbaity the whole of what you were served reads, hands out the clickbaitiest-site
 * award, and lists the sites behind the total.
 *
 * The headline is `_global.totalConversions`, which is accumulated beside the per-domain records
 * rather than from them and reaches further back than they do. The per-site rows are therefore a
 * breakdown of the same activity, not addends of the number above them -- see stats.js.
 *
 * A row opens onto the level breakdown behind its tally, which is what the popup's Stats view draws
 * for the one domain in front of you. Any number of rows may be open at once: the popup closes the
 * others because it has no room, and this page has.
 */
class StatisticsTotals extends ComponentBase {
    /** Bumped per refresh, so an earlier read that resolves late cannot win. */
    #generation = 0;

    /** The configured sites, for naming a domain. Read with the statistics it labels. */
    #siteConfigs = {};

    /**
     * Domains whose breakdown is open. Held here rather than in the DOM: every write to
     * `statistics` replaces every row. Keyed by domain rather than by position, because those
     * rows are sorted by tally and a growing one reorders them.
     */
    #expanded = new Set();

    onConnect() {
        this.replaceChildren(template.content.cloneNode(true));
        localizeDocument(this);

        this.refresh();

        // Statistics are outside the merged config, so this is a raw listener rather than
        // onConfigValue. Filtered to the one key: every conversion batch writes it, and the
        // rest of local storage must not drag this section through a re-render.
        const onStorageChanged = (changes, areaName) => {
            if (areaName !== 'local' || !('statistics' in changes)) return;
            this.refresh();
        };
        browser.storage.onChanged.addListener(onStorageChanged);
        this.addTeardown(() => browser.storage.onChanged.removeListener(onStorageChanged));

        // Delegated because the rows themselves are replaced on every one of those writes: a
        // listener per row would leave one registration per render on the connection signal.
        this.querySelector('.totals-site-list').addEventListener('click', (event) => {
            const toggle = event.target.closest('.totals-site-toggle');
            if (toggle) this.toggleLevels(toggle.closest('.totals-site'));
        }, { signal: this.signal });
    }

    /** Read the stored statistics and redraw from them. */
    refresh() {
        const generation = ++this.#generation;

        Promise.all([model.read.getAllStatistics(), getConfig()])
            .then(([statistics, config]) => {
                // A later refresh has overtaken this one, or the element has left the page.
                if (generation !== this.#generation || !this.isConnected) return;

                this.#siteConfigs = config.siteConfigs || {};
                this.render(summarizeSites(statistics));
            })
            .catch((error) => log('Could not read the statistics:', error));
    }

    /**
     * @param {{ sites: Array, maxFound: number, clickbaitiest: Object|null, overall: Object|null,
     *   totals: Object }} summary
     */
    render({ sites, maxFound, clickbaitiest, overall, totals, since }) {
        const hasData = sites.length > 0;
        this.querySelector('.totals-body').classList.toggle('hidden', !hasData);
        this.querySelector('.totals-empty').classList.toggle('hidden', hasData);
        if (!hasData) return;

        this.querySelector('.totals-number').textContent = totals.rewritten.toLocaleString();
        this.renderShare(this.querySelector('.totals-of'), totals);
        this.renderSince(since);
        this.renderMeter(overall);
        this.renderAward(clickbaitiest);

        // A domain that has left the list can no longer be opened, so it has no business being
        // remembered as open either.
        const listed = new Set(sites.map((site) => site.domain));
        for (const domain of this.#expanded) {
            if (!listed.has(domain)) this.#expanded.delete(domain);
        }

        const list = this.querySelector('.totals-site-list');
        list.replaceChildren(...sites.map((site, index) => this.createSiteRow(site, maxFound, index)));
        this.querySelector('.totals-sites').classList.toggle('hidden', sites.length === 0);
    }

    /**
     * How a domain is named here: the configured name, or the domain itself where there is none.
     * The same fallback the site list uses.
     *
     * @param {string} domain
     * @returns {string}
     */
    siteName(domain) {
        return this.#siteConfigs[domain]?.name || domain;
    }

    /**
     * Say when the earliest record started, so the tally above carries a period.
     *
     * @param {number|null} since - Epoch ms, or null where no record records a start.
     */
    renderSince(since) {
        const element = this.querySelector('.totals-since');

        element.textContent = since === null
            ? ''
            : browser.i18n.getMessage('statsTotalsSince', [new Date(since).toLocaleDateString()]);
        element.classList.toggle('hidden', since === null);
    }

    /**
     * State a rewritten tally as a share of the found one, where the two can carry an "of" between
     * them at all. Where they cannot, the element is emptied rather than made to show a share
     * above 100 %, which is the guard the popup's headline uses.
     *
     * @param {HTMLElement} element - Where the share goes.
     * @param {{ rewritten: number, found: number, rewrittenIsShare: boolean }} tally
     */
    renderShare(element, { rewritten, found, rewrittenIsShare }) {
        element.textContent = rewrittenIsShare
            ? browser.i18n.getMessage('statsviewConvertedOfFound',
                [found.toLocaleString(), String(Math.round((rewritten / found) * 100))])
            : '';
        element.classList.toggle('hidden', !rewrittenIsShare);
    }

    /**
     * Mark how clickbaity everything found across every site reads.
     *
     * The scale is fixed and the marker moves along it, because this is a reading rather than an
     * accumulation: the question is where you sit between calm and egregious, not how far along
     * you have got.
     *
     * @param {Object|null} overall - The pooled reading, absent until something has been found.
     */
    renderMeter(overall) {
        const meter = this.querySelector('.totals-meter');
        meter.classList.toggle('hidden', overall === null);
        if (!overall) return;

        this.querySelector('.totals-meter-marker').style.left = `${overall.percentage}%`;
        this.querySelector('.totals-meter-caption').textContent = this.readingText(overall);
    }

    /**
     * One phrasing for a gauge reading, worn by both the meter and the award.
     *
     * @param {{ percentage: number, labelI18nKey: string }} reading
     * @returns {string}
     */
    readingText({ percentage, labelI18nKey }) {
        return browser.i18n.getMessage('statsTotalsReading',
            [String(percentage), browser.i18n.getMessage(labelI18nKey)]);
    }

    /**
     * Show the clickbaitiest site, or hide the award when there is no contest.
     *
     * @param {Object|null} clickbaitiest
     */
    renderAward(clickbaitiest) {
        const award = this.querySelector('.totals-award');
        award.classList.toggle('hidden', clickbaitiest === null);
        if (!clickbaitiest) return;

        this.querySelector('.totals-award-icon').setAttribute('domain', clickbaitiest.domain);
        this.querySelector('.totals-award-domain').textContent = this.siteName(clickbaitiest.domain);
        this.querySelector('.totals-award-reading').textContent = this.readingText(clickbaitiest);
    }

    /**
     * Build one site row: who it is, how clickbaity it reads, and how much was found there.
     *
     * The bar's length is this site against the busiest one, and the segment inside it is the
     * rewritten share of what was found -- the nested-bar idiom the popup's level rows use.
     * Where the two tallies cannot be drawn one inside the other, the bar states magnitude alone
     * and the amount drops the "of", as the popup's rows do.
     *
     * The name cell doubles as the disclosure control for the level breakdown, unless the record
     * found nothing to break down: a control that reveals nothing should not be there to press.
     *
     * @param {Object} site - One entry from summarizeSites.
     * @param {number} maxFound - Titles found on the busiest site.
     * @param {number} index - The row's place in the list, which names its panel.
     * @returns {HTMLLIElement}
     */
    createSiteRow(site, maxFound, index) {
        const row = document.createElement('li');
        row.className = 'totals-site';
        row.dataset.severity = String(site.severity);
        row.dataset.domain = site.domain;

        const isOpen = this.#expanded.has(site.domain);
        const panelId = `totals-levels-${index}`;

        // The name goes in last either way, so `.totals-site-name span:last-child` stays the name
        // itself; the chevron is drawn by the stylesheet rather than added here.
        const name = document.createElement(site.found > 0 ? 'button' : 'span');
        name.className = 'totals-site-name';
        if (site.found > 0) {
            name.type = 'button';
            name.classList.add('totals-site-toggle');
            name.setAttribute('aria-expanded', String(isOpen));
            name.setAttribute('aria-controls', panelId);
            name.setAttribute('aria-label', browser.i18n.getMessage(
                'statsTotalsSiteLevelsAriaLabel', [this.siteName(site.domain)]));
        }
        const icon = document.createElement('favicon-img');
        icon.setAttribute('domain', site.domain);
        icon.setAttribute('size', '16');
        const domain = document.createElement('span');
        domain.textContent = this.siteName(site.domain);
        name.append(icon, domain);

        const reading = document.createElement('span');
        reading.className = 'totals-site-reading';

        const bar = document.createElement('span');
        bar.className = 'totals-site-bar';
        const fill = document.createElement('span');
        fill.className = 'totals-site-bar-fill';
        fill.style.width = maxFound > 0 ? `${(site.found / maxFound) * 100}%` : '0%';
        if (site.rewrittenIsShare) {
            const rewritten = document.createElement('span');
            rewritten.className = 'totals-site-bar-rewritten';
            rewritten.style.width = `${(site.rewritten / site.found) * 100}%`;
            fill.appendChild(rewritten);
        } else {
            fill.classList.add('is-plain');
        }
        bar.appendChild(fill);

        const label = document.createElement('span');
        label.className = 'totals-site-level';
        label.textContent = browser.i18n.getMessage(site.labelI18nKey);
        reading.append(bar, label);

        // Two elements rather than one string, so only the found tally is muted -- with a real
        // space between them, which a CSS gap would not put into the text itself.
        const amount = document.createElement('span');
        amount.className = 'totals-site-amount';
        const count = document.createElement('span');
        count.textContent = (site.rewrittenIsShare ? site.rewritten : site.found).toLocaleString();
        amount.appendChild(count);

        if (site.rewrittenIsShare) {
            const of = document.createElement('span');
            of.className = 'totals-site-of';
            of.textContent = browser.i18n.getMessage('statsTotalsOfFound', [site.found.toLocaleString()]);
            amount.append(' ', of);
        }

        row.append(name, reading, amount);
        if (site.found > 0) {
            row.appendChild(this.createLevelPanel(site, panelId, isOpen));
        }

        return row;
    }

    /**
     * The levels behind a site's tally, drawn the way the popup's Stats view draws them for one
     * domain. Filled whether or not it is open: this is at most five rows, and deferring them
     * would mean parking the site's data somewhere to build them from later.
     *
     * @param {Object} site - One entry from summarizeSites.
     * @param {string} id - What the row's control points its aria-controls at.
     * @param {boolean} isOpen
     * @returns {HTMLDivElement}
     */
    createLevelPanel(site, id, isOpen) {
        const { shown, maxCount } = summarizeLevels(
            site.foundByLevel, site.rewrittenByLevel, Clickbaitiness.LEVELS);

        const panel = document.createElement('div');
        panel.className = 'totals-site-levels';
        panel.id = id;
        panel.classList.toggle('hidden', !isOpen);

        // The row's own amount states the rewritten tally, so the counts below it need saying what
        // they count. The popup's breakdown carries the same caption over the same numbers.
        const caption = document.createElement('p');
        caption.className = 'totals-levels-caption';
        caption.textContent = browser.i18n.getMessage('statsviewBreakdownCaption');

        const list = document.createElement('ul');
        list.className = 'totals-level-list';
        list.append(...shown.map((entry) =>
            this.createLevelRow(entry, maxCount, site.rewrittenByLevelIsKnown)));

        panel.append(caption, list);
        return panel;
    }

    /**
     * One level of a site's breakdown, on the same columns the site rows sit on.
     *
     * The bar is this level against the busiest level of the same site, as the popup's rows are
     * against theirs -- a share of the site's total would say nothing once one level dominates.
     *
     * @param {Object} entry - One entry from summarizeLevels.
     * @param {number} maxCount - Titles found at the site's busiest level.
     * @param {boolean} rewrittenIsKnown - Whether the rewritten counts cover the same history.
     * @returns {HTMLLIElement}
     */
    createLevelRow({ level, index, count, rewritten }, maxCount, rewrittenIsKnown) {
        const row = document.createElement('li');
        row.className = 'totals-level';
        row.dataset.severity = String(index);

        const name = document.createElement('span');
        name.className = 'totals-level-name';
        name.textContent = browser.i18n.getMessage(levelToI18nKey(level));

        const barCell = document.createElement('span');
        barCell.className = 'totals-level-bar';
        const bar = document.createElement('span');
        bar.className = 'totals-site-bar';
        const fill = document.createElement('span');
        fill.className = 'totals-site-bar-fill';
        fill.style.width = maxCount > 0 ? `${(count / maxCount) * 100}%` : '0%';

        // A record that started counting the rewritten titles per level later than the rest
        // describes less history in them, so its bars state magnitude alone -- the guard the
        // popup's own level rows apply.
        if (rewrittenIsKnown) {
            const rewrittenEl = document.createElement('span');
            rewrittenEl.className = 'totals-site-bar-rewritten';
            rewrittenEl.style.width = count > 0 ? `${(rewritten / count) * 100}%` : '0%';
            fill.appendChild(rewrittenEl);
            row.setAttribute('title', browser.i18n.getMessage(
                'statsviewRowRewritten', [String(rewritten), String(count)]));
        } else {
            fill.classList.add('is-plain');
        }

        bar.appendChild(fill);
        barCell.appendChild(bar);

        const amount = document.createElement('span');
        amount.className = 'totals-level-amount';
        amount.textContent = count.toLocaleString();

        row.append(name, barCell, amount);
        return row;
    }

    /**
     * Open or close one site's breakdown.
     *
     * @param {HTMLLIElement} row - The site row the pressed control belongs to.
     */
    toggleLevels(row) {
        const domain = row.dataset.domain;
        const open = !this.#expanded.has(domain);

        if (open) {
            this.#expanded.add(domain);
        } else {
            this.#expanded.delete(domain);
        }

        row.querySelector('.totals-site-toggle').setAttribute('aria-expanded', String(open));
        row.querySelector('.totals-site-levels').classList.toggle('hidden', !open);
    }
}

defineComponent('statistics-totals', StatisticsTotals);

export { StatisticsTotals };
