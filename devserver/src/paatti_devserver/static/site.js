// Ilta-Pulu's dynamic content, the page chaos, and the self-check panel.
//
// Every random choice comes from a PRNG seeded by data-seed, so a page with one seed behaves the same each time.
// Nodes are replaced, never edited in place: the content script ignores a text change inside a headline that it
// has already processed. The one exception is the "gap" ticker item, which documents that extension gap.
(() => {
    "use strict";

    const body = document.body;
    const seed = Number(body.dataset.seed || 0);
    const params = new URLSearchParams(location.search);

    // mulberry32: a small seeded PRNG.
    const prng = (value) => () => {
        value = (value + 0x6d2b79f5) | 0;
        let t = Math.imul(value ^ (value >>> 15), 1 | value);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const fragment = async (kind, n) => {
        const response = await fetch(`/api/fragment?kind=${kind}&seed=${seed}&n=${n}`);
        const template = document.createElement("template");
        template.innerHTML = await response.text();
        return template.content;
    };

    if ("late" in body.dataset) {
        setTimeout(() => {
            for (const template of document.querySelectorAll("template[data-devserver-late]")) {
                template.replaceWith(template.content.cloneNode(true));
            }
        }, 1500);
    }

    if ("ticker" in body.dataset) {
        let tick = 0;
        setInterval(async () => {
            const items = [...document.querySelectorAll(".newsticker > a.ticker-item:not([data-devserver-xfail])")];
            if (items.length === 0) return;
            tick += 1;
            const replacement = await fragment("ticker", tick);
            items[tick % items.length].replaceWith(replacement);
        }, 5000);

        // Scroll the ticker with scrollLeft, not by moving its items: a moved item is a new node to the content script.
        const ticker = document.querySelector(".newsticker");
        if (ticker && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
            let position = 0;
            let last = 0;
            let paused = false;
            ticker.addEventListener("mouseenter", () => { paused = true; });
            ticker.addEventListener("mouseleave", () => { paused = false; position = ticker.scrollLeft; });
            const step = (now) => {
                const elapsed = last ? now - last : 0;
                last = now;
                if (!paused) {
                    position += elapsed * 0.06;
                    if (position >= ticker.scrollWidth - ticker.clientWidth) position = 0;
                    ticker.scrollLeft = position;
                }
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        }
    }

    if ("gap" in body.dataset) {
        setTimeout(() => {
            const title = document.querySelector('[data-devserver-xfail="gap"] .ticker-title');
            if (title) title.textContent = "Recycled in place: this ticker item now tells another story";
        }, 3000);
    }

    if ("loadMore" in body.dataset) {
        const button = document.getElementById("load-more");
        const target = document.getElementById("more");
        let page = 0;
        const loadMore = async () => {
            if (page >= 5) return button.remove();
            page += 1;
            target.append(await fragment("more", page));
        };
        button?.addEventListener("click", loadMore);
        if (button) {
            new IntersectionObserver((entries) => {
                if (entries.some((entry) => entry.isIntersecting)) loadMore();
            }).observe(button);
        }
    }

    if ("churn" in body.dataset) {
        let tick = 0;
        setInterval(async () => {
            const cards = document.querySelectorAll("div.front div.card");
            if (cards.length === 0) return;
            tick += 1;
            const card = cards[Math.floor(prng(seed * 1000 + tick)() * cards.length)];
            const replacement = await fragment("churn", tick);
            for (const node of replacement.querySelectorAll("[data-expect-status]")) {
                node.dataset.devserverChaos = `page_dom_churn@tick${tick}`;
            }
            card.replaceWith(replacement);
        }, 4000);
    }

    if (params.has("check")) startSelfCheck();

    /** The blocks whose status does not meet their expectation, and any violation text on the page. */
    function mismatches() {
        const found = [];
        for (const element of document.querySelectorAll("[data-expect-status]")) {
            const expected = element.dataset.expectStatus;
            const actual = element.dataset.klikkikuriStatus || "";
            if (expected === "gap") continue;
            const ok = expected === "xfail" ? actual === "" || actual === "skipped" : actual === expected;
            if (!ok) {
                found.push({
                    expected,
                    actual: actual || "(none)",
                    block: element.dataset.devserverBlock,
                    path: element.dataset.expectPath,
                    entry: element.dataset.expectEntry,
                    noise: element.dataset.devserverNoise || "",
                    chaos: element.dataset.devserverChaos || "",
                    source: element.dataset.devserverSource,
                });
            }
        }
        if (body.textContent.includes("XFAIL VIOLATED")) {
            found.push({ expected: "no 'XFAIL VIOLATED' text", actual: "found", block: "page" });
        }
        return found;
    }

    // The panel is in a shadow root under <html>, outside <body>: the content script observes <body>, and a redraw
    // that it could see would start a new conversion pass, which writes the statuses again, without end.
    function startSelfCheck() {
        const host = document.createElement("devserver-check");
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML = `<style>
            :host { all: initial; position: fixed; right: 12px; bottom: 12px; z-index: 2147483647; }
            section { font: 13px/1.4 system-ui, sans-serif; background: #fff; color: #111; border: 2px solid #111;
                      border-radius: 8px; padding: 10px 12px; max-width: 460px; max-height: 50vh; overflow: auto;
                      box-shadow: 0 4px 16px rgba(0, 0, 0, .25); }
            .ok { color: #0a6b2a; } .bad { color: #b00020; } li { margin-bottom: 6px; }
            small { color: #555; display: block; }
        </style><section><strong>Self-check</strong><div id="summary"></div><ol id="list"></ol>
        <small>Expectations hold for the default development settings only.</small></section>`;
        document.documentElement.append(host);

        let previous = "";
        const draw = () => {
            const found = mismatches();
            const key = JSON.stringify(found);
            if (key === previous) return;
            previous = key;
            const total = document.querySelectorAll("[data-expect-status]").length;
            const summary = root.getElementById("summary");
            summary.className = found.length ? "bad" : "ok";
            summary.textContent = found.length
                ? `${found.length} mismatch(es) in ${total} annotated elements`
                : `All ${total} annotated elements meet their expectation`;
            root.getElementById("list").replaceChildren(...found.slice(0, 30).map((item) => {
                const li = document.createElement("li");
                li.textContent = `${item.block}: expected ${item.expected}, got ${item.actual}`
                    + (item.path ? ` · path ${item.path}` : "") + (item.entry ? ` · ${item.entry}` : "")
                    + (item.noise ? ` · noise ${item.noise}` : "") + (item.chaos ? ` · ${item.chaos}` : "")
                    + (item.source ? ` · ${item.source}` : "");
                return li;
            }));
        };
        setInterval(draw, 1000);
        draw();
        window.devserverMismatches = mismatches;
    }
})();
