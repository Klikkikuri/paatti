#!/usr/bin/env node
"use strict";

/**
 * @file inline-icons.mjs
 * Writes an icon's `.svg` source into the badge module that draws it.
 *
 * The extension has no bundler, and the repo root is itself a loadable unpacked extension
 * (see README), so a module cannot fetch its icon at build time and cannot import it at all.
 * The generated block is therefore committed: the source of truth is the `.svg`, and this
 * script is what keeps the copy in `src/` honest. `make dist` refuses a stale one.
 *
 * A module opts in by naming its source and fencing the block this script owns:
 *
 *     // @icon-source assets/icons/<name>.svg
 *     // BEGIN GENERATED ICON -- edit the .svg, then run `make icons`
 *     const svgMarkup = `...`;
 *     // END GENERATED ICON
 *
 * Usage: node tools/inline-icons.mjs [--check]
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The non-OSS tree ships at src/ paths through `make dist NON_OSS=1`, so it plays by the same rules.
const COMPONENT_DIRS = [
    join("src", "components"),
    join("assets", "non-oss", "by-kagi", "src", "components"),
];

const SOURCE = /^\s*\/\/ @icon-source (.+)$/m;
const BLOCK = /^[^\S\n]*\/\/ BEGIN GENERATED ICON.*$[\s\S]*?^[^\S\n]*\/\/ END GENERATED ICON.*$/m;

/**
 * Reject an icon no amount of tidying can make drawable, while it is still a fixable source
 * file rather than a blank box on a news site. `badge-base.js` checks the namespace again at
 * runtime; everything else this script can supply, it supplies in `normalize`.
 *
 * @param {string} markup - The `.svg` file's contents.
 * @param {string} from - Path named in the module, for the error message.
 */
function check(markup, from) {
    const faults = [];
    if (!markup.includes('xmlns="http://www.w3.org/2000/svg"')) faults.push('xmlns="http://www.w3.org/2000/svg"');
    if (!markup.includes("viewBox=")) faults.push("viewBox");
    if (faults.length > 0) {
        throw new Error(`${from}: the <svg> root is missing ${faults.join(", ")}`);
    }

    // "--" inside a comment is illegal in XML but reads as ordinary prose, so a hand-written
    // attribution line lands here rather than at the DOMParser that rejects the whole icon.
    for (const comment of markup.matchAll(/<!--([\s\S]*?)-->/g)) {
        if (comment[1].includes("--")) {
            throw new Error(`${from}: a comment contains "--", which XML does not allow`);
        }
    }
}

/**
 * Turn a drawing as an editor saves it into markup a badge can carry.
 *
 * An icon is authored in Inkscape or Illustrator, so it arrives with a prolog, editor
 * furniture and page-sized dimensions. None of that is the author's job to strip by hand --
 * this is the step that earns the file the name "source".
 *
 * @param {string} markup - The `.svg` file's contents.
 * @returns {{markup: string, notes: string[]}} Badge-ready markup, and what was changed or is
 *   worth knowing about the result.
 */
