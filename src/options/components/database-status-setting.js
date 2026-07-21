import { browser } from '../../utils.js';
import { controller } from '../../controller.js';
import { model } from '../../model.js';
import { getConfig } from '../../config.js';

const compactTemplate = document.createElement('template');
compactTemplate.innerHTML = `
    <div style="margin-top: 10px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div style="display: flex; flex-direction: column; gap: 4px; text-align: left;">
            <p id="database-last-updated" class="text-muted-small" style="margin: 0;"></p>
            <p id="database-generation-date" class="text-muted-small" style="margin: 0;"></p>
        </div>
        <button id="update-database-btn" class="push-button" style="margin: 0; padding: 6px 12px; min-height: 32px; font-size: 0.9em;"></button>
    </div>
`;

const detailedTemplate = document.createElement('template');
detailedTemplate.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 15px; width: 100%;">
        <!-- Refresh Interval -->
        <div class="setting-group">
            <label class="setting-label">
                <div class="label-text">
                    <strong>Automaattinen päivitysväli</strong>
                    <span>Määritä uuden datan automaattinen hakuväli minuuteissa</span>
                </div>
                <input type="number" id="refreshInterval" min="1" max="1440" value="20" style="width: 80px; padding: 8px; border: 2px solid #ddd; border-radius: 6px; font-size: 1em; text-align: center;">
            </label>
        </div>

        <!-- Manual Update & Last Updated Card -->
        <div class="setting-info-card" style="display: flex; justify-content: space-between; align-items: center;">
            <div class="label-text" style="display: flex; flex-direction: column; gap: 8px; text-align: left;">
                <div>
                    <strong style="display: block; margin-bottom: 2px;">Viimeisin haku</strong>
                    <span id="dbLastUpdatedText">Ladataan...</span>
                </div>
                <div>
                    <strong style="display: block; margin-bottom: 2px;">Tietokannan luontiaika</strong>
                    <span id="dbGenerationDateText">Ladataan...</span>
                </div>
            </div>
            <button type="button" class="btn-secondary" id="manualUpdateBtn" style="flex: 0 0 auto; width: auto; min-width: 150px; padding: 8px 16px; margin: 0;">Päivitä tietokanta</button>
        </div>
    </div>
