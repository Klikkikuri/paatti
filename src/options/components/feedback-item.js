import browser from '../../browser-api.js';
import { getLogger, sanitizeUrlForFeedback } from '../../utils.js';
import { getConfig } from '../../config.js';
import { model, Clickbaitiness } from '../../model.js';

const log = getLogger('components/feedback-item');

const template = document.createElement('template');
template.innerHTML = `
    <style>
        /* Surface, border and shadow come from shared rules in
         * components.css (including .feedback-card); only this card's own layout lives here. */
        .feedback-card {
            padding: 10px;
            margin-bottom: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            list-style: none;
            text-align: left;
        }

        .feedback-row {
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding-left: 8px;
        }

        .feedback-row.original {
            border-left: 3px solid var(--color-warning);
        }

        .feedback-row.converted {
            border-left: 3px solid var(--color-success-strong);
        }

        .feedback-label {
            font-size: 0.7em;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--color-text-muted);
        }

        .feedback-text {
            font-size: 0.88em;
            color: var(--color-text-primary);
            line-height: 1.35;
            font-weight: bold;
        }

        .feedback-actions {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-top: 4px;
            min-height: 24px;
        }

        /* Smaller than a regular push button, so it casts and travels less. */
        .feedback-action-btn {
            --push-offset: 2px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            cursor: pointer;
            font-family: inherit;
        }

        .feedback-action-btn.good:hover {
            background: var(--feedback-vote-yes-bg) !important;
            outline-color: var(--color-success-strong) !important;
            color: var(--feedback-vote-yes-text) !important;
        }

        .feedback-action-btn.bad:hover {
            background: var(--feedback-vote-no-bg) !important;
            outline-color: var(--color-danger-strong) !important;
            color: var(--feedback-vote-no-text) !important;
        }

        .feedback-input-container {
            margin-top: 4px;
            width: 100%;
            box-sizing: border-box;
        }

        .feedback-input-group {
            display: flex;
            width: 100%;
            box-sizing: border-box;
            border: 1px solid var(--color-border-strong);
            border-radius: 6px;
            overflow: hidden;
            background: var(--color-surface);
            box-shadow: inset 0 1px 3px var(--shadow-ambient);
        }

        .feedback-text-input {
            flex: 1;
            padding: 6px 10px;
            font-size: 0.85em;
            border: none;
            outline: none;
            background: transparent;
            color: var(--color-text-primary);
            box-sizing: border-box;
        }

        .feedback-submit-button {
            background: var(--push-bg);
            border: none;
            border-left: 1px solid var(--color-border-strong);
            color: var(--color-text-primary);
            padding: 6px 12px;
            font-size: 0.8em;
            font-weight: bold;
            cursor: pointer;
        }

        .feedback-submit-button:hover {
            background: var(--color-info);
            color: var(--color-on-accent);
        }

        /* Colours per level come from theme.css via the [data-level] rules in
         * styles.css; this element only carries layout. */
        .clickbait-level-badge {
            display: inline-flex;
            align-items: center;
            padding: 1px 6px;
            border-radius: 4px;
            font-size: 0.6em;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            line-height: 1;
        }
    </style>
    
    <li class="feedback-card">
        <div class="current-page-container" style="display: flex; align-items: center; margin-bottom: 4px;">
            <span class="current-page-tag" style="font-size: 0.72em; color: var(--feedback-tag); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 4px;">
                📌 <span class="current-page-label-text"></span>
            </span>
        </div>

        <div class="feedback-row original">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                <span class="feedback-label original-label-text"></span>
                <span class="clickbait-level-badge"></span>
            </div>
            <span class="feedback-text original-title-text"></span>
        </div>
        <div class="feedback-row converted">
            <span class="feedback-label converted-label-text"></span>
            <span class="feedback-text converted-title-text"></span>
        </div>
        
        <hr style="border: 0; border-top: 1px solid var(--color-border-strong); margin: 4px 0;">
        
        <div class="feedback-actions">
            <button class="push-button feedback-action-btn good" style="margin: 0; padding: 4px 8px; font-size: 0.8em; min-width: 80px;"></button>
            <button class="push-button feedback-action-btn bad" style="margin: 0; padding: 4px 8px; font-size: 0.8em; min-width: 80px;"></button>
        </div>
        
        <div class="feedback-input-container hidden">
            <div class="feedback-input-group">
                <input type="text" class="feedback-text-input">
                <button class="feedback-submit-button"></button>
            </div>
        </div>
    </li>
`;