function normalize(markup) {
    const notes = [];
    let svg = markup.trim();

    // A prolog or doctype ahead of the root is legal in a file and meaningless in a template.
    svg = svg.replace(/^<\?xml[\s\S]*?\?>\s*/, "").replace(/^<!DOCTYPE[\s\S]*?>\s*/i, "").trim();

    // Editors embed script for features browsers never shipped -- Inkscape ships a mesh-gradient
    // polyfill. Badge markup is cloned into third-party pages, so it leaves the script behind.
    const scripts = svg.match(/<script\b[\s\S]*?<\/script>/g);
    if (scripts) {
        svg = svg.replace(/<script\b[\s\S]*?<\/script>/g, "").trim();
        notes.push(`removed ${scripts.length} <script> element(s); an icon may not carry script into a page`);
    }

    const metadata = svg.match(/<metadata\b[\s\S]*?<\/metadata>/g);
    if (metadata) {
        svg = svg.replace(/<metadata\b[\s\S]*?<\/metadata>/g, "").trim();
        notes.push("removed <metadata>");
    }

    // Inkscape saves its canvas state, guides and per-object bookkeeping into the drawing: a
    // <sodipodi:namedview> and an inkscape: attribute on nearly every element. None of it draws
    // anything, and on a hand-edited icon it is most of the file. The xmlns declarations go with the
    // attributes rather than after them -- a prefix left undeclared makes the icon unparseable, which
    // costs more than the bytes ever did.
    const editorMarkup = svg.length;
    svg = svg
        .replace(/<(?:inkscape|sodipodi):[\w.-]+\b[^>]*?\/>/g, "")
        .replace(/<(inkscape|sodipodi):([\w.-]+)\b[\s\S]*?<\/\1:\2>/g, "")
        .replace(/\s(?:inkscape|sodipodi):[\w.-]+\s*=\s*"[^"]*"/g, "")
        .replace(/\sxmlns:(?:inkscape|sodipodi)\s*=\s*"[^"]*"/g, "")
        .trim();
    if (svg.length !== editorMarkup) {
        notes.push(`removed ${editorMarkup - svg.length} bytes of editor bookkeeping`);
    }

    // The root's own attributes, which decide how the badge sizes and reads. Not anchored at the
    // start: an editor's banner comment sits ahead of the root, and an anchored match would find
    // nothing and quietly leave the drawing at its page size.
    const root = svg.match(/<svg\b[^>]*>/);
    if (!root) {
        throw new Error("no <svg> root element found");
    }
    svg = svg.replace(/<svg\b([^>]*)>/, (whole, attrs) => {
        let next = attrs;
        const set = (name, value) => {
            const has = new RegExp(`\\s${name}\\s*=\\s*"[^"]*"`);
            next = has.test(next) ? next.replace(has, ` ${name}="${value}"`) : `${next} ${name}="${value}"`;
        };

        // .badge-icon in badge-style.js is what scales the icon with the headline; without it the
        // root's own width and height win and the badge is a fixed size on every page.
        const classes = next.match(/\sclass\s*=\s*"([^"]*)"/);
        if (!classes) {
            set("class", "badge-icon");
            notes.push('added class="badge-icon"');
        } else if (!classes[1].split(/\s+/).includes("badge-icon")) {
            set("class", `${classes[1].trim()} badge-icon`);
            notes.push('added badge-icon to the root class');
        }

        if (!/\srole\s*=\s*"/.test(next)) {
            set("role", "img");
        }

        // An editor saves the drawing at its page size, in the page's units. The stylesheet
        // overrides both, but a unit here would be the fallback size when it cannot. Both are read:
        // a drawing already 18 wide can still be any height, and half a size is not a square.
        const width = next.match(/\swidth\s*=\s*"([^"]*)"/);
        const height = next.match(/\sheight\s*=\s*"([^"]*)"/);
        if (width?.[1] !== "18" || height?.[1] !== "18") {
            set("width", "18");
            set("height", "18");
            const was = [width?.[1], height?.[1]].filter(Boolean);
            if (was.length > 0) notes.push(`root size ${was.join(" x ")} replaced with 18 x 18`);
        }

        // Editor bookkeeping that means nothing inside a shadow root.
        next = next.replace(/\s(?:version|xml:space|xmlns:svg)\s*=\s*"[^"]*"/g, "");

        return `<svg${next.replace(/\s+/g, " ").replace(/\s+$/, "")}>`;
    });

    // Badges inherit the headline's colour so they are legible on any site in any theme; an icon
    // that paints its own is a deliberate exception, not something to discover on a news page.
    const painted = [...svg.matchAll(/fill\s*[:=]\s*"?\s*(#[0-9a-fA-F]{3,8}|rgb\([^)]*\))/g)];
    const own = new Set(painted.map((m) => m[1].toLowerCase()));
    // Black and white are how a knockout mask is written, so they are not a palette of their own.
    for (const neutral of ["#000", "#000000", "#fff", "#ffffff"]) own.delete(neutral);
    if (own.size > 0) {
        notes.push(`paints its own colours (${[...own].join(", ")}) rather than currentColor`);
    }

    if (svg.length > 4096) {
        notes.push(`${(svg.length / 1024).toFixed(1)}KB of markup ships and is parsed on every page`);
    }

    return { markup: svg, notes };
}

/**
 * Make markup safe to sit inside the backtick literal it is written into. A backtick or a `${`
 * sequence -- in a <title>, a font name, a comment -- would otherwise close the literal or
 * interpolate, and a badge module that fails to parse leaves the badge un-upgraded on real pages
 * with nothing in the console to say why. The escapes are source-level only: the string the module
 * evaluates to is byte-for-byte the markup passed in.
 *
 * @param {string} markup - Badge-ready markup from `normalize`.
 * @returns {string} The same markup, escaped for a template literal.
 */
const forTemplate = (markup) => markup
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");

/**
 * @param {string} file - A module in one of COMPONENT_DIRS, repo-relative.
 * @returns {{path: string, source: string, next: string, current: string}|null} The rewrite it
 *   needs, or null when the module claims no icon source.
 */
function rewrite(file) {
    const path = join(REPO, file);
    const code = readFileSync(path, "utf8");

    const named = code.match(SOURCE);
    if (!named) return null;

    const source = named[1].trim();
    const raw = readFileSync(join(REPO, source), "utf8");
    check(raw, source);
    const { markup, notes } = normalize(raw);

    const block = code.match(BLOCK);
    if (!block) {
        throw new Error(`${file}: names ${source} but has no BEGIN/END GENERATED ICON block`);
    }

    const generated = [
        "// BEGIN GENERATED ICON -- edit the .svg, then run `make icons`",
        `const svgMarkup = \`\n${forTemplate(markup)}\n\`;`,
        "// END GENERATED ICON",
    ].join("\n");

    return { path, source, notes, current: code, next: code.replace(BLOCK, generated) };
}

const checkOnly = process.argv.includes("--check");
let stale = 0;

for (const dir of COMPONENT_DIRS) {
    for (const entry of readdirSync(join(REPO, dir)).filter((f) => f.endsWith(".js"))) {
        const file = join(dir, entry);
        const job = rewrite(file);
        if (!job) continue;

        if (job.next !== job.current) {
            stale += 1;
            if (checkOnly) {
                console.error(`${file} is out of date with ${job.source}`);
            } else {
                writeFileSync(job.path, job.next);
                console.log(`${file} <- ${job.source}`);
            }
        }
        if (!checkOnly) {
            for (const note of job.notes) console.log(`  ${job.source}: ${note}`);
        }
    }
}

if (checkOnly && stale > 0) {
    console.error("Run `make icons` and commit the result.");
    process.exit(1);
}