`;

/**
 * Custom element managing uutistietokanta (news database) status display and manual updates.
 * Supports layout="compact" (popup settings view) and layout="detailed" (options page).
 */
class DatabaseStatusSetting extends HTMLElement {
    constructor() {
        super();
        this.initialized = false;
        this.storageListener = null;
    }

    connectedCallback() {
        if (this.initialized) return;
        this.initialized = true;

        const layout = this.getAttribute('layout') || 'detailed';

        if (layout === 'compact') {
            this.replaceChildren(compactTemplate.content.cloneNode(true));
            const btnText = browser().i18n.getMessage('databaseUpdateBtn') || 'Päivitä';
            const btn = this.querySelector('#update-database-btn');
            if (btn) btn.textContent = btnText;
        } else {
            this.replaceChildren(detailedTemplate.content.cloneNode(true));
        }

        this.loadState(layout);

        // Auto-sync database status when changed elsewhere
        this.storageListener = () => this.sync(layout);
        browser().storage.onChanged.addListener(this.storageListener);
    }

    disconnectedCallback() {
        if (this.storageListener) {
            browser().storage.onChanged.removeListener(this.storageListener);
        }
    }

    /**
     * Helper to format Date: returns a DOM <time> element or text node.
     * Shows only time if today, otherwise full string or date string.
     */
    formatDateOrTime(dateVal, fullStringIfOlder = true) {
        if (!dateVal) {
            const span = document.createElement('span');
            span.textContent = '-';
            return span;
        }
        const date = new Date(dateVal);
        const today = new Date();
        
        const isToday = date.getDate() === today.getDate() &&
                        date.getMonth() === today.getMonth() &&
                        date.getFullYear() === today.getFullYear();
                        
        const isoString = date.toISOString();
        const titleString = date.toLocaleString();
        
        let displayString = '';
        if (isToday) {
            displayString = date.toLocaleTimeString();
        } else {
            displayString = fullStringIfOlder ? date.toLocaleString() : date.toLocaleDateString();
        }
        
        const timeEl = document.createElement('time');
        timeEl.setAttribute('datetime', isoString);
        timeEl.title = titleString;
        timeEl.textContent = displayString;
        return timeEl;
    }

    /**
     * Helper to safely format a localized string containing placeholders with a time element.
     */
    setSafeTranslationWithTime(containerEl, messageKey, timeEl) {
        const messagePattern = browser().i18n.getMessage(messageKey, ["__PLACEHOLDER__"]);
        if (!messagePattern) {
            containerEl.replaceChildren(timeEl);
            return;
        }
        const parts = messagePattern.split("__PLACEHOLDER__");
        containerEl.replaceChildren();
        if (parts[0]) {
            containerEl.appendChild(document.createTextNode(parts[0]));
        }
        containerEl.appendChild(timeEl);
        if (parts[1]) {
            containerEl.appendChild(document.createTextNode(parts[1]));
        }
    }

    /**
     * Fetch the database details and refresh the DOM.
     */
    async sync(layout) {
        try {
            const status = await model.read.getDatabaseStatus();
            
            if (layout === 'compact') {
                const dbLastUpdatedEl = this.querySelector('#database-last-updated');
                if (dbLastUpdatedEl) {
                    if (status.lastDatabaseUpdate) {
                        const timeEl = this.formatDateOrTime(status.lastDatabaseUpdate, true);
                        this.setSafeTranslationWithTime(dbLastUpdatedEl, "databaseLastUpdated", timeEl);
                    } else {
                        dbLastUpdatedEl.textContent = browser().i18n.getMessage("databaseNeverUpdated");
                    }
                }
                const dbGenDateEl = this.querySelector('#database-generation-date');
                if (dbGenDateEl) {
                    if (status.databaseGenerationDate) {
                        const timeEl = this.formatDateOrTime(status.databaseGenerationDate, true);
                        this.setSafeTranslationWithTime(dbGenDateEl, "databaseGenerationDate", timeEl);
                    } else {
                        dbGenDateEl.textContent = browser().i18n.getMessage("databaseGenerationNever");
                    }
                }
            } else {
                const lastUpdatedEl = this.querySelector('#dbLastUpdatedText');
                const genDateEl = this.querySelector('#dbGenerationDateText');
                
                if (lastUpdatedEl) {
                    lastUpdatedEl.replaceChildren(this.formatDateOrTime(status.lastDatabaseUpdate, true));
                }
                if (genDateEl) {
                    genDateEl.replaceChildren(this.formatDateOrTime(status.databaseGenerationDate, false));
                }
            }
        } catch (e) {
            console.error('Failed to sync database status:', e);
        }
    }

    /**
     * Set up state values and manual click triggers.
     */
    async loadState(layout) {
        await this.sync(layout);

        if (layout !== 'compact') {
            // Load and bind refresh interval
            try {
                const config = await getConfig();
                const refreshIntervalInput = this.querySelector('#refreshInterval');
                if (refreshIntervalInput) {
                    refreshIntervalInput.value = config.refreshIntervalMinutes || 20;

                    refreshIntervalInput.addEventListener('change', async () => {
                        const value = parseInt(refreshIntervalInput.value);
                        if (!isNaN(value) && value >= 1) {
                            try {
                                await controller.setRefreshIntervalMinutes(value);
                                this.dispatchEvent(new CustomEvent('setting-saved', {
                                    bubbles: true,
                                    detail: { key: 'refreshInterval', value, success: true, message: 'Päivitysväli tallennettu!' }
                                }));
                            } catch (error) {
                                console.error('Error saving refresh interval:', error);
                                this.dispatchEvent(new CustomEvent('setting-saved', {
                                    bubbles: true,
                                    detail: { key: 'refreshInterval', value, success: false, message: 'Virhe tallennettaessa päivitysväliä' }
                                }));
                            }
                        } else {
                            this.dispatchEvent(new CustomEvent('setting-saved', {
                                bubbles: true,
                                detail: { key: 'refreshInterval', value, success: false, message: 'Virheellinen päivitysväli!' }
                            }));
                        }
                    });
                }
            } catch (err) {
                console.error('Failed to load refresh interval:', err);
            }
        }

        // Bind update button click handler
        const updateBtn = this.querySelector(layout === 'compact' ? '#update-database-btn' : '#manualUpdateBtn');
        if (updateBtn) {
            updateBtn.addEventListener('click', async () => {
                updateBtn.disabled = true;
                const originalText = updateBtn.textContent;
                updateBtn.textContent = layout === 'compact' ? '◦◦◦' : 'Päivitetään...';

                try {
                    const response = await browser().runtime.sendMessage({ action: 'updateDatabase' });
                    if (response && response.success) {
                        await this.sync(layout);
                        if (layout !== 'compact') {
                            this.dispatchEvent(new CustomEvent('setting-saved', {
                                bubbles: true,
                                detail: { key: 'databaseUpdate', success: true, message: 'Tietokanta päivitetty onnistuneesti!' }
                            }));
                        }
                    } else {
                        const errorMsg = response?.error || 'Tuntematon virhe';
                        if (layout !== 'compact') {
                            this.dispatchEvent(new CustomEvent('setting-saved', {
                                bubbles: true,
                                detail: { key: 'databaseUpdate', success: false, message: `Tietokannan päivitys epäonnistui: ${errorMsg}` }
                            }));
                        }
                    }
                } catch (error) {
                    console.error('Error updating database manually:', error);
                    if (layout !== 'compact') {
                        this.dispatchEvent(new CustomEvent('setting-saved', {
                            bubbles: true,
                            detail: { key: 'databaseUpdate', success: false, message: 'Tietokannan päivitys epäonnistui' }
                        }));
                    }
                } finally {
                    updateBtn.disabled = false;
                    updateBtn.textContent = originalText;
                }
            });
        }
    }
}

customElements.define('database-status-setting', DatabaseStatusSetting);
