export function setReactionButtonsState(buttons, selected) {
  buttons.forEach((btn) => {
    const active = btn.dataset.reaction === selected;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}
