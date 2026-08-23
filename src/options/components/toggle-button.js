import { adoptComponentStyleSheet, defineComponent } from './component-utils.js';

// This element's CSS is nobody else's business, so it travels with the component: a page
// gets the styling by importing this module and nothing more.
adoptComponentStyleSheet(new URL('./toggle-button.css', import.meta.url));

const toggleTemplate = document.createElement('template');
toggleTemplate.innerHTML = `<input class="toggle conversion-switch" type="checkbox">`;

const switchTemplate = document.createElement('template');
switchTemplate.innerHTML = `
    <label class="toggle-switch">
        <input type="checkbox">
        <span class="toggle-slider"></span>
    </label>
`;

/**
 * Reusable, generic toggle button Web Component.
 * Supports 'switch' layout (slider) and 'toggle' layout (checkbox).
 */
export class ToggleButton extends HTMLElement {
    static get observedAttributes() {
        return ['checked', 'disabled', 'type'];
    }

    constructor() {
        super();
        this.initialized = false;
    }

    connectedCallback() {
        this.render();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (!this.initialized) return;
        const input = this.querySelector('input');
        if (!input) return;

        if (name === 'checked') {
            input.checked = this.hasAttribute('checked');
        } else if (name === 'disabled') {
            input.disabled = this.hasAttribute('disabled');
        }
    }

    /**
     * Checked state getter.
     */
    get checked() {
        this.render();
        const input = this.querySelector('input');
        return input ? input.checked : this.hasAttribute('checked');
    }

    /**
     * Checked state setter.
     */
    set checked(val) {
        this.render();
        const input = this.querySelector('input');
        if (input) {
            input.checked = val;
        }
        if (val) {
            this.setAttribute('checked', '');
        } else {
            this.removeAttribute('checked');
        }
    }

    /**
     * Disabled state getter.
     */
    get disabled() {
        this.render();
        const input = this.querySelector('input');
        return input ? input.disabled : this.hasAttribute('disabled');
    }

    /**
     * Disabled state setter.
     */
    set disabled(val) {
        this.render();
        const input = this.querySelector('input');
        if (input) {
            input.disabled = val;
        }
        if (val) {
            this.setAttribute('disabled', '');
        } else {
            this.removeAttribute('disabled');
        }
    }

    /**
     * Flip the control as a user click would, so the change and the toggle-change event
     * come from the component itself rather than being hand-built by a caller.
     */
    toggle() {
        this.render();
        this.querySelector('input')?.click();
    }

    /**
     * Render the toggle HTML structure.
     */
    render() {
        if (this.initialized) return;
        this.initialized = true;

        const type = this.getAttribute('type') || 'switch'; // 'switch' (options), 'toggle' (popup)

        if (type === 'toggle') {
            // Compact layout toggle button used in the popup settings view
            this.replaceChildren(toggleTemplate.content.cloneNode(true));
        } else {
            // Standard switch layout with slider used in the options page
            this.replaceChildren(switchTemplate.content.cloneNode(true));
        }

        const input = this.querySelector('input');
        if (input) {
            input.checked = this.hasAttribute('checked');
            input.disabled = this.hasAttribute('disabled');
            input.addEventListener('change', () => {
                if (input.checked) {
                    this.setAttribute('checked', '');
                } else {
                    this.removeAttribute('checked');
                }
                this.dispatchEvent(new CustomEvent('toggle-change', {
                    bubbles: true,
                    detail: { checked: input.checked }
                }));
            });
        }
    }
}

defineComponent('toggle-button', ToggleButton);
