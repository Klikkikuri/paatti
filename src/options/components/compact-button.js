import { browser } from '../../utils.js';

/**
 * Reusable, compact circular button Web Component.
 * Renders a small circular icon button using the shared .compact-button style.
 */
const template = document.createElement('template');
template.innerHTML = `
    <button class="push-button compact-button" style="margin: 0; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
        <img class="icon" height="15">
    </button>
`;

export class CompactButton extends HTMLElement {
    static get observedAttributes() {
        return ['icon', 'alt', 'title'];
    }

    constructor() {
        super();
        this.initialized = false;
    }

    connectedCallback() {
        this.style.display = 'inline-block';
        this.style.width = '30px';
        this.style.height = '30px';
        this.render();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (!this.initialized) return;
        this.render();
    }

    render() {
        if (!this.initialized) {
            this.replaceChildren(template.content.cloneNode(true));
            this.initialized = true;
        }

        const button = this.querySelector('button');
        const img = this.querySelector('img');
        if (button) {
            button.title = this.getAttribute('title') || '';
        }
        if (img) {
            img.src = this.getAttribute('icon') || '';
            img.alt = this.getAttribute('alt') || '';
        }
    }
}

customElements.define('compact-button', CompactButton);
