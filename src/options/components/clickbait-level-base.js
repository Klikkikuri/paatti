import { onConfigValue } from '../../config.js';

/** What the slider shows when nothing is stored yet. */
const DEFAULT_LEVEL = 2;

/**
 * Abstract base class managing clickbait level options.
 * Owns the lifecycle and the config subscription; subclasses supply markup only.
 */
export class ClickbaitLevelBase extends HTMLElement {
    #unsubscribe = null;

    connectedCallback() {
        this.render();

        // Calls back at once with the stored level, then only when it moves.
        this.#unsubscribe = onConfigValue(
            (config) => config.clickbaitLevel ?? DEFAULT_LEVEL,
            (level) => this.updateUI(level)
        );
    }

    disconnectedCallback() {
        if (!this.#unsubscribe) return;

        this.#unsubscribe();
        this.#unsubscribe = null;
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
}
