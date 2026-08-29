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
        statsTotalsOfFound: 'of $1',
        statsviewConvertedOfFound: 'of $1 ($2 %)',
        statsTotalsEmpty: 'Nothing counted yet.',
        statsTotalsSiteLevelsAriaLabel: 'Breakdown for $1',
        statsviewBreakdownCaption: 'All titles found, before rewriting.',
        statsviewRowRewritten: '$1 of $2 rewritten',
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

/** Two sites and a running tally, the shape the options page draws from. */
const POPULATED = {
    'is.fi': {
        groupedByClickbaitiness: { 'Very Clickbaity': 800, 'Extremely Clickbaity': 404 },
        // yle.fi deliberately carries none, so one fixture covers a known split and a missing one.
        convertedByClickbaitiness: { 'Very Clickbaity': 400, 'Extremely Clickbaity': 101 },
        convertedCount: 612,
        firstSeen: Date.UTC(2026, 2, 12)
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

    test('marks how clickbaity everything found reads', async () => {
        await mount();

        // is.fi's 1204 titles dominate yle.fi's 420, so the pooled reading sits high.
        assert.equal(element.querySelector('.totals-meter-marker').style.left, '62%');
        assert.equal(element.querySelector('.totals-meter-caption').textContent,
            '62 % - Moderately Clickbaity');
    });

    test('withholds the meter until something has been found', async () => {
        await browser.storage.local.set({
            statistics: {
                'none.fi': { groupedByClickbaitiness: {}, convertedCount: 4 },
                _global: { totalConversions: 4 }
            }
        });
        await mount();

        assert.ok(element.querySelector('.totals-meter').classList.contains('hidden'));
        assert.ok(!element.querySelector('.totals-body').classList.contains('hidden'));
        // Nothing found, so the headline states the tally without an "of".
        assert.ok(element.querySelector('.totals-of').classList.contains('hidden'));
    });

    test('lists the sites, busiest first', async () => {
        await mount();

        const rows = [...element.querySelectorAll('.totals-site')];
        assert.deepEqual(rows.map((row) => row.querySelector('.totals-site-name span:last-child').textContent),
            ['is.fi', 'Yle']);
        assert.equal(rows[0].dataset.severity, '3');
        assert.equal(rows[0].querySelector('.totals-site-amount').textContent,
            `${(612).toLocaleString()} of ${(1204).toLocaleString()}`);
        // Only the found tally is muted, and a real space survives into the text.
        assert.equal(rows[0].querySelector('.totals-site-of').textContent,
            `of ${(1204).toLocaleString()}`);
        assert.equal(rows[0].querySelector('.totals-site-bar-fill').style.width, '100%');
    });

    test('says when the earliest tally started', async () => {
        await mount();

        // POPULATED's only firstSeen is is.fi's.
        const started = new Date(POPULATED['is.fi'].firstSeen).toLocaleDateString();
        assert.equal(element.querySelector('.totals-since').textContent, `Since ${started}`);
        assert.ok(!element.querySelector('.totals-since').classList.contains('hidden'));
    });

    test('withholds the start when no record records one', async () => {
        const undated = structuredClone(POPULATED);
        delete undated['is.fi'].firstSeen;
        await browser.storage.local.set({ statistics: undated });
        await mount();

        assert.ok(element.querySelector('.totals-since').classList.contains('hidden'));
    });

    test('names a site by its configured name where it has one', async () => {
        await browser.storage.local.set({
            statistics: { 'yle.fi': { groupedByClickbaitiness: { 'Very Clickbaity': 8 }, convertedCount: 3 } }
        });
        await mount();

        // yle.fi carries a name in the shipped siteConfigs; is.fi does not and keeps its domain.
        assert.equal(element.querySelector('.totals-site-name span:last-child').textContent, 'Yle');
    });

    test('hands the award to the clickbaitiest site', async () => {
        await mount();

        assert.ok(!element.querySelector('.totals-award').classList.contains('hidden'));
        assert.equal(element.querySelector('.totals-award-domain').textContent, 'is.fi');
        assert.equal(element.querySelector('.totals-award-reading').textContent, '83 % - Very Clickbaity');
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

    test('a rewritten tally larger than the found one draws no nested share', async () => {
        await browser.storage.local.set({
            statistics: {
                'odd.fi': { groupedByClickbaitiness: { 'Very Clickbaity': 100 }, convertedCount: 150 },
                'ok.fi': { groupedByClickbaitiness: { 'Very Clickbaity': 200 }, convertedCount: 60 },
                _global: { totalConversions: 210 }
            }
        });
        await mount();

        const rows = Object.fromEntries([...element.querySelectorAll('.totals-site')]
            .map((row) => [row.querySelector('.totals-site-name span:last-child').textContent, row]));

        const odd = rows['odd.fi'].querySelector('.totals-site-bar-fill');
        assert.equal(odd.querySelector('.totals-site-bar-rewritten'), null);
        assert.ok(odd.classList.contains('is-plain'));
        // No "of": 150 rewritten is not a part of 100 found.
        assert.equal(rows['odd.fi'].querySelector('.totals-site-amount').textContent, '100');
        assert.equal(rows['odd.fi'].querySelector('.totals-site-of'), null);

        const ok = rows['ok.fi'].querySelector('.totals-site-bar-fill');
        assert.equal(ok.querySelector('.totals-site-bar-rewritten').style.width, '30%');
        assert.ok(!ok.classList.contains('is-plain'));
        assert.equal(rows['ok.fi'].querySelector('.totals-site-amount').textContent, '60 of 200');
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
            assert.deepEqual(levels.map((level) => level.querySelector('.totals-level-name').textContent),
                ['Very Clickbaity', 'Extremely Clickbaity']);
            assert.deepEqual(levels.map((level) => level.querySelector('.totals-level-amount').textContent),
                [(800).toLocaleString(), (404).toLocaleString()]);
            assert.deepEqual(levels.map((level) => level.dataset.severity), ['3', '4']);
            // Against is.fi's busiest level, 800, rather than against its 1204 found.
            assert.equal(levels[0].querySelector('.totals-site-bar-fill').style.width, '100%');
            assert.equal(levels[1].querySelector('.totals-site-bar-fill').style.width, '50.5%');
        });

        test('a known split is drawn inside the level bar', async () => {
            await mount();

            const [level] = rowFor('is.fi').querySelectorAll('.totals-level');
            assert.equal(level.querySelector('.totals-site-bar-rewritten').style.width, '50%');
            assert.equal(level.getAttribute('title'), '400 of 800 rewritten');
        });

        test('a record with no split states magnitude alone', async () => {
            await mount();

            const [level] = rowFor('yle.fi').querySelectorAll('.totals-level');
            const fill = level.querySelector('.totals-site-bar-fill');
            assert.ok(fill.classList.contains('is-plain'));
            assert.equal(fill.querySelector('.totals-site-bar-rewritten'), null);
            assert.equal(level.getAttribute('title'), null);
        });

        test('a split that started late is no share either', async () => {
            const late = structuredClone(POPULATED);
            late['is.fi'].convertedByClickbaitinessSince = Date.UTC(2026, 5, 1);
            await browser.storage.local.set({ statistics: late });
            await mount();

            const [level] = rowFor('is.fi').querySelectorAll('.totals-level');
            assert.ok(level.querySelector('.totals-site-bar-fill').classList.contains('is-plain'));
            assert.equal(level.getAttribute('title'), null);
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
            assert.equal(level.querySelector('.totals-level-amount').textContent, (4000).toLocaleString());
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
