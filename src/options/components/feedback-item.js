import browser from '../../browser-api.js';
import { getLogger, sanitizeUrlForFeedback } from '../../utils.js';
import { getConfig } from '../../config.js';
import { model, Clickbaitiness } from '../../model.js';
import { adoptComponentStyleSheet, defineComponent } from './component-utils.js';

adoptComponentStyleSheet(new URL('./feedback-item.css', import.meta.url));

const log = getLogger('components/feedback-item');

const template = document.createElement('template');
template.innerHTML = `
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
    /** Aborted on re-render and on detach, dropping every listener the last render added. */
    #listeners = null;

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
        this.#listeners?.abort();
        this.#listeners = null;
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

        // Drop the previous render's listeners before wiring new ones: the document-level
        // one below outlives the markup this replaces.
        this.#listeners?.abort();
        this.#listeners = new AbortController();

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
        const { signal } = this.#listeners;

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
        }, { signal });

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
        }, { signal });

        feedbackInput.addEventListener("keydown", async (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                await triggerSubmit();
            } else if (e.key === "Escape") {
                e.preventDefault();
                cancelFlow();
            }
        }, { signal });

        submitBtn.addEventListener("click", triggerSubmit, { signal });

        document.addEventListener("click", (e) => {
            if (!formDiv.classList.contains("hidden") && !this.contains(e.target)) {
                cancelFlow();
            }
        }, { signal });

        // Hover highlighting listener
        if (feedbackItemEl && this._item.highlightId) {
            feedbackItemEl.addEventListener("mouseenter", () => {
                if (this._tab) {
                    browser.tabs.sendMessage(this._tab.id, {
                        command: "highlightElement",
                        highlightId: this._item.highlightId
                    }).catch((err) => log("Failed to send highlight message:", err));
                }
            }, { signal });
            feedbackItemEl.addEventListener("mouseleave", () => {
                if (this._tab) {
                    browser.tabs.sendMessage(this._tab.id, {
                        command: "unhighlightElement",
                        highlightId: this._item.highlightId
                    }).catch((err) => log("Failed to send unhighlight message:", err));
                }
            }, { signal });
        }
    }
}

defineComponent('feedback-item', FeedbackItem);
