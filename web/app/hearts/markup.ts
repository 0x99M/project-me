// Static markup for /hearts. The engine animates it by id; React never re-renders it.
export const MARKUP = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <linearGradient id="goldg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7e3b0"/><stop offset=".5" stop-color="#e3bf78"/><stop offset="1" stop-color="#c4934a"/>
    </linearGradient>
    <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff7286"/><stop offset=".5" stop-color="#df3352"/><stop offset="1" stop-color="#93112c"/>
    </linearGradient>
    <symbol id="heart" viewBox="0 0 24 22"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.420 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></symbol>
  </defs>
</svg>

<canvas id="fx" aria-hidden="true"></canvas>
<div class="rays" id="rays"></div>
<div class="halo" id="halo"></div>

<div class="final" id="final" aria-live="polite">
  <div class="row">
    <span class="L" id="lm">M</span>
    <svg class="big" id="big" viewBox="-10 -10 120 112" role="img" aria-label="قلب">
      <defs>
        <radialGradient id="ruby" cx="34%" cy="28%" r="82%">
          <stop offset="0" stop-color="#ffb3bf"/><stop offset=".18" stop-color="#ff5d7d"/><stop offset=".5" stop-color="#d81e48"/><stop offset=".82" stop-color="#99102f"/><stop offset="1" stop-color="#5e061b"/>
        </radialGradient>
        <linearGradient id="rubyShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset=".5" stop-color="#3c000f" stop-opacity="0"/><stop offset="1" stop-color="#3c000f" stop-opacity=".5"/>
        </linearGradient>
        <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff3cf"/><stop offset=".35" stop-color="#e8c47e"/><stop offset=".62" stop-color="#a9772f"/><stop offset=".85" stop-color="#f3d99a"/><stop offset="1" stop-color="#c8964a"/>
        </linearGradient>
        <linearGradient id="sheenG" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
        <clipPath id="hclip"><path d="M50 88 C 46 84, 6 60, 6 32 C 6 16, 18 6, 31 6 C 40 6, 47 11, 50 19 C 53 11, 60 6, 69 6 C 82 6, 94 16, 94 32 C 94 60, 54 84, 50 88 Z"/></clipPath>
        <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4"/></filter>
      </defs>
      <!-- a fine gold line floating around the heart -->
      <path d="M50 88 C 46 84, 6 60, 6 32 C 6 16, 18 6, 31 6 C 40 6, 47 11, 50 19 C 53 11, 60 6, 69 6 C 82 6, 94 16, 94 32 C 94 60, 54 84, 50 88 Z" fill="none" stroke="url(#rim)" stroke-width=".9" opacity=".7" transform="translate(50 47) scale(1.14) translate(-50 -47)"/>
      <!-- the ruby -->
      <path d="M50 88 C 46 84, 6 60, 6 32 C 6 16, 18 6, 31 6 C 40 6, 47 11, 50 19 C 53 11, 60 6, 69 6 C 82 6, 94 16, 94 32 C 94 60, 54 84, 50 88 Z" fill="url(#ruby)"/>
      <path d="M50 88 C 46 84, 6 60, 6 32 C 6 16, 18 6, 31 6 C 40 6, 47 11, 50 19 C 53 11, 60 6, 69 6 C 82 6, 94 16, 94 32 C 94 60, 54 84, 50 88 Z" fill="url(#rubyShade)"/>
      <g clip-path="url(#hclip)">
        <path d="M50 88 C 46 84, 6 60, 6 32 C 6 16, 18 6, 31 6 C 40 6, 47 11, 50 19 C 53 11, 60 6, 69 6 C 82 6, 94 16, 94 32 C 94 60, 54 84, 50 88 Z" fill="none" stroke="#ffc2cc" stroke-opacity=".45" stroke-width="7" filter="url(#soft)"/>
        <ellipse cx="29" cy="25" rx="16" ry="9" transform="rotate(-32 29 25)" fill="#fff" fill-opacity=".42" filter="url(#soft)"/>
        <path d="M40 72 C 45 77, 52 79, 59 74" stroke="#ff9db0" stroke-opacity=".55" stroke-width="2.4" fill="none" stroke-linecap="round" filter="url(#soft)"/>
        <rect id="sheen" x="-70" y="-10" width="46" height="120" fill="url(#sheenG)" transform="skewX(-18)"/>
      </g>
      <path d="M16 35 C 15 24, 22 15, 32 13" stroke="#fff" stroke-opacity=".6" stroke-width="2" fill="none" stroke-linecap="round"/>
      <circle cx="37.5" cy="12.4" r="1.5" fill="#fff" fill-opacity=".9"/>
      <circle cx="73" cy="20" r="2.4" fill="#fff" fill-opacity=".55" filter="url(#soft)"/>
      <!-- gold rim -->
      <path d="M50 88 C 46 84, 6 60, 6 32 C 6 16, 18 6, 31 6 C 40 6, 47 11, 50 19 C 53 11, 60 6, 69 6 C 82 6, 94 16, 94 32 C 94 60, 54 84, 50 88 Z" fill="none" stroke="url(#rim)" stroke-width="2.6" stroke-linejoin="round"/>
      <path d="M72 9 l1.4 4.2 4.2 1.4 -4.2 1.4 -1.4 4.2 -1.4 -4.2 -4.2 -1.4 4.2 -1.4 z" fill="#fff6dc" transform="translate(16 -6) scale(.9)"/>
    </svg>
    <span class="L" id="ls">S</span>
  </div>
</div>

<svg class="guide" id="guide" viewBox="0 0 200 260" role="button" tabindex="0" aria-label="ارسم حرف S لتبدأ، أو اضغط Enter">
  <path class="bed" d="M 160 52 C 150 22, 92 14, 66 36 C 40 58, 52 92, 96 116 C 140 140, 162 172, 148 208 C 134 244, 70 252, 42 222 C 30 208, 34 192, 44 186"/>
  <path class="dots" d="M 160 52 C 150 22, 92 14, 66 36 C 40 58, 52 92, 96 116 C 140 140, 162 172, 148 208 C 134 244, 70 252, 42 222 C 30 208, 34 192, 44 186"/>
  <path class="ink" id="ink" d="M 160 52 C 150 22, 92 14, 66 36 C 40 58, 52 92, 96 116 C 140 140, 162 172, 148 208 C 134 244, 70 252, 42 222 C 30 208, 34 192, 44 186"/>
  <circle class="start" id="start" cx="160" cy="52" r="7"/>
</svg>
<p class="hint" id="hint" dir="rtl">ارسم حرف S بإصبعك لتبدأ</p>
<button class="replay" id="replay" type="button" hidden>إعادة الحركة</button>
`;
