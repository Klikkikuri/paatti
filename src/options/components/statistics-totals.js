"use strict";

import browser from '../../browser-api.js';
import { getLogger } from '../../utils.js';
import { model, Clickbaitiness } from '../../model.js';
import { getConfig } from '../../config.js';
import { computeCollectingPeriod, sharePercent, summarizeLevels, summarizeSites } from '../../stats.js';
import { levelToI18nKey, localizeDocument } from '../utils.js';
import { adoptComponentStyleSheet, ComponentBase, defineComponent } from './component-utils.js';
import './favicon-img.js';

adoptComponentStyleSheet(new URL('./statistics-totals.css', import.meta.url));

const log = getLogger('components/statistics-totals');

const template = document.createElement('template');
template.innerHTML = `
    <div class="totals-body">
        <div class="totals-summary">
            <div class="totals-tile totals-headline">
                <p class="totals-tile-label" data-i18n="statsTotalsHeadlineLabel"></p>
                <p class="totals-number">—</p>
                <p class="totals-of totals-tile-note hidden"></p>
            </div>

            <div class="totals-tile totals-period hidden">
                <p class="totals-period-value"></p>
                <p class="totals-since totals-tile-note"></p>
            </div>

            <div class="totals-tile totals-award hidden">
                <p class="totals-tile-label">
                    <span class="totals-award-trophy" aria-hidden="true">🏆</span>
                    <span data-i18n="statsTotalsAwardTitle"></span>
                </p>
                <p class="totals-award-site">
                    <favicon-img class="totals-award-icon" size="20"></favicon-img>
                    <span class="totals-award-domain"></span>
                </p>
                <span class="totals-award-reading"></span>
            </div>
        </div>

        <div class="totals-tile totals-mix hidden">
            <p class="totals-tile-label" data-i18n="statsTotalsMixLabel"></p>
            <div class="totals-mix-bar" aria-hidden="true"></div>
            <ul class="totals-mix-legend"></ul>
        </div>

        <details class="totals-about">
            <summary>
                <span class="totals-about-icon" aria-hidden="true">i</span>
                <span data-i18n="statsTotalsAboutSummary"></span>
            </summary>
            <p data-i18n="statsTotalsAboutReading"></p>
            <p data-i18n="statsTotalsAboutAmounts"></p>
        </details>

        <div class="totals-table">
            <div class="totals-sites-head">
                <span data-i18n="statsTotalsPerSiteTitle"></span>
                <span data-i18n="statsTotalsColumnReading"></span>
                <span aria-hidden="true"></span>
                <span data-i18n="statsTotalsColumnConverted"></span>
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
 * shows how what you were served split across the levels, hands out the clickbaitiest-site award,
 * and lists the sites behind the total.
 *
 * The headline pools the rows rather than reading `_global.totalConversions`, which is accumulated
 * beside the per-domain records and reaches further back than they do -- see stats.js.
 *
 * Every tally is drawn under a heading that names it: the bar in the converted column is that
 * tally as a share of the found one, and the level a row reads at is a chip beside its name. A row opens onto the levels behind its tally, which is
 * what the popup's Stats view draws for the one domain in front of you. Any number of rows may be
 * open at once: the popup closes the others because it has no room, and this page has.
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
     * @param {{ sites: Array, clickbaitiest: Object|null, overallByLevel: Object,
     *   totals: Object, since: number|null }} summary
     */
    render({ sites, clickbaitiest, overallByLevel, totals, since }) {
        const hasData = sites.length > 0;
        this.querySelector('.totals-body').classList.toggle('hidden', !hasData);
        this.querySelector('.totals-empty').classList.toggle('hidden', hasData);
        if (!hasData) return;

        this.renderTotalTile(totals);
        this.renderPeriodTile(since);
        this.renderAward(clickbaitiest);
        this.renderMix(overallByLevel);

        // A domain that has left the list can no longer be opened, so it has no business being
        // remembered as open either.
        const listed = new Set(sites.map((site) => site.domain));
        for (const domain of this.#expanded) {
            if (!listed.has(domain)) this.#expanded.delete(domain);
        }

        const list = this.querySelector('.totals-site-list');
        list.replaceChildren(...sites.map((site, index) => this.createSiteRow(site, index)));
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
     * The level something reads at, worn wherever a severity needs naming. Carries the colour on
     * the element itself, so one [data-severity] rule serves the chips, the bars and the mix.
     *
     * @param {number} severity - Level index, 0..4.
     * @param {string} text
     * @param {string} [title] - A fuller reading, where there is one to state on hover.
     * @returns {HTMLSpanElement}
     */
    createChip(severity, text, title) {
        const chip = document.createElement('span');
        chip.className = 'totals-chip';
        chip.dataset.severity = String(severity);
        chip.textContent = text;
        if (title) chip.setAttribute('title', title);
        return chip;
    }

    /**
     * A bar stating one tally against the largest of its kind. Widths are set here rather than in
     * the markup, which web-ext lint reads as an unsafe assignment.
     *
     * @param {number} count
     * @param {number} largest - The tally the bar is drawn full at.
     * @returns {HTMLSpanElement}
     */
    createBar(count, largest) {
        const bar = document.createElement('span');
        bar.className = 'totals-bar';
        const fill = document.createElement('span');
        fill.className = 'totals-bar-fill';
        fill.style.width = largest > 0 ? `${(count / largest) * 100}%` : '0%';
        bar.appendChild(fill);
        return bar;
    }

    /**
     * The converted share of what was found on a site, drawn the way the mix bar draws a level's
     * share: the track is the whole of the found tally, so the fill's length is the percentage
     * stated beside it rather than this row measured against another.
     *
     * A row with no share to state still gets the element, empty and untracked: it holds the
     * column the rows beside it draw in, and a track there would offer a scale that row has
     * nothing to put on.
     *
     * @param {number|null} share - Percent, or null where there is no share to state.
     * @returns {HTMLSpanElement}
     */
    createShareBar(share) {
        const bar = document.createElement('span');
        bar.className = share === null ? 'totals-share-bar is-unknown' : 'totals-share-bar';
        if (share === null) return bar;

        const fill = document.createElement('span');
        fill.className = 'totals-share-fill';
        fill.style.width = `${share}%`;
        bar.appendChild(fill);
        return bar;
    }

    /**
     * A tally and, where the two can be set against each other, what share of the found titles it
     * is. Right-aligned in its own column, so the numbers below one heading line up.
     *
     * The label repeats the column heading, for the narrow layout that drops the heading row.
     *
     * @param {string} className - Which column the cell sits in.
     * @param {string} labelKey - Message naming the column.
     * @param {number} count
     * @param {number|null} share - Percent, or null where there is no share to state.
     * @returns {HTMLSpanElement}
     */
    createAmount(className, labelKey, count, share) {
        const cell = document.createElement('span');
        cell.className = `totals-amount ${className}`;

        const label = document.createElement('span');
        label.className = 'totals-amount-label';
        label.textContent = browser.i18n.getMessage(labelKey);
        cell.appendChild(label);

        const value = document.createElement('span');
        value.className = 'totals-amount-value';
        value.textContent = count.toLocaleString();
        cell.appendChild(value);

        if (share !== null) {
            const note = document.createElement('span');
            note.className = 'totals-amount-note';
            note.textContent = browser.i18n.getMessage('statsTotalsSharePercent', [String(share)]);
            cell.appendChild(note);
        }

        return cell;
    }

    /**
     * The running total, and what share of everything found it is.
     *
     * @param {{ rewritten: number, found: number, sharePercent: number|null }} totals
     */
    renderTotalTile({ rewritten, found, sharePercent: share }) {
        this.querySelector('.totals-number').textContent = rewritten.toLocaleString();

        const of = this.querySelector('.totals-of');
        of.textContent = share === null
            ? ''
            : browser.i18n.getMessage('statsviewConvertedOfFound', [found.toLocaleString(), String(share)]);
        of.classList.toggle('hidden', share === null);
    }

    /**
     * How long the tally has been collecting, and the date it started. Rounded rather than exact:
     * the phrasing the popup's Stats view already uses for the one domain in front of you.
     *
     * @param {number|null} since - Epoch ms, or null where no record records a start.
     */
    renderPeriodTile(since) {
        const tile = this.querySelector('.totals-period');
        const period = computeCollectingPeriod(since);
        tile.classList.toggle('hidden', period === null);
        if (!period) return;

        this.querySelector('.totals-period-value').textContent =
            browser.i18n.getMessage(period.labelI18nKey, [String(period.count)]);
        this.querySelector('.totals-since').textContent =
            browser.i18n.getMessage('statsTotalsSince', [new Date(since).toLocaleDateString()]);
    }

    /**
     * One phrasing for a gauge reading, worn by the site chips and the award.
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
        this.querySelector('.totals-award-reading').replaceChildren(this.createChip(
            clickbaitiest.severity,
            browser.i18n.getMessage(clickbaitiest.labelI18nKey),
            this.readingText(clickbaitiest)));
    }

    /**
     * How everything found split across the levels, as one bar of the whole.
     *
     * A share of the whole rather than a reading of it: an average severity compresses the mix to
     * a single number that reads like a percentage of clickbait and is not one. The legend states
     * every value in words, so the bar itself carries nothing a reader needs.
     *
     * @param {Object} overallByLevel - Every domain's levels pooled together.
     */
    renderMix(overallByLevel) {
        const { shown, totalFound } = summarizeLevels(overallByLevel, {}, Clickbaitiness.LEVELS);

        this.querySelector('.totals-mix').classList.toggle('hidden', shown.length === 0);
        if (shown.length === 0) return;

        const segments = [];
        const legend = [];

        for (const { level, index, count } of shown) {
            const name = browser.i18n.getMessage(levelToI18nKey(level));
            const share = sharePercent(count, totalFound);

            // The segments tile to exactly 100 % off the raw fraction; only the label rounds.
            const segment = document.createElement('span');
            segment.className = 'totals-mix-segment';
            segment.dataset.severity = String(index);
            segment.style.width = `${(count / totalFound) * 100}%`;
            segment.setAttribute('title', browser.i18n.getMessage(
                'statsTotalsMixSegment', [name, count.toLocaleString(), String(share)]));
            segments.push(segment);

            const item = document.createElement('li');
            item.className = 'totals-mix-item';
            item.dataset.severity = String(index);

            const swatch = document.createElement('span');
            swatch.className = 'totals-mix-swatch';
            swatch.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'totals-mix-name';
            label.textContent = name;
            const value = document.createElement('span');
            value.className = 'totals-mix-share';
            value.textContent = browser.i18n.getMessage('statsTotalsSharePercent', [String(share)]);

            item.append(swatch, label, value);
            legend.push(item);
        }

        this.querySelector('.totals-mix-bar').replaceChildren(...segments);
        this.querySelector('.totals-mix-legend').replaceChildren(...legend);
    }

    /**
     * Build one site row: who it is, how it reads, how much was found there and how much of that
     * was converted.
     *
     * The bar before the converted tally is that tally as a share of the found one, its track the
     * whole of what was found the way the mix bar's track is. A row whose two tallies cannot be
     * set against each other states no share, and draws no track to state it on.
     *
     * The found tally has no column: it is the whole the bar and the percentage are already drawn
     * against, so the row states it on hover and opens onto it level by level.
     *
     * The name doubles as the disclosure control for the level breakdown, unless the record found
     * nothing to break down: a control that reveals nothing should not be there to press. The chip
     * takes a column of its own rather than following the name: both are as long as their text,
     * and sharing a cell left one of them to truncate or wrap whenever the other grew.
     *
     * @param {Object} site - One entry from summarizeSites.
     * @param {number} index - The row's place in the list, which names its panel.
     * @returns {HTMLLIElement}
     */
    createSiteRow(site, index) {
        const row = document.createElement('li');
        row.className = 'totals-site';
        row.dataset.severity = String(site.severity);
        row.dataset.domain = site.domain;

        const isOpen = this.#expanded.has(site.domain);
        const panelId = `totals-levels-${index}`;

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
        domain.className = 'totals-site-domain';
        domain.textContent = this.siteName(site.domain);
        name.append(icon, domain);

        // The found tally is what the share is a share of, so it is stated where the share is
        // rather than in a column of its own: a number the row does not otherwise use.
        const converted = this.createAmount('totals-site-converted', 'statsTotalsColumnConverted',
            site.rewritten, site.sharePercent);
        converted.setAttribute('title', site.sharePercent === null
            ? browser.i18n.getMessage('statsTotalsFoundTitle', [site.found.toLocaleString()])
            : browser.i18n.getMessage('statsTotalsShareOfFound',
                [String(site.sharePercent), site.found.toLocaleString()]));

        const main = document.createElement('div');
        main.className = 'totals-site-main';
        main.append(
            name,
            this.createChip(site.severity, browser.i18n.getMessage(site.labelI18nKey), this.readingText(site)),
            this.createShareBar(site.sharePercent),
            converted);

        row.appendChild(main);
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

        // The row's own amounts state the site, so the counts below it need saying what they
        // count. The popup's breakdown carries the same caption over the same numbers.
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
     * One level of a site's breakdown, on columns of its own.
     *
     * The bar is this level against the busiest level of the same site, as the popup's rows are
     * against theirs -- a share of the site's total would say nothing once one level dominates.
     * That is also why these columns do not line up with the site rows above them: the two bars
     * are drawn against different scales, and lining them up would invite reading across.
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

        const found = this.createAmount('totals-level-found', 'statsTotalsColumnFound', count, null);
        found.prepend(this.createBar(count, maxCount));

        row.append(this.createChip(index, browser.i18n.getMessage(levelToI18nKey(level))), found);

        // A record that started counting the rewritten titles per level later than the rest
        // describes less history in them, so it states the found tally alone.
        if (rewrittenIsKnown) {
            row.appendChild(this.createAmount('totals-level-converted',
                'statsTotalsColumnConverted', rewritten, sharePercent(rewritten, count)));
        }

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
