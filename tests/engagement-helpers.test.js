import { describe, expect, it } from 'vitest';
import { setReactionButtonsState } from '../public/js/modules/engagement-helpers.js';

describe('setReactionButtonsState', () => {
  it('activates only selected reaction', () => {
    document.body.innerHTML = `
      <button data-reaction="like"></button>
      <button data-reaction="dislike"></button>
    `;

    const buttons = [...document.querySelectorAll('button')];
    setReactionButtonsState(buttons, 'like');

    expect(buttons[0].classList.contains('is-active')).toBe(true);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].classList.contains('is-active')).toBe(false);
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
  });
});
