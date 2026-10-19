import { ClickbaitLevelBase } from './clickbait-level-base.js';
import { controller } from '../../controller.js';
import { getClickbaitLevelInfo } from '../utils.js';
import { adoptComponentStyleSheet, defineComponent } from './component-utils.js';

adoptComponentStyleSheet(new URL('./clickbait-level-horizontal.css', import.meta.url));

const template = document.createElement('template');
template.innerHTML = `
    <div style="margin-top: 0.625rem; margin-bottom: 0.9375rem; display: flex; flex-direction: column; gap: 0.375rem; width: 100%;">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; min-height: 2.25rem;">
            <label id="level-label" style="font-weight: bold; cursor: pointer; text-align: left; flex: 1; margin-right: 0.9375rem; line-height: 1.2;"></label>
            <input id="clickbait-slider" type="range" min="0" max="4" step="1" value="2" style="flex: 0 0 6.875rem; width: 6.875rem; height: auto; appearance: auto; background: none; box-shadow: none; cursor: pointer;">
        </div>
        <span id="level-description" class="text-muted-small" style="text-align: left; min-height: 2.125rem; line-height: 1.3;"></span>
    </div>
`;

/**
 * Compact horizontal clickbait level slider custom element for popupsettings view.
 * Inherits storage loading and onChanged synchronization hooks from ClickbaitLevelBase.
 */
class ClickbaitLevelHorizontal extends ClickbaitLevelBase {
    render() {

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

defineComponent('clickbait-level-horizontal', ClickbaitLevelHorizontal);
