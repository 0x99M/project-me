// Static markup for /hearts-v2. The engine animates it by id; React never re-renders it.
export const MARKUP = `
<div class="stage">
  <div class="halo" id="halo"></div>
  <canvas id="fx" tabindex="0" role="img" aria-label="قلب. اضغط مطوّلاً عليه، أو اضغط مسافة مطوّلاً، ليمتلئ."></canvas>
  <p class="hint" id="hint" dir="rtl"><span id="hintText">اضغط مطوّلاً على القلب</span></p>
  <button class="replay" id="replay" type="button" hidden>إعادة</button>
</div>
`;
