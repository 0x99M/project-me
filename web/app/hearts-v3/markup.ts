// Static markup for /hearts-v3. The engine draws into the canvases and toggles the rest by id; React never re-renders it.
export const MARKUP = `
<div class="stage">
  <canvas id="gl" aria-hidden="true"></canvas>
  <canvas id="ov" tabindex="0" role="img" aria-label="A heart with the letter M searches a galaxy of 8.33 billion hearts and finds the gold heart S; the path it took draws one giant heart"></canvas>
  <div class="top"><p id="count" class="count fade"><span id="num">1</span></p></div>
  <div class="endpos" id="endpos"><div id="end" class="end fade">
    <div class="title"><span>M</span><svg viewBox="0 0 100 94" aria-hidden="true"><path d="M50 88 C 46 84, 6 60, 6 32 C 6 16, 18 6, 31 6 C 40 6, 47 11, 50 19 C 53 11, 60 6, 69 6 C 82 6, 94 16, 94 32 C 94 60, 54 84, 50 88 Z"/></svg><span>S</span></div>
  </div></div>
  <button id="replay" class="replay" type="button" aria-label="Replay" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg></button>
</div>
`;