/**
 * Custom element representing a single feedback rating row for converted clickbait titles.
 * Features a modern, highly aesthetic card layout with left-border indicators.
 */
class FeedbackItem extends HTMLElement {
    constructor() {
        super();
        this._item = null;
        this._tab = null;
        this.initialized = false;
    }

    set item(val) {
        this._item = val;
        if (this.initialized) {
            this.render();
        }
    }

    get item() {
        return this._item;
    }

    set activeTab(val) {
        this._tab = val;
    }

    get activeTab() {
        return this._tab;
    }

    connectedCallback() {
        this.initialized = true;
        this.render();
    }

    disconnectedCallback() {
        if (this._outsideClickListener) {
            document.removeEventListener("click", this._outsideClickListener);
        }
    }

    /**
     * Resolve a clickbait level (numeric or Clickbaitiness level string) to a
     * localized badge label and a numeric level used as the CSS colour key.
     *
     * @param {number|string} level - Clickbait level as stored on the item.
     * @returns {{text: string, level: number}} Badge label and normalized level.
     */
    getClickbaitBadgeInfo(level) {
        // Fallbacks mirror _locales/en, the manifest default_locale, so a missing
        // translation degrades to English instead of to the UI language of the day.
        const FALLBACKS = ["Neutral", "Low", "Medium", "High", "Extreme"];

        let index = Clickbaitiness.stringToNumber(level);
        if (index < 0) {
            index = Number.parseInt(level, 10);
        }
        // Anything unrecognised is treated as the most severe level, matching
        // the previous `default:` branch.
        if (!Number.isInteger(index) || index < 0 || index >= FALLBACKS.length) {
            index = FALLBACKS.length - 1;
        }

        const text = browser.i18n.getMessage(`clickbaitBadgeLevel${index}`) || FALLBACKS[index];
        return { text, level: index };
    }

    render() {
        if (!this._item) return;

        this.replaceChildren(template.content.cloneNode(true));

        const currentPageContainer = this.querySelector('.current-page-container');
        if (this._item.isMainPage) {
            const currentPageLabelText = this.querySelector('.current-page-label-text');
            if (currentPageLabelText) {
                currentPageLabelText.textContent = browser.i18n.getMessage("feedbackviewCurrentPageLabel") || "Current page";
            }
        } else if (currentPageContainer) {
            currentPageContainer.remove();
        }

        const origLabel = browser.i18n.getMessage("feedbackviewRateTitleOriginalTitleLabel") || "Original:";
        const badge = this.getClickbaitBadgeInfo(this._item.clickbaitLevel || 0);

        const convLabel = browser.i18n.getMessage("feedbackviewRateTitleConvertedTitleLabel") || "Aligned:";
        const placeholderText = browser.i18n.getMessage("feedbackviewReportCommentPlaceholder") || "Describe the issue...";
        const goodBtnText = "👍 " + (browser.i18n.getMessage("feedbackviewRateTitleConversionIsGood") || "Is good");
        const badBtnText = "👎 " + (browser.i18n.getMessage("feedbackviewRateTitleConversionIsBad") || "Is no good");
        const submitBtnText = browser.i18n.getMessage("feedbackviewReportSubmitBtn") || "Submit";

        const originalLabelEl = this.querySelector('.original-label-text');
        if (originalLabelEl) originalLabelEl.textContent = origLabel;

        const badgeEl = this.querySelector('.clickbait-level-badge');
        if (badgeEl) {
            badgeEl.textContent = badge.text;
            badgeEl.dataset.level = String(badge.level);
        }

        const originalTitleEl = this.querySelector('.original-title-text');
        if (originalTitleEl) originalTitleEl.textContent = this._item.originalTitle;

        const convertedLabelEl = this.querySelector('.converted-label-text');
        if (convertedLabelEl) convertedLabelEl.textContent = convLabel;

        const convertedTitleEl = this.querySelector('.converted-title-text');
        if (convertedTitleEl) convertedTitleEl.textContent = this._item.convertedTitle;

        const goodBtn = this.querySelector('.feedback-action-btn.good');
        if (goodBtn) goodBtn.textContent = goodBtnText;

        const badBtn = this.querySelector('.feedback-action-btn.bad');
        if (badBtn) badBtn.textContent = badBtnText;

        const textInput = this.querySelector('.feedback-text-input');
        if (textInput) textInput.placeholder = placeholderText;

        const submitBtn = this.querySelector('.feedback-submit-button');
        if (submitBtn) submitBtn.textContent = submitBtnText;

        this.setupHandlers();
    }


