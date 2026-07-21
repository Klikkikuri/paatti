import { browser, getLogger } from '../../utils.js';
import { getConfig } from '../../config.js';
import { model } from '../../model.js';

const log = getLogger('components/feedback-item');

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

    render() {
        if (!this._item) return;

        const origLabel = browser().i18n.getMessage("feedbackviewRateTitleOriginalTitleLabel") || "Alkuperäinen";

        const convLabel = browser().i18n.getMessage("feedbackviewRateTitleConvertedTitleLabel") || "Klikkiotsikko korjattu";
        const placeholderText = browser().i18n.getMessage("feedbackviewReportCommentPlaceholder") || "Mitä otsikossa pitäisi lukea?";
        const goodBtnText = "👍 " + (browser().i18n.getMessage("feedbackviewRateTitleConversionIsGood") || "Hyvä korjaus");
        const badBtnText = "👎 " + (browser().i18n.getMessage("feedbackviewRateTitleConversionIsBad") || "Huono korjaus");
        const submitBtnText = browser().i18n.getMessage("feedbackviewReportSubmitBtn") || "Lähetä";
        const cancelBtnText = "Peruuta";

        this.innerHTML = `
            <style>
                .feedback-card {
                    background: #ffffff;
                    border: 1px solid #eef2f6;
                    border-radius: 12px;
                    padding: 16px;
                    margin-bottom: 12px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
                    transition: all 0.2s ease-in-out;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    list-style: none;
                    text-align: left;
                }

                .feedback-card:hover {
                    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.05);
                    border-color: #cbd5e1;
                    transform: translateY(-1px);
                }

                .feedback-row {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    padding-left: 12px;
                }

                .feedback-row.original {
                    border-left: 3px solid #ff9f43;
                }

                .feedback-row.converted {
                    border-left: 3px solid #10b981;
                }

                .feedback-label {
                    font-size: 0.72em;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                    color: #94a3b8;
                }

                .feedback-text {
                    font-size: 0.92em;
                    color: #1e293b;
                    line-height: 1.4;
                    font-weight: 500;
                }

                .feedback-actions {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin-top: 4px;
                    min-height: 32px;
                }

                .feedback-action-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    padding: 6px 12px;
                    border-radius: 8px;
                    font-size: 0.82em;
                    font-weight: 600;
                    cursor: pointer;
                    border: 1px solid #e2e8f0;
                    background: #f8fafc;
                    color: #475569;
                    transition: all 0.15s ease;
                }

                .feedback-action-btn.good:hover {
                    background: #ecfdf5;
                    border-color: #a7f3d0;
                    color: #065f46;
                }

                .feedback-action-btn.bad:hover {
                    background: #fef2f2;
                    border-color: #fecaca;
                    color: #991b1b;
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
                    border: 1px solid #cbd5e1;
                    border-radius: 8px;
                    overflow: hidden;
                    background: #ffffff;
                    transition: border-color 0.2s ease, box-shadow 0.2s ease;
                }

                .feedback-input-group:focus-within {
                    border-color: #6366f1;
                    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
                }

                .feedback-text-input {
                    flex: 1;
                    padding: 8px 12px;
                    font-size: 0.88em;
                    border: none;
                    outline: none;
                    background: transparent;
                    color: #1e293b;
                    box-sizing: border-box;
                }

                .feedback-submit-button {
                    background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    font-size: 0.85em;
                    font-weight: 600;
                    cursor: pointer;
                    transition: opacity 0.2s ease;
                    border-radius: 0;
                }

                .feedback-submit-button:hover {
                    opacity: 0.95;
                }

                .current-page-badge {
                    display: inline-flex;
                    align-items: center;
                    padding: 2px 8px;
                    border-radius: 12px;
                    font-size: 0.65em;
                    font-weight: 800;
                    text-transform: uppercase;
                    background: #e0e7ff;
                    color: #4f46e5;
                    border: 1px solid #c7d2fe;
                    letter-spacing: 0.05em;
                    line-height: 1;
                }
            </style>
            
            <li class="feedback-card">
                <div class="feedback-row original">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <span class="feedback-label">${origLabel}</span>
                        ${this._item.isMainPage ? `<span class="current-page-badge">${browser().i18n.getMessage("feedbackviewCurrentPageLabel") || "nykyinen sivu"}</span>` : ''}
                    </div>
                    <span class="feedback-text">${this._item.originalTitle}</span>
                </div>
                <div class="feedback-row converted">
                    <span class="feedback-label">${convLabel}</span>
                    <span class="feedback-text">${this._item.convertedTitle}</span>
                </div>
                
                <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 4px 0;">
                
                <div class="feedback-actions">
                    <button class="feedback-action-btn good">${goodBtnText}</button>
                    <button class="feedback-action-btn bad">${badBtnText}</button>
                </div>
                
                <div class="feedback-input-container hidden">
                    <div class="feedback-input-group">
                        <input type="text" class="feedback-text-input" placeholder="${placeholderText}">
                        <button class="feedback-submit-button">${submitBtnText}</button>
                    </div>
                </div>
            </li>
        `;

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

            const pageUrl = this._tab?.url || "";
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
            setFeedbackStatus("...", "#666", false);
            const success = await submitFeedback("good_conversion");
            if (success) {
                setFeedbackStatus(browser().i18n.getMessage("feedbackviewReportSuccess") || "Kiitos palautteesta!", "#10b981", true);
            } else {
                setFeedbackStatus(browser().i18n.getMessage("feedbackviewReportFailure") || "Lähetys epäonnistui", "#ef4444", true);
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
                setFeedbackStatus(browser().i18n.getMessage("feedbackviewReportSuccess") || "Kiitos palautteesta!", "#10b981", true);
            } else {
                setFeedbackStatus(browser().i18n.getMessage("feedbackviewReportFailure") || "Lähetys epäonnistui", "#ef4444", true);
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
                    browser().tabs.sendMessage(this._tab.id, {
                        command: "highlightElement",
                        highlightId: this._item.highlightId
                    }).catch((err) => log("Failed to send highlight message:", err));
                }
            });
            feedbackItemEl.addEventListener("mouseleave", () => {
                if (this._tab) {
                    browser().tabs.sendMessage(this._tab.id, {
                        command: "unhighlightElement",
                        highlightId: this._item.highlightId
                    }).catch((err) => log("Failed to send unhighlight message:", err));
                }
            });
        }
    }
}

customElements.define('feedback-item', FeedbackItem);
