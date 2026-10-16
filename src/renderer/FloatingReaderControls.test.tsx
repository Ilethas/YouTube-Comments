// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { FloatingReaderControls } from './FloatingReaderControls';
import { installReaderLayout } from './testing/reader-layout';
import { required } from './testing/required';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('uses each actual reader viewport, shows only beyond the threshold, and scrolls its panel to the complete header with reduced motion', () => {
  const layout = installReaderLayout(), toolbar = createRef<HTMLDivElement>();
  const match = vi.fn(() => ({ matches: true })); vi.stubGlobal('matchMedia', match);
  const view = render(<><main className="reader-panel" tabIndex={0}><div ref={toolbar}>Header</div>
    <FloatingReaderControls toolbar={toolbar} selection={false} locale="pl"><span>Selected controls</span></FloatingReaderControls>
  </main><main className="reader-panel" data-testid="other" /></>);
  const panel = required(view.container.querySelector<HTMLElement>('main')), other = screen.getByTestId('other');
  expect(layout.roots()).toEqual([panel]);
  expect(screen.queryByRole('button')).toBeNull();
  panel.scrollTop = 200; fireEvent.scroll(panel); expect(screen.queryByRole('button')).toBeNull();
  other.scrollTop = 4000; fireEvent.scroll(other); expect(screen.queryByRole('button')).toBeNull();
  panel.scrollTop = 1200; fireEvent.scroll(panel);
  const button = screen.getByRole('button', { name: 'Wróć na górę' });
  const scroll = vi.spyOn(panel, 'scrollTo'); button.focus(); fireEvent.click(button);
  expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: 'instant' }); expect(other.scrollTop).toBe(4000);
  fireEvent.scroll(panel); expect(screen.queryByRole('button')).toBeNull();
  expect(document.activeElement).toBe(panel);
  match.mockReturnValue({ matches: false }); panel.scrollTop = 1300; fireEvent.scroll(panel);
  fireEvent.click(screen.getByRole('button')); expect(scroll).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
});

it('floats only selected controls when their original toolbar is out of the reader viewport; repeated scrolls do not rerender children', () => {
  const layout = installReaderLayout(), toolbar = createRef<HTMLDivElement>(), renders = vi.fn();
  function Content() { renders(); return <button>Mark selected read</button>; }
  const content = (selection: boolean) => <main className="reader-panel"><div ref={toolbar}>Normal toolbar</div>
    <FloatingReaderControls toolbar={toolbar} selection={selection} locale="en"><Content /></FloatingReaderControls></main>;
  const view = render(content(true)), panel = required(view.container.querySelector<HTMLElement>('main'));
  expect(screen.queryByRole('button')).toBeNull();
  act(() => layout.toolbarVisible(false)); expect(screen.getByRole('button', { name: 'Mark selected read' })).toBeTruthy();
  const count = renders.mock.calls.length;
  for (let index = 0; index < 100; index++) { panel.scrollTop = 1000 + index; fireEvent.scroll(panel); }
  expect(renders).toHaveBeenCalledTimes(count);
  act(() => layout.toolbarVisible(true)); expect(screen.queryByRole('button', { name: 'Mark selected read' })).toBeNull();
  act(() => layout.toolbarVisible(false)); view.rerender(content(false)); expect(screen.queryByRole('button', { name: 'Mark selected read' })).toBeNull();
});
