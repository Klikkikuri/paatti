import { ClickbaitLevelBase } from './clickbait-level-base.js';
import { controller } from '../../controller.js';
import { getClickbaitLevelInfo } from '../utils.js';

/**
 * Detailed vertical clickbait level slider custom element for options view.
 * Inherits storage loading and onChanged synchronization hooks from ClickbaitLevelBase.
 */
class ClickbaitLevelVertical extends ClickbaitLevelBase {
    render() {
        const levels = [4, 3, 2, 1, 0];
        let labelsHtml = '';
        for (const lvl of levels) {
            const info = getClickbaitLevelInfo(lvl);
            labelsHtml += `
                <label for="clickbait-slider" data-value="${lvl}">
                    <span class="label-title">${info.title}</span>
                    <span class="label-description">${info.description}</span>
                </label>
            `;
        }

        this.innerHTML = `
            <div class="setting-group" style="display: flex; flex-direction: column; gap: 15px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                <div class="slider-wrapper">
                    <div class="slider-gauge">
                        <input type="range" id="clickbait-slider" min="0" max="4" step="1" value="2" orient="vertical">
                    </div>
                    <div class="slider-labels">
                        ${labelsHtml}
                    </div>
                </div>
            </div>
        `;

        const slider = this.querySelector('#clickbait-slider');
        slider.addEventListener('change', async () => {
            const value = parseInt(slider.value);
            if (!isNaN(value)) {
                await controller.setClickbaitLevel(value);
                this.dispatchEvent(new CustomEvent('setting-saved', {
                    bubbles: true,
                    detail: { key: 'clickbaitLevel', value, success: true, message: 'Asetus tallennettu!' }
                }));
            }
        });

        // Make slider labels clickable
        this.querySelectorAll('.slider-labels label').forEach(label => {
            label.addEventListener('click', async (e) => {
                e.preventDefault(); // Prevent browser default focusing to avoid double events
                const value = parseInt(label.dataset.value);
                if (!isNaN(value)) {
                    slider.value = value;
                    this.updateUI(value);
                    await controller.setClickbaitLevel(value);
                    this.dispatchEvent(new CustomEvent('setting-saved', {
                        bubbles: true,
                        detail: { key: 'clickbaitLevel', value, success: true, message: 'Asetus tallennettu!' }
                    }));
                }
            });
        });
    }

    updateUI(level) {
        const slider = this.querySelector('#clickbait-slider');
        if (slider) {
            slider.value = level;
        }

        // Highlight selected label
        this.querySelectorAll('.slider-labels label').forEach(label => {
            const val = parseInt(label.dataset.value);
            if (val === level) {
                label.classList.add('selected');
            } else {
                label.classList.remove('selected');
            }
        });
    }
}

customElements.define('clickbait-level-vertical', ClickbaitLevelVertical);
