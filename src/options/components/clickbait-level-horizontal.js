import { ClickbaitLevelBase } from './clickbait-level-base.js';
import { controller } from '../../controller.js';
import { getClickbaitLevelInfo } from '../utils.js';

const template = document.createElement('template');
template.innerHTML = `
    <div style="margin-top: 10px; margin-bottom: 15px; display: flex; flex-direction: column; gap: 6px; width: 100%;">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; min-height: 36px;">
            <label id="level-label" style="font-weight: bold; cursor: pointer; text-align: left; flex: 1; margin-right: 15px; line-height: 1.2;"></label>
            <input id="clickbait-slider" type="range" min="0" max="4" step="1" value="2" style="flex: 0 0 110px; width: 110px; height: auto; appearance: auto; background: none; box-shadow: none; cursor: pointer;">
        </div>
        <span id="level-description" class="text-muted-small" style="text-align: left; min-height: 34px; line-height: 1.3;"></span>
    </div>
`;

/**
 * Compact horizontal clickbait level slider custom element for popupsettings view.
 * Inherits storage loading and onChanged synchronization hooks from ClickbaitLevelBase.
 */
class ClickbaitLevelHorizontal extends ClickbaitLevelBase {
    render() {
        this.style.display = 'block';
        this.style.width = '100%';

        this.replaceChildren(template.content.cloneNode(true));

        const slider = this.querySelector('#clickbait-slider');
        slider.addEventListener('input', async (e) => {
            const level = parseInt(e.target.value);
            this.updateText(level);
            await controller.setClickbaitLevel(level);
        });
    }

    updateUI(level) {
        const slider = this.querySelector('#clickbait-slider');
        if (slider) {
            slider.value = level;
        }
        this.updateText(level);
    }

    updateText(level) {
        const levelInfo = getClickbaitLevelInfo(level);
        const label = this.querySelector('#level-label');
        if (label) label.textContent = levelInfo.title;
        const desc = this.querySelector('#level-description');
        if (desc) desc.textContent = levelInfo.description;
    }
}

customElements.define('clickbait-level-horizontal', ClickbaitLevelHorizontal);
