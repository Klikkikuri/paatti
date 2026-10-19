import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { stagedManifest, stage, BOOTSTRAP, LOCALHOST_GRANT } = await import('../tools/devserver-stage.mjs');

const base = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const MANIFEST_URLS = ['http://localhost:3000/manifest/ilta-pulu/manifest.json',
    'http://localhost:3000/manifest/captured-sites/manifest.json'];

describe('stagedManifest', () => {
    test('requires localhost and starts the bootstrap in both background forms, and leaves the input alone', () => {
        const snapshot = structuredClone(base);
        const staged = stagedManifest(base);

        assert.deepEqual(staged.host_permissions, [...base.host_permissions, LOCALHOST_GRANT]);
        assert.equal(staged.background.service_worker, BOOTSTRAP);
        assert.deepEqual(staged.background.scripts, [BOOTSTRAP]);
        assert.equal(staged.background.type, 'module');
        assert.deepEqual(base, snapshot);
    });

    test('adds the localhost grant one time, and adds no background form that the manifest does not have', () => {
        const staged = stagedManifest({ host_permissions: [LOCALHOST_GRANT], background: { service_worker: 'a.js' } });
        assert.deepEqual(staged.host_permissions, [LOCALHOST_GRANT]);
        assert.deepEqual(staged.background, { service_worker: BOOTSTRAP });
    });
});

describe('stage', () => {
    test('copies the extension, writes the manifest, the bootstrap and its URL, and skips dot entries', () => {
        const source = mkdtempSync(join(tmpdir(), 'stage-source-'));
        mkdirSync(join(source, 'src'));
        mkdirSync(join(source, '.git'));
        writeFileSync(join(source, 'src', 'background.js'), '');
        writeFileSync(join(source, 'manifest.json'), JSON.stringify(base));
        const target = join(mkdtempSync(join(tmpdir(), 'stage-target-')), 'staged');

        stage(source, target, MANIFEST_URLS);
        stage(source, target, MANIFEST_URLS);

        assert.ok(existsSync(join(target, 'src', 'background.js')));
        assert.ok(!existsSync(join(target, '.git')));
        assert.ok(existsSync(join(target, BOOTSTRAP)));
        assert.deepEqual(JSON.parse(readFileSync(join(target, 'devserver.json'), 'utf8')), { manifestUrls: MANIFEST_URLS });
        assert.deepEqual(JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8')), stagedManifest(base));
    });

    test('does not copy the target into itself when it is inside the source', () => {
        const source = mkdtempSync(join(tmpdir(), 'stage-source-'));
        writeFileSync(join(source, 'manifest.json'), JSON.stringify(base));
        const target = join(source, 'build', 'staged');

        stage(source, target, MANIFEST_URLS);
        stage(source, target, MANIFEST_URLS);
        assert.ok(!existsSync(join(target, 'build', 'staged')));
    });

    test('refuses a manifest URL that does not parse, and no manifest URL', () => {
        assert.throws(() => stage('.', join(tmpdir(), 'never'), [MANIFEST_URLS[0], 'not a url']));
        assert.throws(() => stage('.', join(tmpdir(), 'never'), []));
    });
});