    setupHandlers() {
        const buttonsDiv = this.querySelector(".feedback-actions");
        const formDiv = this.querySelector(".feedback-input-container");
        const feedbackInput = this.querySelector(".feedback-text-input");
        
        const goodBtn = this.querySelector(".feedback-action-btn.good");
        const badBtn = this.querySelector(".feedback-action-btn.bad");
        const submitBtn = this.querySelector(".feedback-submit-button");
        const feedbackItemEl = this.querySelector(".feedback-card");

        const submitFeedback = async (type, comment = "") => {
            let feedbackServerUrl = "https://api.klikkikuri.fi/v1/feedback";
            try {
                const config = await getConfig();
                if (config && config.feedbackServerUrl) {
                    feedbackServerUrl = config.feedbackServerUrl;
                }
            } catch (err) {
                log("Error loading config for feedback server URL:", err);
            }

            const dbStatus = await model.read.getDatabaseStatus();
            const databaseUpdated = dbStatus.lastDatabaseUpdate ? new Date(dbStatus.lastDatabaseUpdate).toISOString() : "Unknown";
            const commentVal = comment.trim() || "-";

            const rawPageUrl = this._tab?.url || "";
            const pageUrl = sanitizeUrlForFeedback(rawPageUrl);
            const urlSign = this._item.urlSign || "";
            const originalTitle = this._item.originalTitle || "";
            const convertedTitle = this._item.convertedTitle || "";
            const clickbaitLevel = (this._item.clickbaitLevel !== undefined && this._item.clickbaitLevel !== null) ? String(this._item.clickbaitLevel) : "";

            if (!pageUrl || !urlSign || !originalTitle || !convertedTitle || clickbaitLevel === "" || !type || !commentVal || !databaseUpdated) {
                log("Validation failed: missing required feedback fields", {
                    pageUrl,
                    urlSign,
                    originalTitle,
                    convertedTitle,
                    clickbaitLevel,
                    type,
                    commentVal,
                    databaseUpdated
                });
                return false;
            }

            const isGoogleForm = feedbackServerUrl.includes("docs.google.com/forms");

            try {
                if (isGoogleForm) {
                    let postUrl = feedbackServerUrl;
                    if (postUrl.endsWith("/viewform")) {
                        postUrl = postUrl.replace("/viewform", "/formResponse");
                    } else if (!postUrl.endsWith("/formResponse")) {
                        if (postUrl.endsWith("/")) {
                            postUrl += "formResponse";
                        } else {
                            postUrl += "/formResponse";
                        }
                    }

                    const formData = new URLSearchParams();
                    formData.append("entry.1944615860", pageUrl);
                    formData.append("entry.1369854914", urlSign);
                    formData.append("entry.917360051", originalTitle);
                    formData.append("entry.1935829065", convertedTitle);
                    formData.append("entry.1807257025", clickbaitLevel);
                    formData.append("entry.167673994", type);
                    formData.append("entry.78795748", commentVal);
                    formData.append("entry.364993842", databaseUpdated);

                    await fetch(postUrl, {
                        method: "POST",
                        mode: "no-cors",
                        referrerPolicy: "no-referrer",
                        credentials: "omit",
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded"
                        },
                        body: formData.toString()
                    });
                } else {
                    const payload = {
                        timestamp: new Date().toISOString(),
                        pageUrl: pageUrl,
                        urlSign: urlSign,
                        originalTitle: originalTitle,
                        convertedTitle: convertedTitle,
                        clickbaitLevel: this._item.clickbaitLevel,
                        feedbackType: type,
                        comment: comment,
                        databaseUpdated: databaseUpdated
                    };

                    await fetch(feedbackServerUrl, {
                        method: "POST",
                        mode: "no-cors",
                        referrerPolicy: "no-referrer",
                        credentials: "omit",
                        headers: {
                            "Content-Type": "text/plain"
                        },
                        body: JSON.stringify(payload)
                    });
                }
                return true;
            } catch (err) {
                log("Failed to submit feedback:", err);
                return false;
            }
        };

