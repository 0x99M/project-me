/* eslint-disable */
// The /hearts-v4 engine: one gold heart stays at the centre while the camera glides out across 41 orders of magnitude.
// Every scale is nature drawn in hearts: an atom, DNA, a cell, a flower, the two of us, a forest, the sea, Earth,
// the solar system, the galaxy, and the cosmic web, which turns out to be one giant heart. Each scale is its own
// point cloud in its own units, so nothing needs more than float precision. startHeartsV4(root) returns a cleanup.
export function startHeartsV4(root){
  "use strict";
  var dead=false, paused=false, raf=0, offs=[];
  function on(el,type,fn,opt){ el.addEventListener(type,fn,opt); offs.push(function(){ el.removeEventListener(type,fn,opt); }); }
  var $=function(id){ return root.querySelector("#"+id); };
  var glc=$("gl"), ov=$("ov"), o=ov.getContext("2d");
  var elIntro=$("intro"), elCap=$("cap"), elScale=$("scale"), elExp=$("exp"), elWhat=$("what"), elEnd=$("end"), elReplay=$("replay"), elHint=$("hint");
  var reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;

  var TAU=Math.PI*2;
  function clamp(x,a,b){ return x<a?a:x>b?b:x; }
  function lerp(a,b,t){ return a+(b-a)*t; }
  function ss(a,b,x){ var t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
  function eOut(t){ return 1-Math.pow(1-t,3); }
  function bump(x,w){ return x<0||x>w?0:Math.sin(Math.PI*x/w); }
  function beatShape(f){ return bump(f,.13)+.55*bump(f-.2,.13); }
  function frac(x){ return x-Math.floor(x); }
  function vib(p){ try{ navigator.vibrate&&navigator.vibrate(p); }catch(e){} }
  function add(a,b){ return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; }
  function sub(a,b){ return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
  function scl(a,s){ return [a[0]*s,a[1]*s,a[2]*s]; }
  function len(a){ return Math.hypot(a[0],a[1],a[2]); }
  function norm(a){ var l=len(a)||1; return [a[0]/l,a[1]/l,a[2]/l]; }
  function cross(a,b){ return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
  function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
  function rng(seed){ return function(){ seed=(seed+0x6D2B79F5)|0; var t=Math.imul(seed^(seed>>>15),1|seed); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
  var R=rng(20270313);
  function gauss(){ var u=1-R(), v=R(); return Math.sqrt(-2*Math.log(u))*Math.cos(TAU*v); }
  function unit(){ var z=R()*2-1, a=R()*TAU, r=Math.sqrt(1-z*z); return [r*Math.cos(a),z,r*Math.sin(a)]; }
  function pick(a){ return a[Math.floor(R()*a.length)]; }
  // the classic 2D heart region, lobes up: x in [-1.14,1.14], y in [-1,1.25]
  function inHeart2(x,y){ var a=x*x+y*y-1; return a*a*a-x*x*y*y*y<=0; }

  /* ---------- the scales ---------- */
  // S: log10 of the view's half-height in metres. fit: half-width/half-height the camera keeps in view.
  var ST=[
    {S:-15,  what:"أصغر من البروتون",    cap:"بدأ بقلبين، أصغرَ من أيّ شيء.",          pitch:.18, yaw:0,   fit:[.9,.9]},
    {S:-10,  what:"ذرّة",                cap:"تمسّكا ببعضهما، فصارا ذرّة.",            pitch:.4,  yaw:.5,  fit:[.95,.95]},
    {S:-8,   what:"الحمض النووي",        cap:"ثمّ كتبَ نفسَه فينا.",                   pitch:.12, yaw:.25, fit:[.55,1.05]},
    {S:-5,   what:"خليّة حيّة",          cap:"ودبّت فيه الحياة.",                      pitch:.35, yaw:.6,  fit:[.98,.98]},
    {S:-1.3, what:"زهرة",                cap:"ثمّ أزهر.",                              pitch:.14, yaw:0,   fit:[.8,.8]},
    {S:0,    what:"قلبان",               cap:"وصار أنا وأنتِ.",                        pitch:.1,  yaw:0,   fit:[1.0,.62]},
    {S:3,    what:"غابة",                cap:"وامتدّ حتى ملأ الغابة.",                 pitch:.85, yaw:.3,  fit:[.8,.6]},
    {S:5,    what:"البحر",               cap:"واتّسع… حتى صار بحرًا.",                 pitch:.5,  yaw:.35, fit:[.95,.6]},
    {S:7,    what:"الأرض",               cap:"8,328,955,303 قلبًا… وعالمٌ واحد.",      pitch:.3,  yaw:.15, fit:[.72,.72]},
    {S:13,   what:"المجموعة الشمسية",    cap:"وفاق نورُه نورَ الشمس.",                 pitch:.62, yaw:.5,  fit:[1.02,.62]},
    {S:21,   what:"درب التبّانة",        cap:"ثمّ ملأ المجرّة.",                       pitch:.9,  yaw:.3,  fit:[1.05,.8]},
    {S:26.5, what:"الكون المرئي",        cap:"حتى صار أكبرَ ما في الكون.",             pitch:.08, yaw:0,   fit:[1.42,1.22]}
  ];
  var NS=ST.length, LAST=NS-1, I_US=5, I_FOREST=6, I_SEA=7, I_EARTH=8, I_SUN=9;
  function gapPrev(k){ return k>0?ST[k].S-ST[k-1].S:5; }
  function gapNext(k){ return k<LAST?ST[k+1].S-ST[k].S:5; }

  var smallScreen=Math.min(screen.width,screen.height)<700, Q=smallScreen?.62:1;
  function N(n){ return Math.max(1,Math.round(n*Q)); }

  // per point: pos3 col3 move4 misc4.
  // move: rotation axis + speed (about the scale's pivot), or a sway vector + speed. misc: size, kind, phase, motion (0 still, 1 orbit, 2 sway)
  // kind: 0 structure, 1 peers, 2 the one heart, 3 limb, 4 flowing light
  var FL=14;
  function Buf(){ this.a=[]; }
  Buf.prototype.p=function(x,y,z,c,br,size,kind,ph,mv,mt){
    var m=mv||[0,0,0,0];
    this.a.push(x,y,z,c[0]*br,c[1]*br,c[2]*br,m[0],m[1],m[2],m[3],size,kind||0,ph==null?R():ph,mv?(mt||1):0);
  };
  // a share of points big enough to read as hearts
  function hz(p,big,small){ return R()<p?big:small; }
  var ROSE=[1,.42,.6], RUBY=[1,.2,.38], PINK=[1,.62,.74], GOLD=[1,.8,.48], AMBER=[1,.66,.34], CREAM=[1,.9,.78], VIOLET=[.62,.36,.9], LILAC=[.85,.6,1];
  var GREEN=[.38,.92,.52], LEAF=[.58,.96,.45], MOSS=[.3,.7,.42], TEAL=[.28,.86,.82], BLUE=[.32,.56,1], SKY=[.6,.82,1], FOAM=[.85,.95,1];

  function peers(b,k,flat,cols){
    var r0=3*Math.pow(10,ST[k-1].S-ST[k].S), r1=1.8, peer=Math.pow(10,ST[k-1].S-ST[k].S)*1.2, n=N(Math.min(2800,560*gapPrev(k)));
    for(var i=0;i<n;i++){
      var r=r0*Math.pow(r1/r0,R()), d=unit();
      b.p(d[0]*r,d[1]*r*flat,d[2]*r,pick(cols),.35+.45*R(),peer*(.5+R()),1);
    }
    b.p(0,0,0,GOLD,1,peer,2,0);
  }
  function ringBasis(n){ var a=Math.abs(n[1])<.9?[0,1,0]:[1,0,0], e1=norm(cross(n,a)); return [e1,cross(n,e1)]; }
  function drift(a,sp){ return [gauss()*a,gauss()*a,gauss()*a,(sp||.6)*(.6+.8*R())]; }

  var PIVOT=[], CENTER=[], EARTH_C=[0,0,0], EARTH_R=0, UNI_C=[0,0,0];
  for(var z0=0;z0<NS;z0++){ PIVOT.push([0,0,0]); CENTER.push([0,0,0]); }

  var BUILD=[
    function(b){ // quantum foam around the two hearts (the hearts themselves are drawn on the 2D layer)
      for(var i=0;i<N(2600);i++){ var d=unit(), r=.35+1.4*Math.pow(R(),.7); b.p(d[0]*r,d[1]*r,d[2]*r,pick([VIOLET,LILAC,ROSE]),.18+.3*R(),hz(.08,.03,.004+.012*R()),0,null,drift(.02,.5),2); }
    },
    function(b){ // an atom: three electron hearts with comet trails, and a soft probability cloud
      peers(b,1,1,[LILAC,ROSE,PINK]);
      var rings=[[norm([0,1,.25]),.5,1.15,GOLD],[norm([.85,.45,.2]),.68,-.85,ROSE],[norm([-.6,.55,.6]),.86,.62,PINK]];
      rings.forEach(function(rg){
        var n=rg[0], r=rg[1], sp=rg[2], bs=ringBasis(n), e1=bs[0], e2=bs[1], dir=sp>0?-1:1, spin=[n[0],n[1],n[2],sp];
        for(var j=0;j<130;j++){ var a=dir*j*.022, q=add(scl(e1,Math.cos(a)*r),scl(e2,Math.sin(a)*r)), f=Math.exp(-j/38);
          b.p(q[0],q[1],q[2],j?rg[3]:CREAM,(j?.7:1.4)*f+.05,j?.046*(1-j/150):.07,0,0,spin,1); }
        for(j=0;j<N(380);j++){ var a2=R()*TAU, q2=add(scl(e1,Math.cos(a2)*r),scl(e2,Math.sin(a2)*r)); b.p(q2[0],q2[1],q2[2],rg[3],.14+.1*R(),hz(.06,.02,.006),0,null,spin,1); }
      });
      for(var i=0;i<N(2400);i++){ var d=unit(), rr=.3+.62*Math.pow(R(),.6); b.p(d[0]*rr,d[1]*rr,d[2]*rr,pick([VIOLET,LILAC,ROSE]),.16+.18*R(),hz(.07,.022,.006),0,null,drift(.015,.4),2); }
    },
    function(b){ // DNA: a ruby strand and a gold strand; base pairs between them
      peers(b,2,1,[GOLD,ROSE,LILAC]);
      var r=.17, pitch=.86;
      function strand(y,ph){ var t=y*TAU/pitch+ph; return [r*Math.cos(t)-r,y,r*Math.sin(t)]; }
      function fade(y){ return 1-ss(.95,1.55,Math.abs(y)); }
      for(var i=0;i<N(1600);i++){
        var y=(R()*2-1)*1.6, big=R()<.2, A=R()<.5, p=strand(y,A?0:2.25), f=fade(y);
        b.p(p[0]+gauss()*.006,p[1]+gauss()*.006,p[2]+gauss()*.006,A?pick([RUBY,ROSE]):pick([GOLD,AMBER]),(big?.75:.5)*f,big?.044:.02);
      }
      for(var yy=-1.6;yy<=1.6;yy+=.072){
        var a=strand(yy,0), c=strand(yy,2.25), f2=fade(yy);
        for(var j=1;j<9;j++){ var u=j/9, q=add(a,scl(sub(c,a),u)); b.p(q[0],q[1],q[2],u<.5?PINK:CREAM,.3*f2,.012); }
      }
      for(i=0;i<N(1000);i++){ var d=unit(), rr=.25+R()*1.4; b.p(d[0]*rr*.8-r,(R()*2-1)*1.5,d[2]*rr*.8,pick([LILAC,VIOLET,ROSE]),.12+.12*R(),hz(.08,.02,.005),0,null,drift(.02,.5),2); }
    },
    function(b){ // a cell: membrane, nucleus (where the DNA lives), mitochondria, drifting cytoplasm
      peers(b,3,1,[ROSE,PINK,GOLD]);
      var cc=[.3,0,0], nc=[.08,.02,0], i, d, r;
      CENTER[3]=cc;
      for(i=0;i<N(5000);i++){ d=unit(); r=.85*(1+.05*Math.sin(3*d[0]+2*d[1])+.03*Math.sin(5*d[2]-d[0]))+gauss()*.007;
        b.p(cc[0]+d[0]*r,cc[1]+d[1]*r,cc[2]+d[2]*r,pick([ROSE,PINK,RUBY]),.3+.25*R(),hz(.14,.032,.012),0,null,scl(d,.012).concat([.8]),2); }
      for(i=0;i<N(1900);i++){ d=unit(); r=.26+gauss()*.004; b.p(nc[0]+d[0]*r,nc[1]+d[1]*r,nc[2]+d[2]*r,pick([GOLD,AMBER,CREAM]),.35+.25*R(),hz(.12,.028,.011)); }
      for(i=0;i<N(360);i++){ b.p(.15+gauss()*.035,.07+gauss()*.035,.04+gauss()*.035,GOLD,.5,.012); }
      for(var c=0;c<9;c++){ var q=add(nc,scl(unit(),.12*R())); for(var j=0;j<N(90);j++){ q=add(q,scl(unit(),.016)); if(len(sub(q,nc))>.23) q=add(nc,scl(norm(sub(q,nc)),.2)); b.p(q[0],q[1],q[2],ROSE,.3,.008); } }
      for(c=0;c<10;c++){
        var pc; do{ pc=add(cc,scl(unit(),.25+.5*R())); }while(len(sub(pc,nc))<.36);
        var ax=unit(), bs=ringBasis(ax), sw=drift(.02,.35);
        for(j=0;j<N(170);j++){ var t=R()*TAU, ph=R()*TAU, ex=.075*Math.cos(t), rr2=.028*Math.sin(t);
          var q2=add(pc,add(scl(ax,ex),add(scl(bs[0],rr2*Math.cos(ph)),scl(bs[1],rr2*Math.sin(ph)))));
          b.p(q2[0],q2[1],q2[2],pick([RUBY,ROSE]),.45,hz(.1,.024,.01),0,c/10,sw,2); }
      }
      for(i=0;i<N(2200);i++){ d=unit(); r=.8*Math.cbrt(R()); var q3=add(cc,scl(d,r)); if(len(sub(q3,nc))<.28) continue; b.p(q3[0],q3[1],q3[2],pick([LILAC,PINK]),.12+.12*R(),hz(.05,.02,.006),0,null,drift(.025,.45),2); }
    },
    function(b){ // a flower facing us: five heart-shaped petals made of hearts, a golden centre, a stem with heart leaves
      peers(b,4,1,[ROSE,PINK,GOLD]);
      var sc=.25, petals=[], i, j;
      for(j=0;j<5;j++){ var th=Math.PI/2+j*TAU/5; petals.push([Math.cos(th),Math.sin(th)]); }
      var home=null, pts=[];
      for(j=0;j<5;j++){
        var A=petals[j], P=[-A[1],A[0]], n=N(1900), k=0;
        while(k<n){
          var x=(R()*2-1)*1.15, y=R()*2.3-1.02; if(!inHeart2(x,y)) continue;
          var edge=!inHeart2(x*1.08,(y+1)*1.06-1), t=(y+1)/2.3, w=[A[0]*(y+1)*sc+P[0]*x*sc,A[1]*(y+1)*sc+P[1]*x*sc,.12*t*t+gauss()*.004];
          pts.push([w,edge?PINK:(t<.35?RUBY:pick([ROSE,ROSE,PINK])),edge?.62:.34+.2*t,hz(edge?.25:.14,.03,.011),j]); k++;
          if(j===0&&!home&&Math.abs(x)<.05&&Math.abs(y-.25)<.05) home=w;
        }
      }
      if(!home) home=[0,.35*sc*1.25,.01];
      function put(w,c,br,sz,ph,mv){ b.p(w[0]-home[0],w[1]-home[1],w[2]-home[2],c,br,sz,0,ph,mv,2); }
      var sway=[.006,.003,.012,.9];
      pts.forEach(function(p){ put(p[0],p[1],p[2],p[3],p[4]*.03,sway); });
      for(i=0;i<N(900);i++){ var rr=.075*Math.sqrt(R()), a=R()*TAU; put([Math.cos(a)*rr,Math.sin(a)*rr,.03+gauss()*.006],pick([GOLD,AMBER,CREAM]),.6,hz(.15,.026,.01),0,sway); }
      for(i=0;i<N(26);i++){ var a2=i/26*TAU; put([Math.cos(a2)*.1,Math.sin(a2)*.1,.05],CREAM,.9,.032,0,sway); }
      for(i=0;i<N(700);i++){ var yy=-.02-R()*1.6; put([.015*Math.sin(yy*3)+gauss()*.005,yy,-.02+gauss()*.005],pick([GREEN,MOSS]),.35,.01,0,[.003,0,.008,.9]); }
      [[-.5,.55],[-.92,Math.PI-.55]].forEach(function(L){ // two heart-shaped leaves, tips on the stem
        var base=[.015*Math.sin(L[0]*3),L[0],-.02], ca=Math.cos(L[1]), sa=Math.sin(L[1]);
        for(var k=0;k<N(900);){ var x=(R()*2-1)*1.15, y=R()*2.3-1.02; if(!inHeart2(x,y)) continue; k++;
          var lx=x*.12, ly=(y+1)*.12, edge=!inHeart2(x*1.08,(y+1)*1.06-1);
          put([base[0]+ca*ly-sa*lx,base[1]+sa*ly+ca*lx,base[2]-.01],edge?LEAF:pick([GREEN,MOSS,LEAF]),edge?.55:.3,hz(.14,.024,.01),0,[.006,.002,.01,.9]); }
      });
      for(i=0;i<N(900);i++){ var d=unit(), r2=.2+R()*1.2; put([d[0]*r2,d[1]*r2,d[2]*r2*.5],pick([GOLD,CREAM,PINK]),.25+.25*R(),hz(.12,.016,.005),null,drift(.04,.35)); }
      CENTER[4]=scl(home,-1);
    },
    function(b){ // the two of us: a ruby heart and a gold heart made of hearts, breathing, with light flowing between
      peers(b,5,.9,[ROSE,GOLD,PINK]);
      function inHeart(x,y,z){ var a=x*x+2.25*z*z+y*y-1; return a*a*a-x*x*y*y*y-.1125*z*z*y*y*y; }
      function heart(cx,lean,cols,n){
        var cl=Math.cos(lean), sl=Math.sin(lean), sc=.38;
        for(var i=0;i<n;){
          var x=(R()*2-1)*1.2, y=R()*2.4-1.15, z=(R()*2-1)*.75, f=inHeart(x,y,z);
          if(f>0) continue;
          var surf=f>-.035; if(!surf&&R()<.55) continue;
          var X=(x*cl-y*sl)*sc, Y=(x*sl+y*cl)*sc;
          b.p(cx+X,Y-.03,z*sc,pick(cols),surf?.42:.22,hz(.16,.032,.011),0,0,[X*.035,Y*.035,z*sc*.035,TAU*1.15/2],2); i++;
        }
      }
      heart(0,-.14,[RUBY,ROSE,PINK],N(6500));
      heart(.95,.14,[GOLD,AMBER,CREAM],N(6500));
      var p0=[.2,.2,0], p1=[.48,.42,0], p2=[.75,.2,0];
      for(var i=0;i<N(900);i++){ var u=R(), v=1-u, q=add(add(scl(p0,v*v),scl(p1,2*u*v)),scl(p2,u*u));
        b.p(q[0]+gauss()*.012,q[1]+gauss()*.012,q[2]+gauss()*.012,u<.5?PINK:CREAM,.35,hz(.1,.02,.008),4,u); }
      for(i=0;i<N(900);i++){ var d=unit(), r=.6+R()*1.2; b.p(.47+d[0]*r,d[1]*r*.7,d[2]*r*.6,pick([PINK,GOLD,LILAC]),.2+.2*R(),hz(.15,.02,.006),0,null,drift(.03,.4),2); }
      CENTER[5]=[.475,0,0];
    },
    function(b){ // a forest seen from above at night: trees of green hearts, blossoming trees, a heart-shaped clearing where we stand, a river, fireflies
      peers(b,6,.08,[GREEN,LEAF,GOLD]);
      var hc=[0,0,-.05], hs=.21;
      function inClearing(x,z){ return inHeart2((x-hc[0])/hs,-(z-hc[2])/hs); }
      function river(x){ return .38+.12*Math.sin(x*2.6+.7); }
      var trees=0, i;
      while(trees<N(1900)){
        var r=Math.pow(R(),.8)*1.35, a=R()*TAU, x=Math.cos(a)*r, z=Math.sin(a)*r;
        if(inHeart2((x-hc[0])/(hs*1.25),-(z-hc[2])/(hs*1.25))) continue;
        if(Math.abs(z-river(x))<.05) continue;
        trees++;
        var rt=.016+.02*R(), blossom=R()<.14, cols=blossom?[PINK,ROSE,CREAM]:[GREEN,LEAF,MOSS,TEAL], br=(blossom?.6:.46)*(1-.45*ss(.6,1.4,r)), sw=[.002,0,.002,.7+.4*R()];
        for(var j=0;j<14;j++){ var dr=Math.sqrt(R())*rt, da=R()*TAU;
          b.p(x+Math.cos(da)*dr,rt*.7*Math.sqrt(Math.max(0,1-dr*dr/(rt*rt))),z+Math.sin(da)*dr,pick(cols),br*(.7+.6*R()),hz(.3,.02,.008),0,trees*.13,sw,2); }
      }
      for(i=0;i<N(1100);i++){ var t=R()*TAU, sx=16*Math.pow(Math.sin(t),3)/16, sy=(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))/16;
        b.p(hc[0]+sx*hs*1.05+gauss()*.004,.002,hc[2]-(sy-.1)*hs*1.05+gauss()*.004,pick([PINK,CREAM,GOLD]),.75,hz(.35,.016,.007),0,t/TAU,null); }
      for(i=0;i<N(500);i++){ var gx=(R()*2-1)*hs, gz=(R()*2-1)*hs; if(!inClearing(hc[0]+gx,hc[2]+gz)) continue; b.p(hc[0]+gx,0,hc[2]+gz,pick([LEAF,GREEN,PINK]),.2,hz(.1,.012,.005),0,null,[.002,0,.002,.8],2); }
      for(i=0;i<N(1500);i++){ var rx=(R()*2-1)*1.7, u=(rx+1.7)/3.4; b.p(rx,0,river(rx)+gauss()*.012,pick([SKY,TEAL,FOAM]),.5,hz(.12,.016,.007),4,u*3); }
      for(i=0;i<N(1200);i++){ var fr=Math.pow(R(),.6)*1.2, fa=R()*TAU; b.p(Math.cos(fa)*fr,.01+R()*.04,Math.sin(fa)*fr,pick([GOLD,CREAM,AMBER]),.9,hz(.25,.016,.007),0,null,drift(.014,.9),2); }
      CENTER[6]=hc;
    },
    function(b){ // the sea at night: the forest on the shore, a beach, rolling lines of waves, a path of moonlight
      peers(b,7,.06,[TEAL,SKY,GREEN]);
      var yw=ST[I_SEA].yaw, Rt=[Math.cos(yw),0,-Math.sin(yw)], F=[-Math.sin(yw),0,-Math.cos(yw)];
      function W(a,d,y){ return add(add(scl(Rt,a),scl(F,d)),[0,y||0,0]); }
      function coast(a){ return .1*Math.sin(1.7*a+.5)+.05*Math.sin(4.3*a+1.1)-(.1*Math.sin(.5)+.05*Math.sin(1.1))+.06; }
      var i, q;
      for(i=0;i<N(7000);i++){ var a=(R()*2-1)*1.7, d=coast(a)-Math.pow(R(),.7)*1.0; if(R()<.4&&Math.hypot(a,d)>.06) d=coast(a)-R()*.12;
        q=W(a,d,.002); b.p(q[0],q[1],q[2],pick([GREEN,MOSS,LEAF,TEAL]),.28+.22*R(),hz(.14,.016,.007),0,null,[.001,0,.001,.8],2); }
      for(i=0;i<N(2000);i++){ var a2=(R()*2-1)*1.7; q=W(a2,coast(a2)+.006+gauss()*.004,0); b.p(q[0],q[1],q[2],pick([CREAM,GOLD,AMBER]),.6,hz(.14,.014,.007)); }
      for(var j=0;j<26;j++){
        var off=.02+j*.04*(1+j*.05), n=N(Math.round(800-j*16)), br=.85*Math.exp(-j/14)+.14;
        for(i=0;i<n;i++){ var a3=(R()*2-1)*1.8; q=W(a3,coast(a3)+off+gauss()*.004,0);
          b.p(q[0],q[1],q[2],pick(j<2?[FOAM,FOAM,SKY]:[TEAL,SKY,BLUE,LILAC]),br*(.6+.6*R()),hz(.2,.02,.008),0,a3*.5+j*.13,[F[0]*.012,.004,F[2]*.012,1.4],2); }
      }
      for(i=0;i<N(3400);i++){ var d2=.1+Math.pow(R(),.8)*1.6, a4=gauss()*(.03+.1*d2); q=W(a4,coast(0)+d2,0);
        b.p(q[0],q[1],q[2],pick([GOLD,CREAM,CREAM]),.6+.5*R(),hz(.2,.02,.007),0,null,[.003,0,.003,2.2],2); }
      CENTER[7]=W(0,.32,0);
    },
    function(b){ // Earth in hearts: blue sea, green and golden land, turning clouds, a thin bright sky; our shore faces us
      peers(b,8,1,[SKY,TEAL,LILAC]);
      var y8=ST[I_EARTH].yaw, p8=ST[I_EARTH].pitch, n8=[Math.sin(y8)*Math.cos(p8),Math.sin(p8),Math.cos(y8)*Math.cos(p8)], Rr=.62, C=scl(n8,-Rr);
      EARTH_C=C; EARTH_R=Rr; PIVOT[8]=C;
      function land(d){ return Math.sin(3.1*d[0]+1.3)*Math.cos(2.7*d[1]-.4)+.8*Math.sin(2.3*d[2]+4.1*d[0])+.5*Math.sin(5.3*d[1]+3.7*d[2])+.9*Math.exp(-dot(sub(d,n8),sub(d,n8))/.05); }
      var spin=[0,1,0,.05], i;
      for(i=0;i<N(20000);i++){
        var d=unit(), L=land(d), polar=Math.abs(d[1])>.88;
        var on=L>.35, c=polar?FOAM:on?(L>1?pick([LEAF,GOLD]):pick([GREEN,MOSS,LEAF])):pick([BLUE,TEAL,BLUE]);
        var br=(polar?.55:on?.55+.25*R():.32+.16*R())*1.6;
        b.p(C[0]+d[0]*Rr,C[1]+d[1]*Rr,C[2]+d[2]*Rr,c,br,hz(on?.18:.12,.026,.011),0,null,spin,1);
      }
      for(i=0;i<N(4200);i++){ var d2=unit(), cl=Math.sin(6*d2[1]+3*Math.sin(4*d2[0]+2*d2[2]))+.6*Math.sin(9*d2[0]-5*d2[2]); if(cl<.75) continue;
        var rc=Rr*1.018; b.p(C[0]+d2[0]*rc,C[1]+d2[1]*rc,C[2]+d2[2]*rc,FOAM,.45,hz(.14,.024,.009),0,null,[0,1,0,.08],1); }
      for(i=0;i<N(3000);i++){ var d3=unit(), rr=Rr*1.04; b.p(C[0]+d3[0]*rr,C[1]+d3[1]*rr,C[2]+d3[2]*rr,pick([SKY,LILAC,PINK]),.36,.013,3); }
    },
    function(b){ // the solar system: orbits drawn in hearts, planets that move, a golden sun, two belts
      peers(b,9,.12,[GOLD,CREAM,ROSE]);
      var radii=[.06,.1,.14,.2,.38,.55,.74,.92], sun=[-.14,0,0], pcols=[CREAM,GOLD,null,ROSE,AMBER,GOLD,SKY,BLUE], psize=[.01,.012,0,.011,.022,.019,.015,.015];
      PIVOT[9]=sun; CENTER[9]=sun;
      radii.forEach(function(r,k){
        var sp=[0,1,0,.55/Math.pow(r/.14,1.5)];
        for(var j=0;j<N(520);j++){ var a=R()*TAU; b.p(sun[0]+Math.cos(a)*r,gauss()*.0015,sun[2]+Math.sin(a)*r,pick([LILAC,PINK,CREAM]),.3+.15*R(),hz(.04,.014,.0075)); }
        if(k===2) return;
        var a0=R()*TAU, c=[sun[0]+Math.cos(a0)*r,0,sun[2]+Math.sin(a0)*r];
        for(j=0;j<30;j++) b.p(c[0]+gauss()*psize[k]*.5,gauss()*psize[k]*.3,c[2]+gauss()*psize[k]*.5,pcols[k],.55,j?psize[k]*.55:psize[k]*1.5,0,null,sp,1);
        if(k===5) for(j=0;j<N(200);j++){ var t=R()*TAU, rr=.03+R()*.012; b.p(c[0]+Math.cos(t)*rr,Math.sin(t)*rr*.25,c[2]+Math.sin(t)*rr*.7,CREAM,.3,.005,0,null,sp,1); }
      });
      for(var i=0;i<N(1100);i++){ b.p(sun[0]+gauss()*.026,gauss()*.026,sun[2]+gauss()*.026,pick([GOLD,CREAM,AMBER]),.24,hz(.1,.03,.011),0,null,drift(.004,.8),2); }
      for(i=0;i<N(900);i++){ var d=unit(), r2=.03+R()*.08; b.p(sun[0]+d[0]*r2,d[1]*r2,sun[2]+d[2]*r2,pick([GOLD,ROSE]),.15,.01,0,null,drift(.01,.5),2); }
      for(i=0;i<N(1800);i++){ var a=R()*TAU, r3=.27+R()*.06; b.p(sun[0]+Math.cos(a)*r3,gauss()*.006,sun[2]+Math.sin(a)*r3,pick([AMBER,CREAM]),.3,hz(.05,.014,.0065),0,null,[0,1,0,.12],1); }
      for(i=0;i<N(1800);i++){ var a4=R()*TAU, r4=1.0+R()*.38; b.p(sun[0]+Math.cos(a4)*r4,gauss()*.03,sun[2]+Math.sin(a4)*r4,pick([LILAC,VIOLET]),.24,hz(.05,.014,.0065),0,null,[0,1,0,.04],1); }
    },
    function(b){ // the Milky Way: four arms of hearts and a golden core; the sun sits on an arm
      peers(b,10,.15,[ROSE,LILAC,GOLD]);
      var gc=[-.55,0,0], bw=2.05, phi=-Math.log(.55/.06)*bw;
      CENTER[10]=gc;
      var ARM=[[1,.22,.40],[1,.40,.56],[1,.58,.72],[.78,.10,.32],[.92,.22,.58],[1,.32,.36],[.8,.5,1]], CORE=[[1,.72,.78],[1,.84,.66],[1,.6,.7]];
      for(var i=0;i<N(26000);i++){
        var x, y, z, kind=R();
        if(kind<.13){ x=gauss()*.09; z=gauss()*.09; y=gauss()*.045; }
        else if(kind<.8){ var r=Math.min(1.05,.06+(-Math.log(1-R()*.985))*.3), arm=Math.floor(R()*4), th=arm*TAU/4+Math.log(r/.06)*bw+phi+gauss()*.2*(1+r);
          x=Math.cos(th)*r+gauss()*.012; z=Math.sin(th)*r+gauss()*.012; y=gauss()*(.008+.018*Math.exp(-r/.25)); }
        else{ var r2=Math.sqrt(R())*1.05, t=R()*TAU; x=Math.cos(t)*r2; z=Math.sin(t)*r2; y=gauss()*.012; }
        var rad=Math.hypot(x,z), core=Math.exp(-rad/.2), col=R()<core*.9?pick(CORE):pick(ARM);
        b.p(gc[0]+x,y,gc[2]+z,col,(.3+.45*R())*(.8+.9*core),hz(.06,.022,.004+.006*R()));
      }
    },
    function(b){ // the cosmic web; its brightest filament is one heart
      peers(b,11,1,[LILAC,ROSE,GOLD]);
      var yw=ST[LAST].yaw, X=[Math.cos(yw),0,-Math.sin(yw)], Y=[0,1,0], Z=[Math.sin(yw),0,Math.cos(yw)], sc=1.35/17;
      function hxy(t){ var s=Math.sin(t); return [16*s*s*s*sc,(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))*sc]; }
      var t0=-2.15, h0=hxy(t0);
      function W(x,y,z){ return add(add(scl(X,x-h0[0]),scl(Y,y-h0[1])),scl(Z,z)); }
      UNI_C=W(0,-3.4*sc,0); CENTER[LAST]=UNI_C;
      var i, j, q;
      for(i=0;i<N(9000);i++){ var t=R()*TAU, h=hxy(t), th=R()<.3?.006:.02; q=W(h[0]+gauss()*th,h[1]+gauss()*th,gauss()*th);
        b.p(q[0],q[1],q[2],t%TAU<Math.PI?GOLD:ROSE,.35+.35*R(),hz(.08,.022,.006+.006*R()),4,t/TAU); }
      var nodes=[];
      for(i=0;i<60;i++){ var tt=i/60*TAU, hh=hxy(tt); nodes.push([hh[0],hh[1],0,1,tt]); }
      for(i=0;i<170;i++) nodes.push([(R()*2-1)*1.9,(R()*2-1)*1.45-.35,(R()*2-1)*.8,0,0]);
      nodes.forEach(function(nd,a){
        var near=nodes.map(function(m,k){ return [k,Math.hypot(m[0]-nd[0],m[1]-nd[1],m[2]-nd[2])]; }).filter(function(e){ return e[0]!==a; }).sort(function(p,q2){ return p[1]-q2[1]; }).slice(0,nd[3]?2:3);
        near.forEach(function(e){ var m=nodes[e[0]], cnt=Math.round(e[1]*N(220));
          for(var k=0;k<cnt;k++){ var u=R(); var p=W(lerp(nd[0],m[0],u)+gauss()*.013,lerp(nd[1],m[1],u)+gauss()*.013,lerp(nd[2],m[2],u)+gauss()*.013);
            b.p(p[0],p[1],p[2],pick([VIOLET,LILAC,PINK]),.12+.14*R(),hz(.03,.014,.005)); } });
        for(j=0;j<(nd[3]?14:24);j++){ q=W(nd[0]+gauss()*.022,nd[1]+gauss()*.022,nd[2]+gauss()*.022); b.p(q[0],q[1],q[2],nd[3]?CREAM:pick([LILAC,PINK]),nd[3]?.5:.3,R()<.15?.016:.006,nd[3]?4:0,nd[4]/TAU); }
      });
    }
  ];
  var DATA=BUILD.map(function(f){ var b=new Buf(); f(b); return new Float32Array(b.a); });
  CENTER[2]=[-.17,0,0];

  /* ---------- the story: one continuous glide, slowing at each scale ---------- */
  // u is the scale index as a float; s (log10 of the view half-height) follows u along a smooth monotone curve.
  var JOIN=4.4, PER=7, EASE=.84, LASTP=1.6;
  var T_FINAL=JOIN+PER*(LAST-1)+PER*LASTP+.3;
  function uAt(tt){
    if(tt<JOIN) return 0;
    var x=(tt-JOIN)/PER;
    if(x<LAST-1) return x-EASE*Math.sin(TAU*x)/TAU;
    var v=Math.min(1,(x-(LAST-1))/LASTP), m0=(1-EASE)*LASTP;
    return LAST-1+(v*v*v-2*v*v+v)*m0+(-2*v*v*v+3*v*v);
  }
  var SLOPE=(function(){ // Fritsch-Carlson slopes so s(u) is smooth and never overshoots
    var d=[], m=[], k;
    for(k=0;k<LAST;k++) d.push(ST[k+1].S-ST[k].S);
    m.push(d[0]);
    for(k=1;k<LAST;k++) m.push(2/(1/d[k-1]+1/d[k]));
    m.push(d[LAST-1]);
    return m;
  })();
  function sAt(u){
    if(u<=0) return ST[0].S; if(u>=LAST) return ST[LAST].S;
    var k=Math.floor(u), t=u-k, h=ST[k+1].S-ST[k].S, t2=t*t, t3=t2*t;
    return (2*t3-3*t2+1)*ST[k].S+(t3-2*t2+t)*SLOPE[k]+(-2*t3+3*t2)*ST[k+1].S+(t3-t2)*SLOPE[k+1];
  }
  function storyAt(tt){ var u=uAt(tt); return {u:u,s:sAt(u)}; }

  // how visible each scale is at zoom s
  function homeIn(k,s){ if(k<1||k>LAST) return 0; var a=ST[k-1].S, g=gapPrev(k); return ss(a+.3*g,a+.6*g,s); }
  function outOf(k,s){ return k===LAST?1:1-ss(ST[k].S+.55*gapNext(k),ST[k].S+.92*gapNext(k),s); }
  function vis(k,s){
    var S0=ST[k].S, g=gapPrev(k), out=outOf(k,s);
    var A=k===0?1:ss(S0-.55*g,S0-.1*g,s), FA=k===0?0:ss(S0-.8*g,S0-.45*g,s)*(1-.55*ss(S0-.15*g,S0,s));
    var HA=homeIn(k,s)*(1-homeIn(k+1,s));
    return {A:A*out,FA:FA*out,HA:HA*out};
  }

  /* ---------- WebGL ---------- */
  var gl=glc.getContext("webgl",{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,powerPreference:"high-performance"});
  var GV="precision highp float;attribute vec3 aPos;attribute vec3 aCol;attribute vec4 aMove;attribute vec4 aMisc;"+
    "uniform mat4 uVP;uniform float uF,uFocal,uTime,uSpinT,uA,uFA,uHA,uMaxPx,uDPR,uBeat,uFlow,uWaveR,uWaveA;uniform vec3 uT,uEye,uWaveO,uPivot;uniform vec4 uSph;"+
    "varying vec3 vCol;varying float vA,vPx;"+
    "void main(){vec3 p=aPos;"+
    "if(aMisc.w>.5&&aMisc.w<1.5){float an=uSpinT*aMove.w;vec3 k=aMove.xyz;float c=cos(an),s=sin(an);vec3 q=p-uPivot;p=uPivot+q*c+cross(k,q)*s+k*dot(k,q)*(1.-c);}"+
    "else if(aMisc.w>1.5){p+=aMove.xyz*sin(uTime*aMove.w+aMisc.z*6.2831);}"+
    "vec3 w=p*uF-uT;vec4 cl=uVP*vec4(w,1.);gl_Position=cl;"+
    "if(cl.w<.03){gl_PointSize=0.;vA=0.;vPx=0.;vCol=vec3(0.);return;}"+
    "float px=aMisc.x*uF*uFocal/cl.w;float kind=aMisc.y;float a;vec3 col=aCol;float mn=1.3*uDPR;"+
    "if(kind>1.5&&kind<2.5){a=uHA;px=max(px,7.*uDPR)*(1.+.25*uBeat);col=vec3(1.,.84,.5)*1.3;}"+
    "else{"+
      "if(kind>.5&&kind<1.5){a=uFA*1.3;a*=smoothstep(.025,.1,length(p)*uF);px=clamp(px,2.4*uDPR,20.*uDPR);}"+
      "else{a=uA;if(px<mn){a*=px*px/(mn*mn);px=mn;}}"+
      "a*=.78+.22*sin(uTime*1.7+aMisc.z*6.2831);"+
    "}"+
    "if(uSph.w>0.){vec3 n=normalize(p-uSph.xyz);float fc=dot(n,normalize(uEye-w));if(kind>2.5&&kind<3.5)a*=pow(1.-abs(fc),4.);else a*=.1+.9*smoothstep(-.05,.3,fc);}"+
    "if(kind>3.5){a*=1.+uFlow*1.8*pow(.5+.5*sin((aMisc.z*6.-uTime*.45)*6.2831),8.);}"+
    "float wd=length(p-uWaveO)-uWaveR;a*=1.+uWaveA*1.6*exp(-wd*wd*160.);"+
    "a*=1.-smoothstep(uMaxPx*.55,uMaxPx,px);"+
    "gl_PointSize=min(px,uMaxPx);vPx=gl_PointSize;vCol=col;vA=a;}";
  var GF="precision mediump float;varying vec3 vCol;varying float vA,vPx;"+
    "float d2(vec2 v){return dot(v,v);}"+
    "float sdH(vec2 p){p.x=abs(p.x);if(p.y+p.x>1.)return sqrt(d2(p-vec2(.25,.75)))-.35355;return sqrt(min(d2(p-vec2(0.,1.)),d2(p-.5*max(p.x+p.y,0.))))*sign(p.x-p.y);}"+
    "void main(){vec2 q=gl_PointCoord*2.-1.;q.y=-q.y;float a;"+
    "if(vPx<6.){a=max(0.,1.-dot(q,q));a*=a;}else{vec2 p=q*.85+vec2(0.,.55);float d=sdH(p);a=clamp(.5-d*vPx/1.7,0.,1.);a+=.3*exp(-max(d,0.)*10.)*(1.-a);}"+
    "gl_FragColor=vec4(vCol*a*vA,0.);}";
  function prog(vs,fs){
    function sh(type,src){ var s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var p=gl.createProgram(); gl.attachShader(p,sh(gl.VERTEX_SHADER,vs)); gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs)); gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u={}, n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS); for(var i=0;i<n;i++){ var nm=gl.getActiveUniform(p,i).name; u[nm]=gl.getUniformLocation(p,nm); }
    var at={}, na=gl.getProgramParameter(p,gl.ACTIVE_ATTRIBUTES); for(i=0;i<na;i++){ var an=gl.getActiveAttrib(p,i).name; at[an]=gl.getAttribLocation(p,an); }
    return {p:p,u:u,a:at};
  }
  var PG=null, BUFS=[], MAXPT=64;
  if(gl){
    try{
      PG=prog(GV,GF);
      BUFS=DATA.map(function(d){ var b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,d,gl.STATIC_DRAW); return {b:b,n:d.length/FL}; });
      MAXPT=gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]||64;
    }catch(e){ console.error(e); gl=null; }
  }

  /* ---------- camera ---------- */
  function persp(fovy,asp,n,f){ var t=1/Math.tan(fovy/2), nf=1/(n-f); return [t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)*nf,-1, 0,0,2*f*n*nf,0]; }
  function lookAt(e,c,u){
    var zx=e[0]-c[0], zy=e[1]-c[1], zz=e[2]-c[2], l=Math.hypot(zx,zy,zz)||1; zx/=l; zy/=l; zz/=l;
    var xx=u[1]*zz-u[2]*zy, xy=u[2]*zx-u[0]*zz, xz=u[0]*zy-u[1]*zx; l=Math.hypot(xx,xy,xz)||1; xx/=l; xy/=l; xz/=l;
    var yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
    return [xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0, -(xx*e[0]+xy*e[1]+xz*e[2]),-(yx*e[0]+yy*e[1]+yz*e[2]),-(zx*e[0]+zy*e[1]+zz*e[2]),1];
  }
  function mul(a,b){ var r=new Float32Array(16); for(var i=0;i<4;i++) for(var j=0;j<4;j++){ var s=0; for(var k=0;k<4;k++) s+=a[k*4+j]*b[i*4+k]; r[i*4+j]=s; } return r; }

  var FOV=50, TH=Math.tan(FOV*Math.PI/360);
  var W=1,H=1,DPR=1,VP=null,FOCAL=1,FOCALC=1,EYE=[0,0,1];
  var T=-1, time=0, last=0;
  var ptr={x:0,y:0,nx:0,ny:0,down:false,moved:0}, drag={yaw:0,pitch:0}, wave={t0:-99};

  function resize(){
    DPR=Math.min(2,window.devicePixelRatio||1); W=window.innerWidth; H=window.innerHeight;
    glc.width=ov.width=Math.round(W*DPR); glc.height=ov.height=Math.round(H*DPR);
  }
  function distFor(k){ var f=ST[k].fit; return Math.max(f[1]/TH,f[0]/(TH*(W/H)))*1.06; }

  // The camera orbits the view origin; T shifts each scale so its composition sits there (the one heart stays near the middle).
  function camera(st){
    var s=st.s, u=st.u, k0=Math.min(LAST,Math.floor(u)), k1=Math.min(LAST,k0+1), e=ss(0,1,u-k0);
    var pitch=lerp(ST[k0].pitch,ST[k1].pitch,e), D=lerp(distFor(k0),distFor(k1),e);
    var yaw=lerp(ST[k0].yaw,ST[k1].yaw,e)+.1*Math.sin(time*.19);
    if(T<0) yaw+=ptr.nx*.25, pitch+=ptr.ny*.12;
    if(T>=T_FINAL){ yaw+=drag.yaw; pitch=clamp(pitch+drag.pitch,-.5,1.1); }
    var tgt=[0,0,0];
    for(var k=0;k<NS;k++){
      var f=Math.pow(10,ST[k].S-s); if(f>1e6||f<1e-6) continue;
      var arrive=k===0?1:ss(ST[k].S-.6,ST[k].S-.04,s);
      tgt=add(tgt,scl(CENTER[k],arrive*Math.min(f,1)));
    }
    var dir=[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
    return {target:tgt,eye:scl(dir,D),D:D};
  }
  function project(p){
    var m=VP, cw=m[3]*p[0]+m[7]*p[1]+m[11]*p[2]+m[15];
    if(cw<.03) return null;
    var cx=(m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12])/cw, cy=(m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13])/cw;
    return {x:(cx*.5+.5)*W,y:(.5-cy*.5)*H,w:cw};
  }

  /* ---------- the first two hearts, drawn crisp on the 2D layer ---------- */
  var HEART=new Path2D("M50 88 C 46 84, 6 60, 6 32 C 6 16, 18 6, 31 6 C 40 6, 47 11, 50 19 C 53 11, 60 6, 69 6 C 82 6, 94 16, 94 32 C 94 60, 54 84, 50 88 Z");
  var SHINE=new Path2D("M18 34 C 17 24, 23 16, 32 14");
  function grad(stops){ var g=o.createRadialGradient(36,28,4,46,48,62); stops.forEach(function(s){ g.addColorStop(s[0],s[1]); }); return g; }
  var G_RUBY=grad([[0,"#ff8aa0"],[.45,"#e8335a"],[.8,"#b0123d"],[1,"#7a0a28"]]), G_GOLD=grad([[0,"#fff6d8"],[.4,"#f6d58a"],[.78,"#dca84a"],[1,"#a06d1f"]]);
  function makeGlow(rgb){ var c=document.createElement("canvas"); c.width=c.height=128; var g=c.getContext("2d"), gr=g.createRadialGradient(64,64,0,64,64,64);
    gr.addColorStop(0,"rgba("+rgb+",.85)"); gr.addColorStop(.3,"rgba("+rgb+",.3)"); gr.addColorStop(1,"rgba("+rgb+",0)"); g.fillStyle=gr; g.fillRect(0,0,128,128); return c; }
  var GLOW_R=makeGlow("255,70,110"), GLOW_G=makeGlow("255,210,130");
  function hero(p,D,gold,a,beat){
    if(!p||a<.01||D<.5) return;
    o.save(); o.globalAlpha=a;
    o.globalCompositeOperation="lighter"; o.drawImage(gold?GLOW_G:GLOW_R,p.x-D*1.4,p.y-D*1.4,D*2.8,D*2.8); o.globalCompositeOperation="source-over";
    var k=D/100*(1+.07*beat);
    o.translate(p.x,p.y); o.scale(k,k); o.translate(-50,-47);
    o.fillStyle=gold?G_GOLD:G_RUBY; o.fill(HEART);
    if(D>14){
      o.lineCap="round"; o.strokeStyle="rgba(255,255,255,.55)"; o.lineWidth=4; o.stroke(SHINE);
    }
    o.restore();
  }
  // the two hearts at the smallest scale, in stage-0 units
  var SPOS=[2.4,1.1,.9];
  function pairAt(tt){
    if(T<0) return {m:[0,0,0],s:null};
    var j=ss(0,JOIN,tt), e=eOut(j), sep=.2*ss(.3,1,j);
    var a=Math.max(0,tt-JOIN*.6)*.55, c=Math.cos(a), s=Math.sin(a);
    var sp=[lerp(SPOS[0],sep,e),lerp(SPOS[1],0,e)*(1-j),lerp(SPOS[2],0,e)];
    return {m:[-sep*c,0,sep*s],s:[sp[0]*c+sp[2]*s,sp[1],-sp[0]*s+sp[2]*c]};
  }

  /* ---------- text ---------- */
  var SUP={"-":"⁻","0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹"};
  function setOn(el,v){ if(el.classList.contains("on")!==v) el.classList.toggle("on",v); }
  var capWant=-1, capShown=-1, capSwapAt=0, expShown="", whatShown="";
  function ui(tt,st){
    setOn(elIntro,T<0); setOn(elHint,T<0);
    setOn(elScale,T>=0&&tt<T_FINAL+.4);
    var want=-1;
    if(T>=0&&tt<T_FINAL){
      var k=Math.round(st.u);
      if(Math.abs(st.u-k)<.4||k===LAST) want=k;
      if(k===0&&tt<.9) want=-1;
    }
    if(want!==capWant){ capWant=want; capSwapAt=time+(elCap.classList.contains("on")?.6:0); setOn(elCap,false); }
    if(capWant!==capShown&&time>=capSwapAt){ capShown=capWant; if(capShown>=0){ elCap.textContent=ST[capShown].cap; setOn(elCap,true); } }
    if(T>=0){
      var e=Math.round(st.s+Math.log10(2)), str=e===0?"1":"10"+String(e).split("").map(function(c){ return SUP[c]; }).join("");
      if(str!==expShown){ expShown=str; elExp.textContent=str; }
      var w=ST[Math.round(st.u)].what; if(w!==whatShown){ whatShown=w; elWhat.textContent=w; }
    }
    setOn(elEnd,T>=0&&tt>=T_FINAL+.5); elReplay.hidden=!(T>=0&&tt>=T_FINAL+2.5);
  }

  /* ---------- frame ---------- */
  function frame(now){
    if(dead) return;
    raf=requestAnimationFrame(frame);
    if(paused){ last=0; return; }
    var dt=last?Math.min(.05,Math.max(0,(now-last)/1000)):0; last=now;
    time+=dt; if(T>=0) T+=dt;
    if(!ptr.down){ drag.yaw*=Math.pow(.05,dt); drag.pitch*=Math.pow(.05,dt); }
    render();
  }

  function render(){
    var tt=Math.max(0,T), st=storyAt(tt), s=st.s;
    var cam=camera(st);
    VP=mul(persp(FOV*Math.PI/180,W/H,.02,400),lookAt(cam.eye,[0,0,0],[0,1,0]));
    FOCAL=(glc.height/2)/TH; FOCALC=(H/2)/TH; EYE=cam.eye;
    var beat=beatShape(frac(time*1.15));
    var flowU=ss(T_FINAL-1,T_FINAL+1.5,tt), wt=time-wave.t0, waveA=wt<2.6?1-wt/2.6:0;

    if(gl){
      gl.viewport(0,0,glc.width,glc.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE,gl.ONE,gl.ZERO,gl.ONE);
      gl.useProgram(PG.p); var U=PG.u, A=PG.a;
      gl.uniformMatrix4fv(U.uVP,false,VP); gl.uniform1f(U.uFocal,FOCAL); gl.uniform1f(U.uTime,time);
      gl.uniform1f(U.uMaxPx,Math.min(64*DPR,MAXPT)); gl.uniform1f(U.uDPR,DPR); gl.uniform1f(U.uBeat,beat); gl.uniform3fv(U.uEye,EYE);
      gl.uniform3fv(U.uT,cam.target);
      gl.enableVertexAttribArray(A.aPos); gl.enableVertexAttribArray(A.aCol); gl.enableVertexAttribArray(A.aMove); gl.enableVertexAttribArray(A.aMisc);
      for(var k=0;k<NS;k++){
        var v=vis(k,s); if(v.A<.003&&v.FA<.003&&v.HA<.003) continue;
        gl.uniform1f(U.uF,Math.pow(10,ST[k].S-s));
        gl.uniform1f(U.uA,v.A*(T<0&&k===0?.7:1)); gl.uniform1f(U.uFA,v.FA); gl.uniform1f(U.uHA,v.HA);
        gl.uniform1f(U.uFlow,k===I_US||k===I_FOREST?1:k===LAST?flowU:0);
        gl.uniform3fv(U.uPivot,PIVOT[k]); gl.uniform1f(U.uSpinT,k===I_EARTH?tt-(JOIN+PER*I_EARTH):time);
        gl.uniform4f(U.uSph,EARTH_C[0],EARTH_C[1],EARTH_C[2],k===I_EARTH?EARTH_R:0);
        if(k===LAST){ gl.uniform3fv(U.uWaveO,UNI_C); gl.uniform1f(U.uWaveR,wt*1.1); gl.uniform1f(U.uWaveA,waveA); }
        else gl.uniform1f(U.uWaveA,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,BUFS[k].b);
        gl.vertexAttribPointer(A.aPos,3,gl.FLOAT,false,FL*4,0);
        gl.vertexAttribPointer(A.aCol,3,gl.FLOAT,false,FL*4,12);
        gl.vertexAttribPointer(A.aMove,4,gl.FLOAT,false,FL*4,24);
        gl.vertexAttribPointer(A.aMisc,4,gl.FLOAT,false,FL*4,40);
        gl.drawArrays(gl.POINTS,0,BUFS[k].n);
      }
    }

    // the 2D layer: the first two hearts, and a soft glow on the one heart
    o.setTransform(DPR,0,0,DPR,0,0); o.clearRect(0,0,W,H);
    var f0=Math.pow(10,ST[0].S-s), pr=pairAt(tt), out0=outOf(0,s);
    function v0(p){ return sub(scl(p,f0),cam.target); }
    var HS=.34;
    if(T<0&&!reduced){ var pm0=project(v0(pr.m));
      if(pm0){ var dM0=HS*f0*FOCALC/pm0.w;
        for(var q=0;q<2;q++){ var rp=frac(time/2.2+q*.5); o.globalAlpha=.45*(1-rp)*ss(0,.15,rp); o.strokeStyle="#f7e3b0"; o.lineWidth=1.5;
          o.beginPath(); o.arc(pm0.x,pm0.y,dM0*(.62+.7*eOut(rp)),0,TAU); o.stroke(); }
        o.globalAlpha=1; } }
    if(out0>.005){
      var heroes=[[pr.m,false]]; if(pr.s) heroes.push([pr.s,true]);
      heroes=heroes.map(function(h){ return [project(v0(h[0])),h[1]]; }).filter(function(h){ return h[0]; });
      heroes.sort(function(a,b){ return b[0].w-a[0].w; });
      heroes.forEach(function(h){ var D=HS*f0*FOCALC/h[0].w; hero(h[0],D,h[1],out0*ss(1.5,5,D),beat); });
    }

    if(T>=0&&out0<.95){
      var ph=project(scl(cam.target,-1));
      if(ph){ var gs=22+5*beat; o.globalCompositeOperation="lighter"; o.globalAlpha=.4*(1-out0); o.drawImage(GLOW_G,ph.x-gs,ph.y-gs,gs*2,gs*2); o.globalCompositeOperation="source-over"; o.globalAlpha=1; }
    }
    ui(tt,st);
  }

  /* ---------- input ---------- */
  function start(){ T=reduced?T_FINAL+.5:0; wave.t0=-99; drag.yaw=drag.pitch=0; capWant=capShown=-1; setOn(elCap,false); }
  function setPtr(e){ var r=ov.getBoundingClientRect(); ptr.x=e.clientX-r.left; ptr.y=e.clientY-r.top; ptr.nx=ptr.x/W*2-1; ptr.ny=ptr.y/H*2-1; }
  on(ov,"pointerdown",function(e){
    setPtr(e); ptr.down=true; ptr.moved=0;
    try{ ov.setPointerCapture(e.pointerId); }catch(_){}
    if(T<0){ start(); vib(15); }
  });
  on(ov,"pointermove",function(e){
    var px=ptr.x, py=ptr.y; setPtr(e);
    if(ptr.down&&T>=T_FINAL){ ptr.moved+=Math.abs(ptr.x-px)+Math.abs(ptr.y-py); drag.yaw=clamp(drag.yaw-(ptr.x-px)*.004,-.7,.7); drag.pitch=clamp(drag.pitch+(ptr.y-py)*.003,-.45,.45); }
  });
  on(ov,"pointerup",function(){
    if(ptr.down&&T>=T_FINAL&&ptr.moved<10){ wave.t0=time; vib(12); }
    ptr.down=false;
  });
  on(ov,"pointercancel",function(){ ptr.down=false; });
  on(ov,"keydown",function(e){ if((e.key===" "||e.key==="Enter")&&T<0){ e.preventDefault(); start(); } });
  on(elReplay,"click",start);
  on(window,"resize",resize);
  on(document,"visibilitychange",function(){ paused=document.hidden; });
  on(glc,"webglcontextlost",function(e){ e.preventDefault(); gl=null; });
  resize();
  if(!gl) T=T_FINAL+.5;
  raf=requestAnimationFrame(frame);

  return function stop(){ dead=true; cancelAnimationFrame(raf); offs.forEach(function(f){ f(); }); };
}
