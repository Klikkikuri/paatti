import browser from '../../browser-api.js';
import { adoptComponentStyleSheet, defineComponent } from '../components/component-utils.js';

adoptComponentStyleSheet(new URL('./step-indicator.css', import.meta.url));

/**
 * The wizard's progress: one segment for each slide, and a line of text with the step count and the slide title.
 *
 * Give it the deck with `update(steps, current)`. A click on a segment dispatches `step-select` with the index
 * as `detail`. The element never moves itself: the page decides, because the scroll position, the buttons and
 * the segments must all lead to the same current index (see deck.js).
 *
 * The text carries the meaning, so colour is not the only signal. A screen reader hears the current step from
 * one live region, and each segment is a button named by its step.
 */
class StepIndicator extends HTMLElement {
    /**
     * @param {Array<{id: string, tour: boolean, title: string}>} steps
     * @param {number} current - Index of the current step.
     */
    update(steps, current) {
        const { getMessage } = browser.i18n;
        const total = steps.length;
        const step = steps[current];
        const countOf = (position) => getMessage('welcomeStepCount', [String(position), String(total)])
            || `Step ${position} of ${total}`;
        const count = countOf(current + 1);

        const segments = document.createElement('ol');
        segments.className = 'step-segments';
        steps.forEach((entry, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'step-segment';
            button.dataset.state = index < current ? 'past' : index === current ? 'current' : 'future';
            button.setAttribute('aria-label', `${countOf(index + 1)}: ${entry.title}`);
            if (index === current) button.setAttribute('aria-current', 'step');
            button.addEventListener('click', () => {
                this.dispatchEvent(new CustomEvent('step-select', { detail: index }));
            });

            const item = document.createElement('li');
            item.append(button);
            segments.append(item);
        });

        const text = document.createElement('p');
        text.className = 'step-text';
        const long = document.createElement('span');
        long.className = 'step-count-long';
        long.textContent = count;
        // On a narrow screen the long form does not fit, so a short one that needs no translation takes its place.
        const short = document.createElement('span');
        short.className = 'step-count-short';
        short.textContent = `${current + 1} / ${total}`;
        const title = document.createElement('span');
        title.className = 'step-title';
        title.textContent = step.title;
        const separator = document.createElement('span');
        separator.className = 'step-separator';
        separator.textContent = ' · ';
        text.append(long, short, separator, title);
        if (step.tour) {
            const tag = document.createElement('span');
            tag.className = 'step-tour-tag';
            tag.textContent = getMessage('welcomeTourTag') || 'Tour';
            text.append(' ', tag);
        }

        const live = document.createElement('p');
        live.className = 'visually-hidden';
        live.setAttribute('aria-live', 'polite');
        live.textContent = `${count}: ${step.title}`;

        this.replaceChildren(text, segments, live);
    }
}

defineComponent('step-indicator', StepIndicator);
