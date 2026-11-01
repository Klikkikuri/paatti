import browser from '../../browser-api.js';
import { adoptComponentStyleSheet, defineComponent } from '../components/component-utils.js';

adoptComponentStyleSheet(new URL('./step-indicator.css', import.meta.url));

/**
 * The wizard's progress: one segment for each step of the flow, and a line of text with the step count and the
 * title of the current slide.
 *
 * Give it the deck, the flow and the current deck index with `update({ deck, flow, current })`. A click on a
 * segment dispatches `step-select` with the deck index as `detail`. The element never moves itself: the page
 * decides, because the scroll position, the buttons and the segments must all lead to the same current index
 * (see deck.js).
 *
 * The segments and the count describe the flow, not the document. On a slide that is outside the flow, such as
 * a tour-only slide of the quick mode, the line shows the title alone with the tour tag, and no segment is
 * current. The host carries that state as `data-flow="off"`, which the stylesheet needs on a narrow screen.
 *
 * The text carries the meaning, so colour is not the only signal. A screen reader hears the current step from
 * one live region, and each segment is a button named by its step. The three children of the element are built
 * once and updated in place, so the focus and the live region survive a change of the index.
 */
class StepIndicator extends HTMLElement {
    /** The three children of the element. Built on the first update, then updated in place. */
    #parts = null;

    /**
     * @param {object} state
     * @param {Array<{id: string, tourOnly: boolean, title: string}>} state.deck - Every slide, in document order.
     * @param {number[]} state.flow - The deck indices that the flow walks, in order.
     * @param {number} state.current - The deck index of the current slide.
     */
    update({ deck, flow, current }) {
        const { getMessage } = browser.i18n;
        const total = flow.length;
        const step = deck[current];
        const flowPosition = flow.indexOf(current);
        const inFlow = flowPosition >= 0;
        const countOf = (stepNumber) => getMessage('welcomeStepCount', [String(stepNumber), String(total)])
            || `Step ${stepNumber} of ${total}`;
        const count = inFlow ? countOf(flowPosition + 1) : null;

        this.dataset.flow = inFlow ? 'on' : 'off';
        const { text, segments, live } = this.#skeleton(total);

        // No segment is current when the slide is outside the flow, so each one needs only its side of it.
        const buttons = [...segments.querySelectorAll('.step-segment')];
        flow.forEach((index, segmentPosition) => {
            const button = buttons[segmentPosition];
            button.dataset.index = String(index);
            button.dataset.state = index < current ? 'past' : index === current ? 'current' : 'future';
            button.setAttribute('aria-label', `${countOf(segmentPosition + 1)}: ${deck[index].title}`);
            if (index === current) button.setAttribute('aria-current', 'step');
            else button.removeAttribute('aria-current');
        });

        const parts = [];
        if (inFlow) {
            parts.push(
                span('step-count-long', count),
                // On a narrow screen the long form does not fit, so a short one that needs no translation takes its place.
                span('step-count-short', `${flowPosition + 1} / ${total}`),
                span('step-separator', ' · '),
            );
        }
        parts.push(span('step-title', step.title));
        if (step.tourOnly) parts.push(' ', span('step-tour-tag', getMessage('welcomeTourTag') || 'Tour'));
        text.replaceChildren(...parts);

        live.textContent = count === null ? step.title : `${count}: ${step.title}`;
    }

    /**
     * The element's own children, built on the first update and kept after it.
     *
     * The segments keep their buttons, so a reader who has the focus on one keeps it when the index changes.
     * The live region stays in the document too: a screen reader announces a change inside a region that was
     * already there, not one that arrives with the new text.
     *
     * @param {number} total - How many steps the flow has.
     * @returns {{text: Element, segments: Element, live: Element}} The three children.
     */
    #skeleton(total) {
        if (!this.#parts) {
            const text = document.createElement('p');
            text.className = 'step-text';

            const segments = document.createElement('ol');
            segments.className = 'step-segments';
            segments.addEventListener('click', (event) => {
                const button = event.target.closest('.step-segment');
                if (!button) return;
                this.dispatchEvent(new CustomEvent('step-select', { detail: Number(button.dataset.index) }));
            });

            const live = document.createElement('p');
            live.className = 'visually-hidden';
            live.setAttribute('aria-live', 'polite');

            this.replaceChildren(text, segments, live);
            this.#parts = { text, segments, live };
        }

        const { segments } = this.#parts;
        if (segments.children.length !== total) {
            segments.replaceChildren(...Array.from({ length: total }, () => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'step-segment';

                const item = document.createElement('li');
                item.append(button);
                return item;
            }));
        }

        return this.#parts;
    }
}

/**
 * @param {string} className - The class of the new element.
 * @param {string} content - Its text.
 * @returns {HTMLSpanElement} A span with that class and text.
 */
function span(className, content) {
    const node = document.createElement('span');
    node.className = className;
    node.textContent = content;
    return node;
}

defineComponent('step-indicator', StepIndicator);
