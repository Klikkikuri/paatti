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
     * Render the toggle HTML structure.
     */
    render() {
        if (this.initialized) return;
        this.initialized = true;

        const checkedAttr = this.hasAttribute('checked') ? 'checked' : '';
        const disabledAttr = this.hasAttribute('disabled') ? 'disabled' : '';
        const type = this.getAttribute('type') || 'switch'; // 'switch' (options), 'toggle' (popup)

        if (type === 'toggle') {
            // Compact layout toggle button used in the popup settings view
            this.innerHTML = `
                <input class="toggle conversion-switch" type="checkbox" ${checkedAttr} ${disabledAttr}>
            `;
        } else {
            // Standard switch layout with slider used in the options page
            this.style.display = 'inline-block';
            this.style.width = '50px';
            this.style.height = '26px';
            this.style.verticalAlign = 'middle';

            this.innerHTML = `
                <label class="toggle-switch" style="display: block; width: 100%; height: 100%;">
                    <input type="checkbox" ${checkedAttr} ${disabledAttr}>
                    <span class="toggle-slider"></span>
                </label>
            `;
        }

        const input = this.querySelector('input');
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

customElements.define('toggle-button', ToggleButton);
