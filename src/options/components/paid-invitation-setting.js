import browser from '../../browser-api.js';
import { model } from '../../model.js';
import { onConfigValue } from '../../config.js';
import { localizeDocument } from '../utils.js';
import { registerInvitation } from '../invitation.js';
import { ComponentBase, defineComponent, emitSettingSaved, adoptComponentStyleSheet } from './component-utils.js';

adoptComponentStyleSheet(new URL('./paid-invitation-setting.css', import.meta.url));

/** How long the Send button shows that the address went out. */
const SENT_MS = 3300;

const template = document.createElement('template');
template.innerHTML = `
    <p class="invitation-description" data-i18n="invitationDesc">The paid version is not yet available. Enter your email address to receive an invitation when it launches.</p>
    <div class="email-input-wrapper input-group">
        <div class="email-icon">
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                <path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="m3.5 5.5 7.893 6.036a1 1 0 0 0 1.214 0L20.5 5.5M4 19h16a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1Z"/>
            </svg>
        </div>
        <input type="email" placeholder="Email address" data-i18n-placeholder="invitationEmailPlaceholder" data-i18n-aria-label="invitationEmailPlaceholder" aria-label="Email address">
        <button type="button" class="email-submit-btn" data-i18n="invitationSubmitBtn">Send</button>
    </div>
    <p class="invitation-status" role="status"></p>
`;

/**
 * The waitlist sign-up for the paid version: an email field and a Send button. The address goes to the waitlist
 * form and, once that has gone out, to the settings of the `paid` environment.
 *
 * The heading belongs to the page that shows it. A success is announced as `setting-saved`; an error or a missing
 * address is shown in the status line of the component itself, because not every page has a status area.
 */
class PaidInvitationSetting extends ComponentBase {
    #input;
    #button;
    #status;

    onConnect() {
        this.replaceChildren(template.content.cloneNode(true));
        localizeDocument(this);

        this.#input = this.querySelector('input');
        this.#button = this.querySelector('.email-submit-btn');
        this.#status = this.querySelector('.invitation-status');
        this.#syncButton();

        const { signal } = this;
        this.#input.addEventListener('input', () => this.#syncButton(), { signal });
        this.#input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            this.#submit();
        }, { signal });
        this.#button.addEventListener('click', () => this.#submit(), { signal });

        // The saved address fills the field, unless the user is typing in it.
        this.addTeardown(onConfigValue((config) => config.environmentConfigs?.paid?.email ?? '', (email) => {
            if (document.activeElement === this.#input) return;
            this.#input.value = email;
            this.#syncButton();
        }));
    }

    #syncButton() {
        const value = this.#input.value.trim();
        this.#button.disabled = value === '' || this.#input.validity.typeMismatch;
    }

    #show(text, isError = false) {
        this.#status.textContent = text;
        this.#status.classList.toggle('error', isError);
    }

    async #submit() {
        const email = this.#input.value.trim();
        if (!email) {
            this.#show(browser.i18n.getMessage('invitationEmailRequired') || 'Please enter an email address', true);
            return;
        }

        const label = this.#button.textContent;
        this.#button.disabled = true;
        this.#button.textContent = browser.i18n.getMessage('invitationEmailSending') || 'Sending...';
        this.#show('');

        try {
            await registerInvitation(email);
            await model.write.setEmail(email, 'paid');
        } catch (error) {
            console.error('Error registering email:', error);
            this.#button.textContent = label;
            this.#syncButton();
            this.#show(browser.i18n.getMessage('invitationEmailError') || 'Error registering email', true);
            return;
        }

        this.#button.textContent = browser.i18n.getMessage('invitationEmailSent') || '✓ Sent';
        this.#button.classList.add('success');
        this.#show(browser.i18n.getMessage('invitationEmailSuccess') || 'Email registered successfully!');
        emitSettingSaved(this, {
            key: 'email',
            value: email,
            messageKey: 'invitationEmailSuccess',
            fallback: 'Email registered successfully!',
        });

        setTimeout(() => {
            if (!this.isConnected) return;
            this.#button.textContent = label;
            this.#button.classList.remove('success');
            this.#syncButton();
        }, SENT_MS);
    }
}

defineComponent('paid-invitation-setting', PaidInvitationSetting);
