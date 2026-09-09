import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const { amoMetadata } = await import('../tools/amo-metadata.mjs');

describe('amoMetadata', () => {
    test('puts the release notes under en-US and the reviewer notes beside them, trimmed, and nothing else', () => {
        assert.deepEqual(amoMetadata('  ## Changes\n- one\n', 'Build with make.\n'), {
            version: { release_notes: { 'en-US': '## Changes\n- one' }, approval_notes: 'Build with make.' },
        });
    });

    test('refuses empty notes, so a missing Release body stops the submission', () => {
        assert.throws(() => amoMetadata(' \n', 'notes'), /release notes are empty/);
        assert.throws(() => amoMetadata('notes', ''), /reviewer notes are empty/);
    });
});
