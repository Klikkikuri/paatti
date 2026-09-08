import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const { homeStatus } = await import('../src/options/home-status.js');

/** A page the extension is happily working on, so each test can spoil one thing. */
const healthy = {
    hasHostname: true,
    isSupported: true,
    isEnabled: true,
    conversionEnabled: true,
    databaseEmpty: false,
    pageStats: { candidates: 4, groupedByClickbaitiness: { 'Very Clickbaity': 2 } },
    waited: true
};

const at = (overrides) => homeStatus({ ...healthy, ...overrides });

describe('homeStatus', () => {
    test('a working page shows the gauge and says nothing', () => {
        const s = at({});

        assert.deepEqual(s, {
            statusKey: '',
            headerKey: null,
            isError: false,
            showGauge: true,
            showRequestSite: false,
            showUpdateDb: false
        });
    });

    test('a failed load reports itself', () => {
        const s = at({ loadFailed: true });

        assert.equal(s.statusKey, 'homeviewStatusLoadFailed');
        assert.equal(s.isError, true);
        assert.equal(s.showGauge, false);
        assert.equal(s.headerKey, null, 'the header keeps whatever hostname it already had');
    });

    test('a tab with no hostname offers no site request', () => {
        const s = at({ hasHostname: false });

        assert.equal(s.statusKey, 'homeviewStatusNotSupported');
        assert.equal(s.showRequestSite, false);
    });

    test('an unsupported site offers a site request', () => {
        const s = at({ isSupported: false });

        assert.equal(s.statusKey, 'homeviewStatusNotSupported');
        assert.equal(s.headerKey, 'siteTitleProcessingNotSupported');
        assert.equal(s.showRequestSite, true);
    });

    test('the master switch being off is named as such', () => {
        const s = at({ conversionEnabled: false });

        assert.equal(s.statusKey, 'homeviewStatusExtensionOff');
        assert.equal(s.headerKey, 'siteTitleProcessingDisabled');
    });

    test('a disabled site is named as such', () => {
        const s = at({ isEnabled: false });

        assert.equal(s.statusKey, 'homeviewStatusDisabled');
        assert.equal(s.headerKey, 'siteTitleProcessingDisabled');
    });

    test('an empty database offers the update control', () => {
        const s = at({ databaseEmpty: true });

        assert.equal(s.statusKey, 'homeviewStatusDatabaseEmpty');
        assert.equal(s.showUpdateDb, true);
        assert.equal(s.isError, false, 'this one is fixable from here, so it is not an error');
    });

    test('page stats that have not arrived yet say nothing', () => {
        const s = at({ pageStats: null, waited: false });

        assert.equal(s.statusKey, '');
        assert.equal(s.showGauge, false);
    });

    test('page stats that never arrived ask for a reload', () => {
        assert.equal(at({ pageStats: null }).statusKey, 'homeviewStatusNoPageData');
    });

    test('a page with no headlines is not reported as a fault', () => {
        const s = at({ pageStats: { candidates: 0, groupedByClickbaitiness: {} } });

        assert.equal(s.statusKey, 'homeviewStatusNoTitlesFound');
        assert.equal(s.isError, false);
    });

    test('headlines the database does not know are named separately', () => {
        const s = at({ pageStats: { candidates: 7, groupedByClickbaitiness: {} } });

        assert.equal(s.statusKey, 'homeviewStatusNoMatches');
    });

    // Several inputs are unhappy at once far more often than one is. These pin the order.
    describe('precedence', () => {
        test('a failed load outranks everything', () => {
            const s = homeStatus({ loadFailed: true, hasHostname: false, databaseEmpty: true });

            assert.equal(s.statusKey, 'homeviewStatusLoadFailed');
        });

        test('an unsupported site outranks an empty database', () => {
            assert.equal(at({ isSupported: false, databaseEmpty: true }).statusKey,
                'homeviewStatusNotSupported');
        });

        test('the master switch outranks the per-site switch', () => {
            assert.equal(at({ conversionEnabled: false, isEnabled: false }).statusKey,
                'homeviewStatusExtensionOff');
        });

        // The fresh-install case: nothing fetched, and the content script has not pushed either.
        test('an empty database outranks page stats that have not arrived', () => {
            const s = at({ databaseEmpty: true, pageStats: null });

            assert.equal(s.statusKey, 'homeviewStatusDatabaseEmpty');
            assert.equal(s.showUpdateDb, true);
        });
    });

    test('no input at all still yields a complete answer', () => {
        const s = homeStatus();

        assert.equal(s.statusKey, 'homeviewStatusNotSupported');
        assert.equal(s.showGauge, false);
    });
});
