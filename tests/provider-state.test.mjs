import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const { providerStateTag, originsToGrant } = await import('../src/options/provider-state.js');

const WILDCARD = { host_permissions: [], optional_host_permissions: ['*://*/*'] };
const STORE = { host_permissions: ['https://raw.githubusercontent.com/Klikkikuri/rahti/*'], optional_host_permissions: [] };
const accessError = (origins) => ({ message: 'no access', kind: 'access', origins });

describe('providerStateTag', () => {
    test('names the kind a refresh stopped on', () => {
        assert.equal(providerStateTag({ errors: [{ kind: 'build' }] }).key, 'providerTagNotInBuild');
        assert.equal(providerStateTag({ errors: [accessError(['https://a.example/*'])] }).key, 'providerTagNeedsAccess');
        assert.equal(providerStateTag({ errors: [{ kind: 'fetch' }] }).key, 'providerTagFetchFailed');
    });

    test('a resource error, or one stored before kinds existed, is a general error', () => {
        assert.equal(providerStateTag({ errors: [{ type: 'rahti-data', message: 'HTTP 404' }] }).key, 'providerTagErrors');
    });

    test('an error outranks rejected sites, and nothing wrong is no tag', () => {
        assert.equal(providerStateTag({ errors: [{ kind: 'fetch' }], rejected: [{ key: 'a.fi' }] }).key, 'providerTagFetchFailed');
        assert.equal(providerStateTag({ errors: [], rejected: [{ key: 'a.fi' }] }).key, 'providerTagRejected');
        assert.equal(providerStateTag({ errors: [], rejected: [] }), null);
        assert.equal(providerStateTag({}), null);
    });
});

describe('originsToGrant', () => {
    const origins = ['https://cdn.example/*'];

    test('the origins of an access stop, for an enabled provider this build can grant', () => {
        assert.deepEqual(originsToGrant({ enabled: true }, { errors: [accessError(origins)] }, WILDCARD), origins);
    });

    test('nothing for a disabled provider, which no refresh would pick up', () => {
        assert.equal(originsToGrant({ enabled: false }, { errors: [accessError(origins)] }, WILDCARD), null);
    });

    test('nothing for an origin this build does not declare', () => {
        assert.equal(originsToGrant({ enabled: true }, { errors: [accessError(origins)] }, STORE), null);
    });

    test('nothing without an access stop', () => {
        assert.equal(originsToGrant({ enabled: true }, { errors: [{ kind: 'fetch' }] }, WILDCARD), null);
        assert.equal(originsToGrant({ enabled: true }, { errors: [accessError([])] }, WILDCARD), null);
        assert.equal(originsToGrant({ enabled: true }, {}, WILDCARD), null);
    });
});
