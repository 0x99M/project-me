// Static markup for /hearts-v4. The engine draws into the canvases and toggles the rest by id; React never re-renders it.
export const MARKUP = `
<div class="stage">
  <canvas id="gl" aria-hidden="true"></canvas>
  <canvas id="ov" tabindex="0" role="img" aria-label="Two hearts, M and S, smaller than a proton. The view glides out through an atom, DNA, a cell, a flower, the two of us, a forest, the sea, Earth, the solar system and the galaxy, all made of hearts, to the observable universe, whose cosmic web forms one giant heart"></canvas>
  <div class="top"><div id="intro" class="intro fade"><p class="q">إلى أيّ حدٍّ يمكن أن يكبرَ الحب؟</p></div></div>
  <div class="top"><p id="cap" class="cap fade"></p></div>
  <p id="hint" class="hint fade">المس القلب لتبدأ</p>
  <div id="scale" class="scale fade"><p class="exp"><span id="exp">10</span><small>m</small></p><p id="what" class="what"></p></div>
  <div class="endpos"><div id="end" class="end fade">
    <div class="title"><span>M</span><svg viewBox="0 0 100 94" aria-hidden="true"><path d="M50 88 C 46 84, 6 60, 6 32 C 6 16, 18 6, 31 6 C 40 6, 47 11, 50 19 C 53 11, 60 6, 69 6 C 82 6, 94 16, 94 32 C 94 60, 54 84, 50 88 Z"/></svg><span>S</span></div>
    <p class="sub">من قلبٍ واحد… إلى كلّ شيء.</p>
  </div></div>
  <button id="replay" class="replay" type="button" aria-label="Replay" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg></button>
</div>
`;
