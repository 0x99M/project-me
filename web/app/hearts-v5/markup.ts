// Static markup for /hearts-v5. The engine draws into the canvas and toggles the rest by id; React never re-renders it.
export const MARKUP = `
<div class="stage" id="stage">
  <canvas id="gl" role="img" aria-label="Gold and rose ink in dark water. Drag to stir it; let go and the two inks settle into one heart"></canvas>
  <div class="edge top"><p class="cap fade on" id="cap" aria-live="polite">حبرٌ من ذهب… وحبرٌ من ورد.</p></div>
  <div class="edge end fade" id="end">
    <p class="names">M <span>❤</span> S</p>
    <p class="sub">مهما اضطرب الماء… نعودُ قلبًا واحدًا.</p>
  </div>
  <p class="edge hint fade on" id="hint"><span><i>←</i> حرّكي الماء بإصبعكِ</span></p>
</div>
`;
