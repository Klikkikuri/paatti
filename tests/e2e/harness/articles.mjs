/**
 * @file articles.mjs
 * The article helpers the dynamic tests share: an article link that Paatti itself converted (the pool's
 * "base" cases, read out of the page instead of the server's process), and the first page seed that contains a
 * marker.
 */

import { statuses, waitUntil } from "./waits.mjs";

/**
 * @param {import("./browser.mjs").PaattiBrowser} browser
 * @param {string} base
 * @returns {Promise<{href: string, convertedTitle: string}|null>} The first converted article link of the first
 *   seed that shows one, or null when no seed's front page has one. The layout is a function of the seed, so no
 *   single seed is trusted to carry a base article.
 */
export async function convertedArticle(browser, base) {
    for (const seed of [5, 1, 2, 3, 7, 9, 13, 17, 42]) {
        const found = await convertedArticleOfSeed(browser, base, seed);
        if (found) return found;
    }
    return null;
}
async function convertedArticleOfSeed(browser, base, seed) {
    const page = await browser.newPage();
    try {
        await page.goto(`${base}/?seed=${seed}`);
        // The conversion pass is asynchronous; the read waits until the page's blocks have their statuses.
        // A seed whose front page converts nothing is a miss, not a failure: waitUntil now throws on its deadline.
        try {
            await waitUntil(async () => (await statuses(page)).converted, 10000);
        } catch {
            return null;
        }
        return await page.evaluate(() => {
            const articlePattern = /^\/[A-Za-z]+\/a\/[0-9a-f]{12}$/;
            for (const a of document.querySelectorAll("a[href]")) {
                const href = a.getAttribute("href") ?? "";
                if (!articlePattern.test(href)) continue;
                if (a.closest("[data-klikkikuri-status]")?.dataset.klikkikuriStatus !== "converted") continue;
                const title = a.querySelector("[data-klikkikuri-converted-title]") ?? a;
                const convertedTitle = title.dataset.klikkikuriConvertedTitle || "";
                if (convertedTitle) return { href, convertedTitle };
            }
            return null;
        });
    } finally {
        await page.close();
    }
}

/**
 * The first page seed whose front page contains `marker`. A page fault picks its blocks from the seed.
 *
 * @param {string} base
 * @param {string} marker
 * @returns {Promise<number|null>}
 */
export async function firstSeedWith(base, marker) {
    for (let seed = 1; seed < 100; seed++) {
        const page = await fetch(`${base}/?seed=${seed}`).then((response) => response.text()).catch(() => "");
        if (page.includes(marker)) return seed;
    }
    return null;
}
