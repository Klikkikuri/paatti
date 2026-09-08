import { onConfigValue } from '../../config.js';
import { controller } from '../../controller.js';
import { localizeDocument } from '../utils.js';
import { adoptComponentStyleSheet, ComponentBase } from './component-utils.js';

adoptComponentStyleSheet(new URL('./clickbait-level-base.css', import.meta.url));

/** What the slider shows when nothing is stored yet. */
const DEFAULT_LEVEL = 2;

/** The only level that also replaces the headlines rated as carrying no clickbait. */
const WARNED_LEVEL = 0;

// English text between the tags on purpose: localizeDocument overwrites only when the lookup
// finds something, so a missing key would otherwise leave an unlabelled dismiss button.
const warningTemplate = document.createElement('template');
warningTemplate.innerHTML = `
    <div class="level-warning hidden" role="note">
        <strong class="level-warning-title" data-i18n="clickbaitLevelWarningTitle">Also replaces neutral headlines</strong>
        <span class="level-warning-text text-muted-small" data-i18n="clickbaitLevelWarningText">Klikkikuri rated these headlines as neutral, with no clickbait in them. At this level Paatti replaces them too. You lose the wording of the news site and remove no more clickbait.</span>
        <button type="button" class="level-warning-dismiss push-button" data-i18n="clickbaitLevelWarningDismiss">Got it</button>
    </div>
`;

/**
 * Abstract base class managing clickbait level options.
 * Owns the lifecycle, the config subscription and the "all headlines" warning; subclasses supply the slider.
 */
export class ClickbaitLevelBase extends ComponentBase {
    onConnect() {
        this.render();

        // After render(), which replaces the children: the panel belongs to the base, not to either slider.
        const warning = warningTemplate.content.cloneNode(true).firstElementChild;
        localizeDocument(warning);
        this.append(warning);

        warning.querySelector('.level-warning-dismiss')
            .addEventListener('click', () => this.dismissWarning(), { signal: this.signal });

        // Calls back at once with what is stored, then only when one of the two moves.
        this.addTeardown(onConfigValue(
            (config) => [config.clickbaitLevel ?? DEFAULT_LEVEL, config.clickbaitLevelWarningSeen === true],
            ([level, seen]) => {
                this.updateUI(level);
                warning.classList.toggle('hidden', seen || level !== WARNED_LEVEL);
            }
        ));
    }

    /**
     * Store the acknowledgement. The subscription takes the panel away once the write lands,
     * so a failed write leaves the panel up and the button ready to try again.
     */
    async dismissWarning() {
        try {
            await controller.acknowledgeClickbaitLevelWarning();
            // Focus leaves before the panel does, or it falls to <body>.
            if (this.isConnected) this.querySelector('input[type="range"]')?.focus();
        } catch (err) {
            console.error('Failed to store the clickbait level warning acknowledgement:', err);
        }
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
