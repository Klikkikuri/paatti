#!/usr/bin/env node
"use strict";

/**
 * @file amo-metadata.mjs
 * Writes the metadata that `web-ext sign --amo-metadata` sends with a listed AMO version: the release
 * notes, read from stdin, and the notes to the Mozilla reviewer, read from a file.
 *
 * `make publish-firefox` feeds it the GitHub Release body of the tag, so the Release is the one place
 * the changelog is written. No `license` key: the listing inherits its custom license from the previous
 * version, and a key here would replace it.
 *
 * Usage: gh release view v<version> --json body --jq .body | node tools/amo-metadata.mjs <reviewer-notes-file>
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {string} releaseNotes - What the user reads on the AMO version page.
 * @param {string} approvalNotes - What only Mozilla reads.
 * @returns {object} The `--amo-metadata` document.
 */
export function amoMetadata(releaseNotes, approvalNotes) {
    const release = releaseNotes.trim();
    const approval = approvalNotes.trim();
    if (!release) throw new Error("release notes are empty; write the GitHub Release body first");
    if (!approval) throw new Error("reviewer notes are empty");

    return { version: { release_notes: { "en-US": release }, approval_notes: approval } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [notesFile] = process.argv.slice(2);
    if (!notesFile) {
        console.error("Usage: node tools/amo-metadata.mjs <reviewer-notes-file> < release-notes");
        process.exit(2);
    }
    try {
        const metadata = amoMetadata(readFileSync(0, "utf8"), readFileSync(notesFile, "utf8"));
        process.stdout.write(JSON.stringify(metadata, null, 2) + "\n");
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}
