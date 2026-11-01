import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { stagedManifest, stage, BOOTSTRAP, LOOPBACK_GRANTS } = await import('../tools/devserver-stage.mjs');
const { repoRoot } = await import('../tools/devserver-paths.mjs');

const base = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const MANIFEST_URLS = ['http://localhost:3000/manifest/ilta-pulu/manifest.json',
    'http://localhost:3000/manifest/captured-sites/manifest.json'];

describe('stagedManifest', () => {
    test('requires the loopback grants and starts the bootstrap in both background forms, and leaves the input alone', () => {
        const snapshot = structuredClone(base);
        const staged = stagedManifest(base);

        assert.deepEqual(staged.host_permissions, [...base.host_permissions, ...LOOPBACK_GRANTS]);
        assert.equal(staged.background.service_worker, BOOTSTRAP);
        assert.deepEqual(staged.background.scripts, [BOOTSTRAP]);
        assert.equal(staged.background.type, 'module');
        assert.deepEqual(base, snapshot);
    });

    test('adds each loopback grant one time, and adds no background form that the manifest does not have', () => {
        const staged = stagedManifest({ host_permissions: LOOPBACK_GRANTS, background: { service_worker: 'a.js' } });
        assert.deepEqual(staged.host_permissions, LOOPBACK_GRANTS);
        assert.deepEqual(staged.background, { service_worker: BOOTSTRAP });
    });

    test('without the bootstrap, keeps the manifest background and adds only the grants', () => {
        const staged = stagedManifest(base, false);
        assert.deepEqual(staged.host_permissions, [...base.host_permissions, ...LOOPBACK_GRANTS]);
        assert.equal(staged.background.service_worker, base.background.service_worker);
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

    test('refuses a manifest URL that does not parse, no manifest URL, the source as its own target, and a foreign target', () => {
        const selfTarget = join(mkdtempSync(join(tmpdir(), 'stage-self-')), 'staged');
        mkdirSync(selfTarget);
        writeFileSync(join(selfTarget, 'manifest.json'), '{}');
        assert.throws(() => stage('.', join(tmpdir(), 'never'), [MANIFEST_URLS[0], 'not a url']));
        assert.throws(() => stage('.', join(tmpdir(), 'never'), []));
        assert.throws(() => stage(selfTarget, selfTarget, MANIFEST_URLS));
        assert.ok(existsSync(join(selfTarget, 'manifest.json')), 'the source must keep its files');

        // A target outside build/ and the temporary root is refused before anything is deleted.
        const foreign = join(repoRoot, 'src', 'definitely-not-a-staging-dir');
        assert.throws(() => stage('.', foreign, MANIFEST_URLS), /must be inside/);
        assert.ok(!existsSync(foreign), 'a refused target must not be created');
    });

    test('refuses a manifest with no background section when it swaps the bootstrap', () => {
        const source = mkdtempSync(join(tmpdir(), 'stage-source-'));
        writeFileSync(join(source, 'manifest.json'), JSON.stringify({ manifest_version: 3 }));
        const target = join(mkdtempSync(join(tmpdir(), 'stage-target-')), 'staged');
        assert.throws(() => stage(source, target, MANIFEST_URLS), /no background/);
    });

    test('without the bootstrap, writes no devserver.json and no bootstrap file, whatever the URLs are', () => {
        const source = mkdtempSync(join(tmpdir(), 'stage-source-'));
        writeFileSync(join(source, 'manifest.json'), JSON.stringify(base));
        const target = join(mkdtempSync(join(tmpdir(), 'stage-target-')), 'staged');

        stage(source, target, [], { bootstrap: false });
        assert.ok(!existsSync(join(target, BOOTSTRAP)));
        assert.ok(!existsSync(join(target, 'devserver.json')));
    });
});
