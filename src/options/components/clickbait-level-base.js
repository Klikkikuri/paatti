import { browser } from '../../utils.js';
import { getConfig } from '../../config.js';

/**
 * Abstract base class managing clickbait level options.
 * Handles lifecycle callbacks, initial loads, and background storage syncs.
 */
export class ClickbaitLevelBase extends HTMLElement {
    constructor() {
        super();
        this.initialized = false;
        this.storageListener = null;
    }

    connectedCallback() {
        if (this.initialized) return;
        this.initialized = true;

        this.render();
        this.loadState();

        this.storageListener = () => this.sync();
        browser().storage.onChanged.addListener(this.storageListener);
    }

    disconnectedCallback() {
        if (this.storageListener) {
            browser().storage.onChanged.removeListener(this.storageListener);
        }
    }

    /**
     * Fetch active level from configuration.
     */
    async getActiveLevel() {
        const config = await getConfig();
        return config.clickbaitLevel !== undefined ? config.clickbaitLevel : 2;
    }

    /**
     * Sync state in UI.
     */
    async sync() {
        const level = await this.getActiveLevel();
        this.updateUI(level);
    }

    /**
     * To be overridden by subclasses.
     */
    render() {
        throw new Error("render() must be implemented by subclass");
    }

    /**
     * To be overridden by subclasses.
     */
    updateUI(level) {
        throw new Error("updateUI() must be implemented by subclass");
    }

    /**
     * Fetch initial values.
     */
    async loadState() {
        await this.sync();
    }
}
