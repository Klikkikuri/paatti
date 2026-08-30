import test, { describe, after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const dom = installDom();
const fake = createFakeBrowser({
    messages: {
        statsTotalsHeadlineLabel: 'clickbaits converted',
        statsTotalsReading: '$1 % - $2',
        statsTotalsAwardTitle: 'Clickbaitiest site',
        statsTotalsSince: 'Since $1',
        statsTotalsPerSiteTitle: 'Site',
        statsTotalsColumnReading: 'Clickbaitiness',
        statsTotalsColumnFound: 'Found',
        statsTotalsColumnConverted: 'Converted',
        statsTotalsSharePercent: '$1 %',
        statsTotalsShareOfFound: '$1 % of $2 found',
        statsTotalsFoundTitle: '$1 found',
        statsTotalsAboutSummary: 'How to read this table',
        statsTotalsAboutReading: 'Clickbaitiness is the average level of every title found.',
        statsTotalsAboutAmounts: 'The bar under a site fills to the converted share.',
        statsTotalsAboutLevelsTerm: 'Level breakdown',
        statsTotalsAboutLevels: 'A level bar is that level against the busiest one.',
        statsTotalsMixLabel: 'What you were served',
        statsTotalsMixSegment: '$1: $2 ($3 %)',
        statsviewConvertedOfFound: 'of $1 ($2 %)',
        statsviewCollectingPeriodDays: 'Collecting for $1 days',
        statsviewCollectingPeriodMonths: 'Collecting for $1 months',
        statsTotalsEmpty: 'Nothing counted yet.',
        statsTotalsSiteLevelsAriaLabel: 'Breakdown for $1',
        statsviewBreakdownCaption: 'All titles found, before rewriting.',
        clickbaitinessLabel_Extremely_Clickbaity: 'Extremely Clickbaity',
        clickbaitinessLabel_Very_Clickbaity: 'Very Clickbaity',
        clickbaitinessLabel_Moderately_Clickbaity: 'Moderately Clickbaity',
        clickbaitinessLabel_Slightly_Clickbaity: 'Slightly Clickbaity',
        clickbaitinessLabel_Not_Clickbait_at_all: 'Not Clickbait at all'
    }
});
globalThis.browser = fake.browser;

await import('../src/options/components/statistics-totals.js');

after(() => dom.teardown());

const DAY = 24 * 60 * 60 * 1000;

/**
 * Two sites and a running tally, the shape the options page draws from.
 *
 * `firstSeen` is relative rather than a fixed epoch: computeCollectingPeriod rounds to a rung, and
 * a fixed date would climb through them as real time passes. Five days back stays five days.
 */
const POPULATED = {
    'is.fi': {
        groupedByClickbaitiness: { 'Very Clickbaity': 800, 'Extremely Clickbaity': 404 },
        // yle.fi deliberately carries none, so one fixture covers a known split and a missing one.
        convertedByClickbaitiness: { 'Very Clickbaity': 400, 'Extremely Clickbaity': 101 },
        convertedCount: 612,
        firstSeen: Date.now() - 5 * DAY
    },
    'yle.fi': {
        groupedByClickbaitiness: { 'Not Clickbait at all': 400, 'Slightly Clickbaity': 20 },
        convertedCount: 38
    },
    _global: { totalConversions: 1842 }
};

/** Let the component's storage reads and the render they feed settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let element;

/** Attach the element and wait for its first render. */
async function mount() {
    element = document.createElement('statistics-totals');
    document.body.appendChild(element);
    await flush();
    return element;
}

beforeEach(async () => {
    await browser.storage.local.clear();
    await browser.storage.local.set({ statistics: structuredClone(POPULATED) });
    fake.reset();
});

afterEach(() => {
    element?.remove();
    element = null;
});

describe('statistics-totals', () => {
    test('states the rewritten tally as a share of everything found', async () => {
        await mount();

        // 612 + 38 rewritten, of 1204 + 420 found -- the same rows the table lists.
        assert.equal(element.querySelector('.totals-number').textContent, (650).toLocaleString());
        assert.equal(element.querySelector('.totals-of').textContent,
            `of ${(1624).toLocaleString()} (40 %)`);
        assert.ok(!element.querySelector('.totals-body').classList.contains('hidden'));
        assert.ok(element.querySelector('.totals-empty').classList.contains('hidden'));
    });

    test('states the tally alone when nothing was found to compare it against', async () => {
        await browser.storage.local.set({
            statistics: {
                'none.fi': { groupedByClickbaitiness: {}, convertedCount: 4 },
                _global: { totalConversions: 4 }
            }
        });
        await mount();

        assert.ok(!element.querySelector('.totals-body').classList.contains('hidden'));
        assert.ok(element.querySelector('.totals-of').classList.contains('hidden'));
    });

    test('what the columns mean is there to open, and closed until it is', async () => {
        await mount();

        const about = element.querySelector('.totals-about');
        assert.equal(about.open, false);
        assert.equal(about.querySelector('.totals-about-icon').textContent, 'i');
        assert.equal(about.querySelector('summary [data-i18n]').textContent, 'How to read this table');
        // Each column of the table, answered under the heading it carries.
        assert.deepEqual([...about.querySelectorAll('.totals-about-list > *')].map((el) => el.textContent), [
            'Clickbaitiness',
            'Clickbaitiness is the average level of every title found.',
            'Converted',
            'The bar under a site fills to the converted share.',
            'Level breakdown',
            'A level bar is that level against the busiest one.'
        ]);
    });

    describe('the mix of what was found', () => {
        /** The mix segments, paired with the width each was given. */
        const segments = () => [...element.querySelectorAll('.totals-mix-segment')];

        test('one segment per level found, in severity order', async () => {
            await mount();

            // The pooled levels of both sites: 400 + 20 from yle.fi, 800 + 404 from is.fi. The
            // three levels neither site found are absent rather than drawn empty.
            assert.deepEqual(segments().map((segment) => segment.dataset.severity), ['0', '1', '3', '4']);
        });

        test('the segments tile the whole width', async () => {
            await mount();

            const total = segments()
                .reduce((sum, segment) => sum + Number.parseFloat(segment.style.width), 0);
            assert.ok(Math.abs(total - 100) < 1e-9, `segments cover ${total} %`);
        });

        test('a segment names its level, its tally and its share', async () => {
            await mount();

            // 800 of 1624 pooled titles.
            assert.equal(segments()[2].getAttribute('title'),
                `Very Clickbaity: ${(800).toLocaleString()} (49 %)`);
        });

        test('the legend states every segment in words', async () => {
            await mount();

            const items = [...element.querySelectorAll('.totals-mix-item')];
            assert.deepEqual(items.map((item) => item.querySelector('.totals-mix-name').textContent),
                ['Not Clickbait at all', 'Slightly Clickbaity', 'Very Clickbaity', 'Extremely Clickbaity']);
            assert.deepEqual(items.map((item) => item.querySelector('.totals-mix-share').textContent),
                ['25 %', '1 %', '49 %', '25 %']);
            assert.deepEqual(items.map((item) => item.dataset.severity), ['0', '1', '3', '4']);
        });

        test('is withheld until something has been found', async () => {
            await browser.storage.local.set({
                statistics: {
                    'none.fi': { groupedByClickbaitiness: {}, convertedCount: 4 },
                    _global: { totalConversions: 4 }
                }
            });
            await mount();

            assert.ok(element.querySelector('.totals-mix').classList.contains('hidden'));
            assert.equal(segments().length, 0);
        });
    });

    test('lists the sites, busiest first', async () => {
        await mount();

        const rows = [...element.querySelectorAll('.totals-site')];
        assert.deepEqual(rows.map((row) => row.querySelector('.totals-site-domain').textContent),
            ['is.fi', 'Yle']);
        assert.equal(rows[0].dataset.severity, '3');
        // The converted tally as a share of what was found, which is the share the bar draws and
        // the whole the row states on hover rather than in a column.
        assert.equal(rows[0].querySelector('.totals-site-found'), null);
        assert.equal(rows[0].querySelector('.totals-share-fill').style.width, '51%');
        assert.equal(rows[0].querySelector('.totals-site-converted').getAttribute('title'),
            `51 % of ${(1204).toLocaleString()} found`);
        assert.equal(rows[0].querySelector('.totals-site-converted .totals-amount-value').textContent,
            (612).toLocaleString());
        assert.equal(rows[0].querySelector('.totals-site-converted .totals-amount-note').textContent, '51 %');
    });

    describe('the reading chip', () => {
        test('names the level a site reads at, and states the reading on hover', async () => {
            await mount();

            const chip = element.querySelector('.totals-site[data-domain="is.fi"] .totals-chip');
            assert.equal(chip.textContent, 'Very Clickbaity');
            assert.equal(chip.dataset.severity, '3');
            assert.equal(chip.getAttribute('title'), '83 % - Very Clickbaity');
        });

        test('a site that found nothing still reads at a level', async () => {
            await browser.storage.local.set({
                statistics: {
                    'none.fi': { groupedByClickbaitiness: {}, convertedCount: 4 },
                    _global: { totalConversions: 4 }
                }
            });
            await mount();

            const chip = element.querySelector('.totals-site[data-domain="none.fi"] .totals-chip');
            assert.equal(chip.dataset.severity, '0');
            assert.equal(chip.textContent, 'Not Clickbait at all');
        });

        test('sits outside the control, so pressing it opens nothing', async () => {
            await mount();
            const row = element.querySelector('.totals-site[data-domain="is.fi"]');

            row.querySelector('.totals-chip').click();

            assert.equal(row.querySelector('.totals-site-toggle').getAttribute('aria-expanded'), 'false');
            assert.ok(row.querySelector('.totals-site-levels').classList.contains('hidden'));
        });
    });

    describe('the collecting period', () => {
        test('rounds how long the tally has run, and dates its start', async () => {
            await mount();

            // POPULATED's only firstSeen is is.fi's, five days back.
            const started = new Date(POPULATED['is.fi'].firstSeen).toLocaleDateString();
            assert.equal(element.querySelector('.totals-period-value').textContent, 'Collecting for 5 days');
            assert.equal(element.querySelector('.totals-since').textContent, `Since ${started}`);
            assert.ok(!element.querySelector('.totals-period').classList.contains('hidden'));
        });

        test('takes a coarser unit as it grows', async () => {
            const older = structuredClone(POPULATED);
            older['is.fi'].firstSeen = Date.now() - 100 * DAY;
            await browser.storage.local.set({ statistics: older });
            await mount();

            assert.equal(element.querySelector('.totals-period-value').textContent, 'Collecting for 3 months');
        });

        test('is withheld when no record records a start', async () => {
            const undated = structuredClone(POPULATED);
            delete undated['is.fi'].firstSeen;
            await browser.storage.local.set({ statistics: undated });
            await mount();

            assert.ok(element.querySelector('.totals-period').classList.contains('hidden'));
        });
    });

    test('names a site by its configured name where it has one', async () => {
        await browser.storage.local.set({
            statistics: { 'yle.fi': { groupedByClickbaitiness: { 'Very Clickbaity': 8 }, convertedCount: 3 } }
        });
        await mount();

        // yle.fi carries a name in the shipped siteConfigs; is.fi does not and keeps its domain.
        assert.equal(element.querySelector('.totals-site-domain').textContent, 'Yle');
    });

    test('hands the award to the clickbaitiest site', async () => {
        await mount();

        const award = element.querySelector('.totals-award');
        assert.ok(!award.classList.contains('hidden'));
        assert.equal(award.querySelector('.totals-award-domain').textContent, 'is.fi');

        const chip = award.querySelector('.totals-award-reading .totals-chip');
        assert.equal(chip.textContent, 'Very Clickbaity');
        assert.equal(chip.getAttribute('title'), '83 % - Very Clickbaity');
    });

    test('withholds the award while there is no contest', async () => {
        await browser.storage.local.set({
            statistics: { 'yle.fi': POPULATED['yle.fi'], _global: { totalConversions: 38 } }
        });
        await mount();

        assert.ok(element.querySelector('.totals-award').classList.contains('hidden'));
    });

    test('says so when nothing has been counted', async () => {
        await browser.storage.local.set({ statistics: { _global: { totalConversions: 12 } } });
        await mount();

        assert.ok(element.querySelector('.totals-body').classList.contains('hidden'));
        assert.ok(!element.querySelector('.totals-empty').classList.contains('hidden'));
    });

    test('a rewritten tally larger than the found one states no share', async () => {
        await browser.storage.local.set({
            statistics: {
                'odd.fi': { groupedByClickbaitiness: { 'Very Clickbaity': 100 }, convertedCount: 150 },
                'ok.fi': { groupedByClickbaitiness: { 'Very Clickbaity': 200 }, convertedCount: 60 },
                _global: { totalConversions: 210 }
            }
        });
        await mount();

        const rows = Object.fromEntries([...element.querySelectorAll('.totals-site')]
            .map((row) => [row.dataset.domain, row]));

        // 150 rewritten is not a part of 100 found, so the converted cell states the tally alone.
        assert.equal(rows['odd.fi'].querySelector('.totals-site-converted .totals-amount-value').textContent, '150');
        assert.equal(rows['odd.fi'].querySelector('.totals-site-converted .totals-amount-note'), null);
        // The bar draws that share, so it keeps its column and draws nothing in it, and the
        // tooltip states the found tally alone.
        assert.ok(rows['odd.fi'].querySelector('.totals-share-bar').classList.contains('is-unknown'));
        assert.equal(rows['odd.fi'].querySelector('.totals-share-fill'), null);
        assert.equal(rows['odd.fi'].querySelector('.totals-site-converted').getAttribute('title'),
            '100 found');

        assert.equal(rows['ok.fi'].querySelector('.totals-site-converted .totals-amount-value').textContent, '60');
        assert.equal(rows['ok.fi'].querySelector('.totals-site-converted .totals-amount-note').textContent, '30 %');
        assert.equal(rows['ok.fi'].querySelector('.totals-share-fill').style.width, '30%');
    });

    describe('the per-site level breakdown', () => {
        /** The row for one domain, whichever place the sort has put it in. */
        const rowFor = (domain) => element.querySelector(`.totals-site[data-domain="${domain}"]`);

        test('the site name opens the breakdown', async () => {
            await mount();

            const toggle = rowFor('is.fi').querySelector('.totals-site-toggle');
            assert.equal(toggle.tagName, 'BUTTON');
            assert.equal(toggle.getAttribute('aria-expanded'), 'false');
            assert.equal(toggle.getAttribute('aria-label'), 'Breakdown for is.fi');
            assert.equal(toggle.getAttribute('aria-controls'),
                rowFor('is.fi').querySelector('.totals-site-levels').id);
        });

        test('a site with nothing found has nothing to open', async () => {
            await browser.storage.local.set({
                statistics: {
                    'none.fi': { groupedByClickbaitiness: {}, convertedCount: 4 },
                    _global: { totalConversions: 4 }
                }
            });
            await mount();

            assert.equal(rowFor('none.fi').querySelector('.totals-site-name').tagName, 'SPAN');
            assert.equal(rowFor('none.fi').querySelector('.totals-site-levels'), null);
        });

        test('the levels are drawn while the panel is still closed', async () => {
            await mount();

            const panel = rowFor('is.fi').querySelector('.totals-site-levels');
            assert.ok(panel.classList.contains('hidden'));
            assert.equal(panel.querySelector('.totals-levels-caption').textContent,
                'All titles found, before rewriting.');
            assert.equal(panel.querySelectorAll('.totals-level').length, 2);
        });

        test('pressing it opens the panel, and pressing it again closes it', async () => {
            await mount();
            const row = rowFor('is.fi');

            row.querySelector('.totals-site-toggle').click();
            assert.equal(row.querySelector('.totals-site-toggle').getAttribute('aria-expanded'), 'true');
            assert.ok(!row.querySelector('.totals-site-levels').classList.contains('hidden'));

            row.querySelector('.totals-site-toggle').click();
            assert.equal(row.querySelector('.totals-site-toggle').getAttribute('aria-expanded'), 'false');
            assert.ok(row.querySelector('.totals-site-levels').classList.contains('hidden'));
        });

        test('lists the levels found, in severity order, against the busiest of them', async () => {
            await mount();

            const levels = [...rowFor('is.fi').querySelectorAll('.totals-level')];
            assert.deepEqual(levels.map((level) => level.querySelector('.totals-chip').textContent),
                ['Very Clickbaity', 'Extremely Clickbaity']);
            assert.deepEqual(
                levels.map((level) => level.querySelector('.totals-level-found .totals-amount-value').textContent),
                [(800).toLocaleString(), (404).toLocaleString()]);
            assert.deepEqual(levels.map((level) => level.dataset.severity), ['3', '4']);
            // Against is.fi's busiest level, 800, rather than against its 1204 found.
            assert.equal(levels[0].querySelector('.totals-bar-fill').style.width, '100%');
            assert.equal(levels[1].querySelector('.totals-bar-fill').style.width, '50.5%');
        });

        test('a known split is stated as a tally and a share', async () => {
            await mount();

            const levels = [...rowFor('is.fi').querySelectorAll('.totals-level')];
            assert.equal(levels[0].querySelector('.totals-level-converted .totals-amount-value').textContent,
                (400).toLocaleString());
            assert.equal(levels[0].querySelector('.totals-level-converted .totals-amount-note').textContent, '50 %');
            assert.equal(levels[1].querySelector('.totals-level-converted .totals-amount-note').textContent, '25 %');
        });

        test('a level whose titles were all left alone still states its nothing', async () => {
            const untouched = structuredClone(POPULATED);
            untouched['is.fi'].convertedByClickbaitiness = { 'Very Clickbaity': 400 };
            await browser.storage.local.set({ statistics: untouched });
            await mount();

            const levels = [...rowFor('is.fi').querySelectorAll('.totals-level')];
            assert.equal(levels[1].querySelector('.totals-level-converted .totals-amount-value').textContent, '0');
            assert.equal(levels[1].querySelector('.totals-level-converted .totals-amount-note').textContent, '0 %');
        });

        test('a record with no split states the found tally alone', async () => {
            await mount();

            const [level] = rowFor('yle.fi').querySelectorAll('.totals-level');
            assert.equal(level.querySelector('.totals-level-found .totals-amount-value').textContent,
                (400).toLocaleString());
            assert.equal(level.querySelector('.totals-level-converted'), null);
        });

        test('a split that started late is withheld too', async () => {
            const late = structuredClone(POPULATED);
            late['is.fi'].convertedByClickbaitinessSince = Date.now() - 2 * DAY;
            await browser.storage.local.set({ statistics: late });
            await mount();

            const [level] = rowFor('is.fi').querySelectorAll('.totals-level');
            assert.equal(level.querySelector('.totals-level-converted'), null);
        });

        test('an open panel survives a statistics write', async () => {
            await mount();
            rowFor('yle.fi').querySelector('.totals-site-toggle').click();

            // Enough to overtake is.fi, so the row moves as well as being replaced.
            const grown = structuredClone(POPULATED);
            grown['yle.fi'].groupedByClickbaitiness['Not Clickbait at all'] = 4000;
            grown['yle.fi'].convertedCount = 3000;
            await browser.storage.local.set({ statistics: grown });
            await flush();

            assert.equal(element.querySelector('.totals-site').dataset.domain, 'yle.fi');
            assert.equal(rowFor('yle.fi').querySelector('.totals-site-toggle').getAttribute('aria-expanded'), 'true');
            assert.ok(!rowFor('yle.fi').querySelector('.totals-site-levels').classList.contains('hidden'));
            assert.equal(rowFor('is.fi').querySelector('.totals-site-toggle').getAttribute('aria-expanded'), 'false');

            const [level] = rowFor('yle.fi').querySelectorAll('.totals-level');
            assert.equal(level.querySelector('.totals-level-found .totals-amount-value').textContent,
                (4000).toLocaleString());
        });

        test('an open panel survives a re-attach', async () => {
            await mount();
            rowFor('is.fi').querySelector('.totals-site-toggle').click();

            element.remove();
            document.body.appendChild(element);
            await flush();

            assert.equal(rowFor('is.fi').querySelector('.totals-site-toggle').getAttribute('aria-expanded'), 'true');
        });

        test('a domain that leaves the list is forgotten', async () => {
            await mount();
            rowFor('is.fi').querySelector('.totals-site-toggle').click();

            await browser.storage.local.set({
                statistics: { 'yle.fi': POPULATED['yle.fi'], _global: { totalConversions: 38 } }
            });
            await flush();
            await browser.storage.local.set({ statistics: structuredClone(POPULATED) });
            await flush();

            assert.equal(rowFor('is.fi').querySelector('.totals-site-toggle').getAttribute('aria-expanded'), 'false');
        });
    });

    test('a statistics write redraws the section', async () => {
        await mount();

        const grown = structuredClone(POPULATED);
        grown['is.fi'].convertedCount = 900;
        await browser.storage.local.set({ statistics: grown });
        await flush();

        assert.equal(element.querySelector('.totals-number').textContent, (938).toLocaleString());
    });

    test('a write to another key leaves it alone', async () => {
        await mount();
        const before = fake.reads.local;

        await browser.storage.local.set({ userPreferences: { enabled: true } });
        await flush();

        assert.equal(fake.reads.local, before);
    });

    test('leaving the page unsubscribes', async () => {
        await mount();
        assert.equal(browser.storage.onChanged.listeners.length, 1);

        element.remove();

        assert.equal(browser.storage.onChanged.listeners.length, 0);
    });

    test('re-attaching subscribes again', async () => {
        await mount();
        element.remove();

        document.body.appendChild(element);
        await flush();

        assert.equal(browser.storage.onChanged.listeners.length, 1);
        assert.equal(element.querySelector('.totals-number').textContent, (650).toLocaleString());
    });
});
