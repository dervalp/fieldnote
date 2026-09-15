export function advanceCarousel(state: {
  index: number;
  count: number;
  paused: boolean;
  visible: boolean;
  focused: boolean;
}): number {
  if (state.paused || !state.visible || state.focused || state.count < 2) return state.index;
  return (state.index + 1) % state.count;
}