        const setFeedbackStatus = (text, color, isBold) => {
            buttonsDiv.textContent = "";
            const span = document.createElement("span");
            span.style.color = color;
            span.style.fontSize = "0.85em";
            if (isBold) {
                span.style.fontWeight = "bold";
            }
            span.textContent = text;
            buttonsDiv.appendChild(span);
        };

        goodBtn.addEventListener("click", async () => {
            setFeedbackStatus("...", "var(--color-text-secondary)", false);
            const success = await submitFeedback("good_conversion");
            if (success) {
                setFeedbackStatus(browser.i18n.getMessage("feedbackviewReportSuccess") || "✓ Feedback submitted!", "var(--color-success-strong)", true);
            } else {
                setFeedbackStatus(browser.i18n.getMessage("feedbackviewReportFailure") || "✗ Failed to send report.", "var(--color-danger-strong)", true);
            }
        });

        const cancelFlow = () => {
            formDiv.classList.add("hidden");
            buttonsDiv.style.display = "flex";
            feedbackInput.value = "";
        };

        const triggerSubmit = async () => {
            if (!feedbackInput.value.trim()) return;
            feedbackInput.disabled = true;
            submitBtn.disabled = true;
            submitBtn.textContent = "...";

            const success = await submitFeedback("bad_conversion", feedbackInput.value);

            formDiv.classList.add("hidden");
            buttonsDiv.style.display = "flex";
            if (success) {
                setFeedbackStatus(browser.i18n.getMessage("feedbackviewReportSuccess") || "✓ Feedback submitted!", "var(--color-success-strong)", true);
            } else {
                setFeedbackStatus(browser.i18n.getMessage("feedbackviewReportFailure") || "✗ Failed to send report.", "var(--color-danger-strong)", true);
            }
        };

        badBtn.addEventListener("click", () => {
            buttonsDiv.style.display = "none";
            formDiv.classList.remove("hidden");
            feedbackInput.focus();
        });

        feedbackInput.addEventListener("keydown", async (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                await triggerSubmit();
            } else if (e.key === "Escape") {
                e.preventDefault();
                cancelFlow();
            }
        });

        submitBtn.addEventListener("click", triggerSubmit);

        // Click outside listener
        const onOutsideClick = (e) => {
            if (!formDiv.classList.contains("hidden") && !this.contains(e.target)) {
                cancelFlow();
            }
        };
        this._outsideClickListener = onOutsideClick;
        document.addEventListener("click", onOutsideClick);

        // Hover highlighting listener
        if (feedbackItemEl && this._item.highlightId) {
            feedbackItemEl.addEventListener("mouseenter", () => {
                if (this._tab) {
                    browser.tabs.sendMessage(this._tab.id, {
                        command: "highlightElement",
                        highlightId: this._item.highlightId
                    }).catch((err) => log("Failed to send highlight message:", err));
                }
            });
            feedbackItemEl.addEventListener("mouseleave", () => {
                if (this._tab) {
                    browser.tabs.sendMessage(this._tab.id, {
                        command: "unhighlightElement",
                        highlightId: this._item.highlightId
                    }).catch((err) => log("Failed to send unhighlight message:", err));
                }
            });
        }
    }
}

customElements.define('feedback-item', FeedbackItem);
