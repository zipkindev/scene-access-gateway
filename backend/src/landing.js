'use strict';

const { BACKGROUNDS, DEFAULT_SCENE, validateScene, gameCompatibleBackground } = require('./scene-config');
const { DESTINATIONS } = require('./destination-directory');

function escapeTitle(value) {
  return value.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);
}

function landingPage(scanQrSvg, token, scriptNonce, configuration = DEFAULT_SCENE, backgrounds = BACKGROUNDS) {
  const sceneConfig = validateScene(configuration, backgrounds, ['torrentharbor', 'firewall']);
  const background = backgrounds[sceneConfig.backgroundId];
  const backgroundUrl = background.url || '/assets/' + background.file;
  const torrentharbor = sceneConfig.hotspots.find((item) => item.destinationId === 'torrentharbor');
  const firewall = sceneConfig.hotspots.find((item) => item.destinationId === 'firewall');
  if (!torrentharbor?.enabled) throw new Error('Unsupported public scene');
  const motion = sceneConfig.motion;
  const interactive = sceneConfig.interaction.kind === 'minesweeper';
  // This preset is bound to the exact calibrated table artwork, including a
  // trusted optimizer derivative. No other selectable image inherits it.
  const futureMotion = gameCompatibleBackground(backgrounds, sceneConfig.backgroundId);
  const carousel = futureMotion && interactive;
  const bundledMotion = background.bundleId && motion.enabled;
  // Motion is intentionally quarantined until scene-specific clean plates and
  // occlusion masks exist. Generic overlays do not meet the visual bar.
  const moving = false;
  const layer = (id, file) => moving && motion.effects[id] ? `<img class="motion-layer motion-${id}" src="/motion/immersive-city-candidate-a/${file}" alt="" aria-hidden="true">` : '';
  const motionLayers = [
    layer('clouds', 'clouds-upper.png'), layer('fog', 'fog-near.png'),
    layer('rain', 'rain.png'), layer('water', 'water-reflections.png'),
    moving && motion.effects.glow ? '<div class="motion-layer motion-glow" aria-hidden="true"></div>' : '',
  ].join('');
  const legacyAtmosphere = background.bundleId ? '' : `
      <div class="cloud-light" aria-hidden="true"></div>
      <div class="aurora" aria-hidden="true"></div>
      <div class="cloud-drift" aria-hidden="true"></div>
      <div class="fog-near" aria-hidden="true"></div>
      <div class="fog-far" aria-hidden="true"></div>
      <div class="city-glow" aria-hidden="true"></div>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <title>${escapeTitle(sceneConfig.display.title)}</title>
    <style>
      * { box-sizing: border-box; }
      body { align-items: center; background: #020305; display: flex; justify-content: center; margin: 0; min-height: 100dvh; overflow: hidden; }
      .scene { aspect-ratio: 16 / 9; background-position: center; background-repeat: no-repeat; background-size: 100% 100%; left:0; min-width:0; position:absolute; top:0; width:100vw; }
      .aurora { animation: aurora-shift 26s ease-in-out infinite alternate; background: linear-gradient(112deg, transparent 33%, rgba(47, 171, 135, .04) 39%, rgba(103, 205, 171, .15) 44%, rgba(45, 146, 168, .10) 48%, transparent 56%), linear-gradient(102deg, transparent 56%, rgba(87, 176, 142, .12) 63%, transparent 73%); filter: blur(12px); inset: -12%; mix-blend-mode: screen; opacity: .82; pointer-events: none; position: absolute; transform-origin: 62% 0; z-index: 1; }
      .cloud-light { animation: cloud-lightning 18s ease-in-out infinite; background: radial-gradient(ellipse 52% 36% at 63% 17%, rgba(177, 208, 225, .42), transparent 70%); inset: 0; mix-blend-mode: screen; opacity: 0; pointer-events: none; position: absolute; z-index: 1; }
      .cloud-drift { animation: cloud-drift 46s ease-in-out infinite alternate; background: radial-gradient(ellipse 36% 15% at 58% 17%, rgba(122, 143, 155, .14), transparent 76%), radial-gradient(ellipse 29% 12% at 81% 27%, rgba(106, 128, 141, .10), transparent 78%); filter: blur(7px); inset: -3%; mix-blend-mode: screen; opacity: .72; pointer-events: none; position: absolute; z-index: 1; }
      .fog-near { animation: fog-near 34s ease-in-out infinite alternate; background: radial-gradient(ellipse 24% 13% at 49% 56%, rgba(138, 155, 160, .15), transparent 76%), radial-gradient(ellipse 18% 11% at 66% 44%, rgba(120, 142, 150, .11), transparent 78%); filter: blur(8px); inset: -5%; mix-blend-mode: screen; opacity: .74; pointer-events: none; position: absolute; z-index: 1; }
      .fog-far { animation: fog-far 57s linear infinite alternate; background: radial-gradient(ellipse 29% 10% at 74% 35%, rgba(126, 146, 154, .11), transparent 82%), radial-gradient(ellipse 23% 9% at 56% 31%, rgba(146, 162, 165, .08), transparent 83%); filter: blur(10px); inset: -4%; mix-blend-mode: screen; opacity: .6; pointer-events: none; position: absolute; z-index: 1; }
      .city-glow { animation: city-glow 9s ease-in-out infinite alternate; background: radial-gradient(ellipse 31% 18% at 62% 57%, rgba(255, 164, 82, .12), transparent 75%), radial-gradient(ellipse 22% 14% at 82% 46%, rgba(255, 194, 112, .08), transparent 78%); inset: 0; mix-blend-mode: screen; opacity: .5; pointer-events: none; position: absolute; z-index: 1; }
      .motion-layer { inset: 0; height: 100%; object-fit: fill; pointer-events: none; position: absolute; width: 100%; z-index: 3; }
      .motion-clouds { animation: motion-clouds 78s ease-in-out infinite alternate; opacity: .22; z-index: 1; }
      .motion-fog { animation: motion-fog 42s ease-in-out infinite alternate; opacity: .28; z-index: 3; }
      .motion-rain { animation: motion-rain 2.8s linear infinite; opacity: .32; z-index: 5; }
      .motion-water { animation: motion-water 9s ease-in-out infinite alternate; opacity: .16; z-index: 2; }
      .motion-glow { animation: city-glow 11s ease-in-out infinite alternate; background: radial-gradient(ellipse 30% 18% at 56% 60%, rgba(255, 170, 91, .18), transparent 72%); mix-blend-mode: screen; opacity: .18; z-index: 2; }
      .scene-motion-canvas { display:block; height:100%; inset:0; pointer-events:none; position:absolute; width:100%; z-index:1; }
      .future-motion-layer { position:absolute; inset:0; z-index:2; pointer-events:none; }
      .future-motion-layer img, .future-motion-layer canvas { display:block; width:100%; height:100%; position:absolute; inset:0; pointer-events:none; }
      .future-motion-layer [hidden] { display:none !important; }
      .future-motion-layer .future-motion-symbol { mix-blend-mode:screen; }
      .future-motion-layer .future-motion-tower { mix-blend-mode:screen; }
      .future-motion-layer .future-motion-feature { mix-blend-mode:screen; }
      .wolf-symbol-light { height:100%; inset:0; mix-blend-mode:screen; pointer-events:none; position:absolute; width:100%; z-index:13; }
      .wolf-symbol-layer { height:100%; inset:0; pointer-events:none; position:absolute; width:100%; z-index:17; }
      .wolf-symbol-hit { cursor:pointer; fill:transparent; outline:none; pointer-events:all; stroke:transparent; touch-action:manipulation; }
      .wolf-dial-exit { cursor:pointer; fill:transparent; outline:none; pointer-events:none; stroke:transparent; touch-action:manipulation; }
      .wolf-secret-hit { cursor:pointer; fill:transparent; outline:none; pointer-events:none; stroke:transparent; touch-action:manipulation; }
      .wolf-symbol-layer.unlocked.menu-reward { opacity:1; }
      .wolf-secret-hit.reward-reveal { fill:#f5c96b35; stroke:#ffe5a0; stroke-width:8; filter:drop-shadow(0 0 18px #ffd36f); }
      .wolf-symbol-layer.unlocked { opacity:0; pointer-events:none; transition:opacity .45s; }
      .wolf-symbol-layer.unlocked .wolf-symbol-hit { pointer-events:none; }
      .wolf-symbol-layer.unlocked .wolf-dial-exit { pointer-events:all; }
      .wolf-symbol-layer.unlocked .wolf-secret-hit { pointer-events:all; }
      .wolf-crt-screen { background:transparent; clip-path:polygon(19.39% 2.53%,81.64% 2.53%,98.91% 98.09%,1.11% 96.85%); height:33.58%; left:22.07%; opacity:0; overflow:hidden; pointer-events:none; position:absolute; top:40.81%; transform:none; transform-origin:50% 50%; transition:opacity .3s,transform .48s cubic-bezier(.4,0,.9,.2); width:54.61%; z-index:15; }
      .crt-unlocked .wolf-crt-screen { opacity:1; pointer-events:auto; transform:none; }
      .wolf-wide-screen .wolf-crt-screen { clip-path:none; height:100dvh; inset:0; position:fixed; width:100vw; z-index:30; }
      .wolf-wide-screen .wolf-crt-bezel { display:none; }
      .wolf-crt-screen::before { background:radial-gradient(ellipse at center,transparent 48%,#000b 100%),repeating-linear-gradient(0deg,#0000 0 2px,#001a 3px 4px); content:""; inset:0; pointer-events:none; position:absolute; z-index:3; }
      .wolf-crt-screen::after { animation:wolf-crt-scan 2.8s linear infinite; background:linear-gradient(#9effff00,#caffff26,#9effff00); content:""; height:12%; left:0; pointer-events:none; position:absolute; top:-15%; width:100%; z-index:4; }
      .wolf-crt-screen iframe,.wolf-crt-boot { border:0; height:100%; inset:0; position:absolute; width:100%; }
      .wolf-crt-screen iframe { background:#000; }
      .wolf-crt-phosphor { inset:0; opacity:0; overflow:hidden; pointer-events:none; position:absolute; z-index:7; }
      .wolf-crt-ray { background:linear-gradient(180deg,#080a0a 0 34%,#626969 46%,#202424 55%,#070909 68% 100%); height:calc(100% / 480 + .18px); left:0; opacity:0; position:absolute; right:0; top:var(--beam-y); transform:scaleX(0); transform-origin:var(--beam-origin) 50%; }
      .wolf-crt-screen.beam-warm .wolf-crt-phosphor,.wolf-crt-screen.beam-raster .wolf-crt-phosphor,.wolf-crt-screen.beam-on .wolf-crt-phosphor,.wolf-crt-screen.beam-off .wolf-crt-phosphor { opacity:1; }
      .wolf-crt-screen.beam-warm .wolf-crt-phosphor { background:#000; }
      .wolf-crt-screen.beam-warm .wolf-crt-phosphor::after { animation:wolf-crt-ignite .72s cubic-bezier(.2,.82,.2,1) both; }
      .wolf-crt-screen.beam-raster .wolf-crt-phosphor { background:transparent; }
      .wolf-crt-screen.beam-raster .wolf-crt-ray { animation:wolf-crt-raster-build .24s ease-out var(--raster-delay) both; }
      .wolf-crt-screen.beam-on .wolf-crt-ray { animation:wolf-crt-raster-ignite .58s ease-out var(--energy-delay) both; transform:scaleX(1); }
      .wolf-crt-noise { height:100%; image-rendering:pixelated; inset:0; opacity:0; pointer-events:none; position:absolute; width:100%; z-index:8; }
      .wolf-crt-noise.active { opacity:1; }
      .wolf-crt-screen.beam-raster .wolf-crt-boot,.wolf-crt-screen.beam-warm .wolf-crt-boot { background:transparent; color:transparent; text-shadow:none; }
      .wolf-crt-screen.beam-off .wolf-crt-ray { animation:wolf-crt-raster-dim .62s ease-in var(--out-delay) both; transform:scaleX(1); }
      .wolf-crt-screen.beam-release .wolf-crt-phosphor { opacity:1; }
      .wolf-crt-screen.beam-release .wolf-crt-ray { animation:wolf-crt-raster-release .7s ease-in var(--release-delay) both; transform:scaleX(1); }
      .wolf-crt-bezel { z-index:9; }
      .wolf-crt-boot { align-items:center; background:#07110c; color:#8df8a8; display:flex; font:700 clamp(10px,1.15vw,18px)/1.5 ui-monospace,monospace; justify-content:center; letter-spacing:.08em; text-shadow:0 0 8px #6cff91; }
      .wolf-crt-boot[hidden],.wolf-crt-screen iframe[hidden] { display:none; }
      .wolf-crt-bezel { border:3px solid #171a18; box-shadow:inset 0 0 20px #000,0 0 10px #59e7ef3d; inset:0; pointer-events:none; position:absolute; z-index:9; }
      .wolf-crt-status { height:1px; overflow:hidden; position:absolute; width:1px; clip-path:inset(50%); }
      @keyframes wolf-crt-scan { to { top:110%; } }
      @keyframes wolf-crt-ignite { 0%{opacity:0;transform:scaleX(0)} 38%{opacity:1;transform:scaleX(.14)} 72%{opacity:.94;transform:scaleX(1)} 100%{opacity:.35;transform:scaleX(.82)} }
      @keyframes wolf-crt-raster-build { 0%{opacity:0;transform:scaleX(0)} 45%{opacity:.22;transform:scaleX(.56)} 100%{opacity:.78;transform:scaleX(1)} }
      @keyframes wolf-crt-raster-ignite { 0%{background:linear-gradient(180deg,#080a0a 0 34%,#626969 46%,#202424 55%,#070909 68% 100%);box-shadow:none;opacity:.78} 28%{background:#b7ffff;box-shadow:0 0 4px #5ff5ff;opacity:1} 52%{background:#36eaf4;box-shadow:0 0 3px #64f8ff;opacity:.86} 100%{background:transparent;box-shadow:none;opacity:0} }
      @keyframes wolf-crt-raster-dim { 0%{background:transparent;box-shadow:none;opacity:0} 34%{background:#cbd1d1;box-shadow:0 0 3px #f5ffff;opacity:.58} 58%{background:#f4f5f2;box-shadow:0 0 4px #fff;opacity:.82} 100%{background:linear-gradient(180deg,#060808 0 34%,#555d5d 46%,#191d1d 55%,#050707 68% 100%);box-shadow:none;opacity:.84} }
      @keyframes wolf-crt-raster-release { 0%{opacity:.84;transform:scaleX(1)} 32%{opacity:.45;transform:scaleX(.86)} 58%{opacity:.78;transform:scaleX(.54)} 100%{opacity:0;transform:scaleX(0)} }
      .wolf-crt-screen::before,.wolf-crt-screen::after { opacity:0; transition:opacity .34s ease; }
      .wolf-crt-screen.display-live::before,.wolf-crt-screen.display-live::after { opacity:1; }
      .wolf-crt-screen iframe { clip-path:polygon(50% 50%,50% 50%,50% 50%,50% 50%); opacity:0; }
      .wolf-crt-screen.game-revealing iframe,.wolf-crt-screen.display-live iframe { opacity:1; }
      .wolf-crt-screen.beam-hold .wolf-crt-phosphor { opacity:1; }
      .wolf-crt-screen.beam-hold .wolf-crt-ray { background:linear-gradient(180deg,transparent 0 35%,#747979 47%,#333737 58%,transparent 70% 100%); opacity:.58; transform:scaleX(1); }
      .wolf-crt-boot { display:none!important; }
      .wolf-crt-screen.compositor-active { background:transparent!important; }
      .wolf-crt-screen.compositor-active::before,.wolf-crt-screen.compositor-active::after { opacity:0!important; }
      .wolf-crt-screen.crt-filter-active::before { opacity:1!important; transition:opacity .46s ease; }
      .wolf-crt-screen.crt-filter-active::after { opacity:.72!important; transition:opacity .46s ease; }
      .wolf-crt-screen.compositor-active iframe { opacity:0!important; clip-path:none!important; }
      .wolf-crt-screen.compositor-live iframe { opacity:1!important; clip-path:none!important; }
      .wolf-crt-compositor { display:none; image-rendering:pixelated; inset:0; pointer-events:none; position:absolute; width:100%; height:100%; z-index:2; }
      .wolf-crt-screen.compositor-active .wolf-crt-compositor { display:block; }
      @media(prefers-reduced-motion:reduce){.wolf-crt-screen,.wolf-symbol-layer{transition:none}.wolf-crt-screen::after{animation:none}.wolf-crt-phosphor,.wolf-crt-ray,.wolf-crt-phosphor::after{animation:none!important}}
      .game-menu { background:rgba(7,21,32,.82); border:1px solid rgba(229,191,116,.5); color:#f2dca8; left:50%; min-width:min(380px,60%); padding:8px 20px 7px; pointer-events:none; position:absolute; text-align:center; top:34.5%; transform:translateX(-50%); z-index:14; }
      .game-menu strong { display:block; font:600 clamp(13px,1.35vw,21px)/1.15 Georgia,serif; letter-spacing:.06em; }
      .game-menu small { color:#a8dbe5; display:block; font-size:clamp(9px,.82vw,13px); margin-top:3px; }
      .game-scores { border-top:1px solid #d7ad6466; margin-top:7px; padding-top:5px; }
      .game-scores b { color:#f5ca80; font:700 10px/1.2 ui-monospace,monospace; letter-spacing:.16em; }
      .game-scores ol { columns:2; font:600 10px/1.35 ui-monospace,monospace; list-style-position:inside; margin:4px 0 0; padding:0; text-align:left; }
      .score-entry { background:#071520; border:1px solid #e5bf74; border-radius:8px; color:#f2dca8; padding:20px; text-align:center; }
      .score-entry::backdrop { background:#02070bcc; } .score-entry input { background:#0d2635; border:1px solid #69d7e8; color:#fff1bd; font:700 28px/1 ui-monospace,monospace; letter-spacing:.25em; padding:8px; text-align:center; text-transform:uppercase; width:6ch; }
      .score-entry button { background:#17394a; border:1px solid #d7ad64; color:#fff1bd; cursor:pointer; margin:12px 4px 0; padding:7px 12px; }
      .game-menu[data-mode="playing"] { background:rgba(7,21,32,.62); border-color:rgba(101,210,230,.2); min-width:0; padding:4px 12px; }
      .game-menu[data-mode="playing"] strong { display:none; }
      .game-menu[data-mode="playing"] small { margin:0; opacity:.82; }
      .crt-unlocked .game-menu { opacity:0; visibility:hidden; }
      @media (max-width: 700px) {
        .game-menu { min-width:0; max-width:58%; padding:4px 9px 3px; }
        .game-menu strong { font-size:clamp(10px,2.2vw,12px); letter-spacing:.035em; }
        .game-menu small { font-size:clamp(7.5px,1.65vw,9px); line-height:1.15; margin-top:1px; }
        .game-menu[data-mode="playing"] { max-width:58%; padding:3px 8px; }
      }
      .scene-audio-status { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
      @keyframes cloud-lightning {
        0%, 46%, 48.3%, 49.6%, 100% { opacity: 0; }
        46.7% { opacity: .21; }
        48.8% { opacity: .38; }
      }
      @keyframes cloud-drift {
        from { transform: translate3d(-1.8%, .3%, 0); }
        to { transform: translate3d(2.4%, -1.1%, 0); }
      }
      @keyframes fog-near {
        from { transform: translate3d(-2%, 1.4%, 0) scale(1.04); }
        to { transform: translate3d(3%, -1.6%, 0) scale(.96); }
      }
      @keyframes fog-far {
        from { transform: translate3d(2.5%, -.7%, 0); }
        to { transform: translate3d(-2.5%, 1.1%, 0); }
      }
      @keyframes aurora-shift {
        from { transform: translate3d(-3%, 0, 0) rotate(-2deg) scale(1.02); }
        to { transform: translate3d(4%, 1.6%, 0) rotate(2.5deg) scale(1.08); }
      }
      @keyframes city-glow {
        from { opacity: .32; transform: scale(.98); }
        to { opacity: .7; transform: scale(1.03); }
      }
      @keyframes motion-clouds { from { transform:translateX(-3%); } to { transform:translateX(3%); } }
      @keyframes motion-fog { from { transform:translateX(-5%) scale(1.03); } to { transform:translateX(4%) scale(.98); } }
      @keyframes motion-rain { from { transform:translateY(-50%); } to { transform:translateY(0); } }
      @keyframes motion-water { from { transform:translateX(-1.2%) scaleX(1.01); } to { transform:translateX(1.2%) scaleX(.99); } }
      @media (prefers-reduced-motion: reduce), (max-width: 700px) { .motion-layer { animation: none; } .motion-rain { display:none; } }
      .qr-overlay { align-items: center; background: rgba(0, 0, 0, .24); display: flex; justify-content: center; position: fixed; z-index: 20; }
      .qr-overlay[hidden] { display: none; }
      .qr.scan { background: #f7f7f5; box-shadow: 0 18px 46px rgba(0, 0, 0, .55); padding: 13px; position: relative; }
      .qr svg, .qr img { display: block; height: auto; width: 100%; }
      .qr-mark { align-items: center; aspect-ratio: 1; background: #08090b; border: 2px solid #f7f7f5; border-radius: 50%; color: #f7f7f5; display: flex; font: 700 clamp(18px, 5vw, 30px)/1 ui-sans-serif, system-ui, sans-serif; justify-content: center; left: 50%; letter-spacing: -0.08em; max-width: 44px; min-width: 28px; pointer-events: none; position: absolute; text-indent: -0.08em; top: 50%; transform: translate(-50%, -50%); width: 14%; }
      .qr-current { height: 100%; inset: 0; opacity: 0; pointer-events: none; position: absolute; width: 100%; z-index: 12; }
      .qr-current path { fill: none; stroke: #f5ca80; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; stroke-dasharray: 11 89; stroke-dashoffset: 100; }
      .qr-current path:first-child { filter: drop-shadow(0 0 7px #f5b85b) drop-shadow(0 0 15px #d99440); stroke-width: 4; }
      .qr-current path:last-child { stroke: #fff3cf; stroke-width: 1.2; }
      .qr-current.active { animation: qr-current-fade 1050ms ease-out both; }
      .qr-current.active path { animation: qr-current-travel 900ms cubic-bezier(.19,.66,.22,1) both; }
      .theme-qr .qr.scan::before { border: 1px solid rgba(239, 193, 117, .56); box-shadow: 0 0 17px rgba(241, 173, 81, .19), inset 0 0 12px rgba(241, 173, 81, .12); content: ''; inset: -10px; pointer-events: none; position: absolute; }
      .theme-qr.materializing { animation: qr-backdrop 850ms ease-out both; }
      .theme-qr.materializing .qr.scan { animation: qr-card-arrive 900ms cubic-bezier(.16,.74,.24,1) both; }
      .theme-qr.materializing .qr.scan > img, .theme-qr.materializing .qr.scan > svg, .theme-qr.materializing .qr-mark { animation: qr-ink 900ms linear both; }
      .theme-qr.materializing .qr.scan::before { animation: qr-frame-light 950ms ease-out both; }
      .theme-qr.materializing .qr.scan::after { animation: qr-orbit 950ms ease-out both; background: radial-gradient(circle at 50% 0, #e8fdff 0 3px, rgba(108, 218, 239, .38) 4px, transparent 10px); border: 1px solid rgba(108, 218, 239, .65); border-radius: 50%; content: ''; inset: -23px; pointer-events: none; position: absolute; transform: rotate(-26deg) scaleY(.72); }
      @keyframes qr-current-fade { 0%, 72% { opacity: 1; } 100% { opacity: 0; } }
      @keyframes qr-current-travel { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
      @keyframes qr-backdrop { from { background: rgba(0, 0, 0, 0); } to { background: rgba(0, 0, 0, .24); } }
      @keyframes qr-card-arrive { 0%, 20% { opacity: 0; transform: translateY(8px) scale(.97); } 48%, 100% { opacity: 1; transform: none; } }
      @keyframes qr-ink { 0%, 48% { opacity: 0; } 100% { opacity: 1; } }
      @keyframes qr-frame-light { 0% { opacity: 0; box-shadow: 0 0 0 rgba(241, 173, 81, 0); } 58% { opacity: 1; box-shadow: 0 0 32px rgba(241, 173, 81, .7); } 100% { opacity: 1; box-shadow: 0 0 17px rgba(241, 173, 81, .19); } }
      @keyframes qr-orbit { 0% { opacity: 0; transform: rotate(-26deg) scaleY(.72); } 30% { opacity: .75; } 100% { opacity: 0; transform: rotate(142deg) scaleY(.72); } }
      @media (prefers-reduced-motion: reduce) { .qr-current { display: none; } .theme-qr.materializing, .theme-qr.materializing .qr.scan, .theme-qr.materializing .qr.scan > img, .theme-qr.materializing .qr.scan > svg, .theme-qr.materializing .qr-mark, .theme-qr.materializing .qr.scan::before, .theme-qr.materializing .qr.scan::after { animation: none; } .theme-qr.materializing .qr.scan::after { display: none; } }
      .scene { aspect-ratio: ${background.width} / ${background.height}; background-image: url('${backgroundUrl}'); cursor: grab; touch-action: none; transform: none; }
      .scene.panning { cursor: grabbing; }
    </style>
  </head>
  <body>
    <div class="scene">
      ${legacyAtmosphere}
      ${motionLayers}
      ${bundledMotion ? '<canvas class="scene-motion-canvas" aria-hidden="true"></canvas>' : ''}
      ${futureMotion ? `<div class="future-motion-layer" aria-hidden="true"><img class="future-motion-source" src="${backgroundUrl}" alt="" draggable="false"><canvas class="future-motion-canvas" width="1672" height="941"></canvas><canvas class="future-motion-mask" width="1672" height="941" hidden></canvas><canvas class="future-motion-symbol" width="1672" height="941"></canvas><canvas class="future-motion-tower" width="1672" height="941"></canvas><canvas class="future-motion-feature" width="1672" height="941"></canvas></div>` : ''}
      ${carousel ? '<canvas class="wolf-symbol-light" id="wolfSymbolLight" width="1672" height="941" aria-hidden="true"></canvas><div class="wolf-crt-screen" id="wolfCrtScreen"><div class="wolf-crt-boot" id="wolfCrtBoot">WOLF3D CRT BOOT...</div><iframe id="wolfFrame" title="Wolfenstein 3D" hidden allow="autoplay; fullscreen"></iframe><div class="wolf-crt-bezel" aria-hidden="true"></div></div><output class="wolf-crt-status" id="wolfCrtStatus" aria-live="polite"></output>' : ''}
      ${interactive ? '<svg id="sceneGame" class="scene-game-layer" viewBox="0 0 1672 941" aria-label="Interactive table puzzle"></svg>' : ''}
      ${carousel ? '<div class="game-menu" id="gameMenu"><strong id="gameTitle"></strong><small id="gameDetail"></small><div class="game-scores" id="gameScores" hidden><b>TOP 10</b><ol id="gameScoreList"></ol></div></div><output class="scene-audio-status" id="sceneAudioStatus" aria-live="polite">Calm Ether</output>' : ''}
      ${futureMotion ? '<svg class="qr-current" viewBox="0 0 1672 941" aria-hidden="true"><path pathLength="100" d="M 451 377 L 1190 377 L 1402 721 L 168 721 Z"/><path pathLength="100" d="M 451 377 L 1190 377 L 1402 721 L 168 721 Z"/></svg>' : ''}
    </div>
    ${carousel ? '<dialog class="score-entry" id="scoreEntry"><form id="scoreForm" method="dialog"><h2>TOP 10 SCORE</h2><p id="scoreMessage"></p><label>Three initials <input id="scoreInitials" maxlength="3" pattern="[A-Za-z]{3}" autocomplete="off" required></label><div><button type="submit">SAVE SCORE</button><button type="button" id="scoreSkip">SKIP</button></div></form></dialog>' : ''}
    <div class="qr-overlay ${futureMotion ? 'theme-qr' : ''}" id="scanOverlay" hidden><div class="qr scan"><img id="scanImage" alt=""><div class="qr-mark" aria-hidden="true">Z</div></div></div>
    ${firewall?.enabled ? `<div class="qr-overlay ${futureMotion ? 'theme-qr' : ''}" id="firewallOverlay" hidden><div class="qr scan" aria-label="Firewall sign-in QR code"></div></div>` : ''}
    <script nonce="${scriptNonce}" src="/scene-framing.js?v=23"></script>
    ${interactive ? `<script nonce="${scriptNonce}" src="/scene-game.js?v=60"></script>` : ''}
    ${carousel ? `<script nonce="${scriptNonce}" src="/future-game-carousel.js?v=66"></script><script nonce="${scriptNonce}" src="/future-nature-audio.js?v=46"></script><script nonce="${scriptNonce}" src="/future-sample-audio.js?v=48"></script>` : ''}
    ${bundledMotion ? `<script nonce="${scriptNonce}" src="/scene-motion.js?v=15"></script>` : ''}
    ${futureMotion ? `<script nonce="${scriptNonce}" src="/future-motion-runtime.js?v=41"></script>` : ''}
    ${futureMotion ? `<script nonce="${scriptNonce}" src="/future-feature-clicks.js?v=48"></script>` : ''}
    ${carousel ? `<script nonce="${scriptNonce}" src="/future-wolf3d-crt.js?v=78"></script>` : ''}
    <script nonce="${scriptNonce}">
      ${bundledMotion ? `{
        const canvas = document.querySelector('.scene-motion-canvas');
        const image = new Image();
        image.onload = async () => {
          try {
            const response = await fetch('/scene-bundles/${background.bundleId}/motion.json?v=15');
            if (!response.ok) return;
            const bundle = await response.json();
            const selected = ${JSON.stringify(Object.entries(motion.effects).filter(([, enabled]) => enabled).map(([id]) => id))};
            if (!SceneMotion.create(canvas, image, bundle, selected)) canvas.remove();
          } catch (_) { canvas.remove(); }
        };
        image.onerror = () => canvas.remove();
        image.src = ${JSON.stringify(backgroundUrl)};
      }` : ''}
      const scene = document.querySelector('.scene');
      ${interactive && !carousel ? `window.SceneGame.mount(document.getElementById('sceneGame'));` : ''}
      ${carousel ? `const natureAudio=FutureNatureAudio.mount({target:document});natureAudio.setLayer('waterfall',1);natureAudio.setLayer('wind',1);natureAudio.setLayer('chimes',1);natureAudio.setTrack('none');const sampleAudio=FutureSampleAudio.mount({target:document,defaultSample:'ether'});let wolfCrt;const gameCarousel=FutureGameCarousel.mount({svg:document.getElementById('sceneGame'),target:scene,image:document.querySelector('.future-motion-source'),title:document.getElementById('gameTitle'),detail:document.getElementById('gameDetail'),scoreboard:document.getElementById('gameScores'),scoreList:document.getElementById('gameScoreList'),scoreDialog:document.getElementById('scoreEntry'),scoreForm:document.getElementById('scoreForm'),scoreInitials:document.getElementById('scoreInitials'),scoreMessage:document.getElementById('scoreMessage'),scoreSkip:document.getElementById('scoreSkip'),onMastery:()=>wolfCrt?.reveal('WL6'),onGameSound:(kind,detail)=>natureAudio.gameCue(kind,detail)});const audioStatus=document.getElementById('sceneAudioStatus');let starClickTimer=0;const isCenterStar=(event)=>{const box=scene.getBoundingClientRect(),x=(event.clientX-box.left)*1672/box.width,y=(event.clientY-box.top)*941/box.height;return Math.hypot(x-820,y-729)<=42;};scene.addEventListener('click',(event)=>{if(!isCenterStar(event))return;clearTimeout(starClickTimer);starClickTimer=setTimeout(()=>{const next=sampleAudio.cycle();audioStatus.value=next.name;starClickTimer=0;},260);});scene.addEventListener('dblclick',(event)=>{if(!isCenterStar(event))return;event.preventDefault();clearTimeout(starClickTimer);starClickTimer=0;const state=sampleAudio.state();if(state.playing){sampleAudio.pause();audioStatus.value='Background music off';}else{sampleAudio.play();audioStatus.value='Background music on';}});` : ''}
      ${futureMotion ? `window.FutureMotion.mount(document.querySelector('.future-motion-layer'), { interactionTarget: scene });` : ''}
      ${futureMotion ? `window.FutureFeatureClicks.mount({ image: document.querySelector('.future-motion-source'), canvas: document.querySelector('.future-motion-feature'), target: scene });` : ''}
      ${carousel ? `wolfCrt=FutureWolfCrt.mount({scene,screen:document.getElementById('wolfCrtScreen'),iframe:document.getElementById('wolfFrame'),boot:document.getElementById('wolfCrtBoot'),status:document.getElementById('wolfCrtStatus'),image:document.querySelector('.future-motion-source'),lightCanvas:document.getElementById('wolfSymbolLight'),wolfUrl:'/wolf3d/?game=WL6&crt=68',sodUrl:'/wolf3d/?game=SOD&crt=68',onExit:(direction)=>direction<0?gameCarousel.previous():gameCarousel.next(),onZoom:(factor,x,y)=>zoomAt(camera.zoom*factor,x,y)});if(['localhost','127.0.0.1','::1'].includes(location.hostname)){const panel=document.createElement('aside');panel.id='arcadeWinHarness';panel.style.cssText='position:fixed;z-index:10000;right:10px;top:10px;max-width:310px;padding:10px;background:#071520ee;border:1px solid #e5bf74;color:#fff1bd;font:12px ui-monospace,monospace';panel.innerHTML='<b>LOCAL WIN HARNESS</b><p>Uses real score and reward controllers.</p>';const actions=[['2048 Fusion','fusion'],['2048 Standard','classic2048'],['Lights Out','lights'],['Treasure Path','treasure'],["Knight’s Tour",'knight'],['Peg Solitaire','pegs'],['Orbital Reversi','reversi'],['Four in a Row','four'],['Celestial Circuit','circuit'],['Wolf → Spear','reward:SOD'],['Spear → Menu','reward:MENU']];for(const[label,action]of actions){const button=document.createElement('button');button.type='button';button.textContent=label;button.style.cssText='margin:3px;padding:5px;background:#17394a;border:1px solid #d7ad64;color:#fff1bd';button.onclick=()=>action.startsWith('reward:')?wolfCrt.testReward(action.slice(7)):gameCarousel.testFinish(action);panel.append(button);}document.body.append(panel);window.arcadeWinHarness={finish:(game)=>gameCarousel.testFinish(game),reward:(target)=>wolfCrt.testReward(target)};}` : ''}
      const scanOverlay = document.querySelector('#scanOverlay');
      const scanCard = scanOverlay.querySelector('.qr.scan');
      const scanImage = document.querySelector('#scanImage');
      const firewallOverlay = document.querySelector('#firewallOverlay');
      const firewallCard = firewallOverlay?.querySelector('.qr.scan');
      const qrCurrent = document.querySelector('.qr-current');
      const frames = ${JSON.stringify(sceneConfig.viewport.frames || {})};
      const camera = { width: 0, height: 0, left: 0, top: 0, zoom: 1, moved: false, profile: 'full',
        viewport: null };
      const pointers = new Map();
      let pinch = null;
      let suppressClick = false;
      let checkingClick = false;
      function visibleViewport() {
        const viewport = window.visualViewport;
        return viewport ? { left: viewport.offsetLeft, top: viewport.offsetTop,
          width: viewport.width, height: viewport.height }
          : { left: 0, top: 0, width: innerWidth, height: innerHeight };
      }
      function eventPoint(event) {
        const viewport = visibleViewport();
        return { x: event.clientX + viewport.left, y: event.clientY + viewport.top };
      }
      function positionScanOverlay(viewport) {
        scanOverlay.style.left = viewport.left + 'px';
        scanOverlay.style.top = viewport.top + 'px';
        scanOverlay.style.width = viewport.width + 'px';
        scanOverlay.style.height = viewport.height + 'px';
        scanCard.style.width = Math.min(380, viewport.width * 0.72) + 'px';
        if (firewallOverlay) {
          firewallOverlay.style.left = viewport.left + 'px';
          firewallOverlay.style.top = viewport.top + 'px';
          firewallOverlay.style.width = viewport.width + 'px';
          firewallOverlay.style.height = viewport.height + 'px';
          firewallCard.style.width = Math.min(380, viewport.width * 0.72) + 'px';
        }
      }
      function clampCamera() {
        const viewport = visibleViewport();
        camera.left = camera.width >= viewport.width
          ? Math.max(viewport.left + viewport.width - camera.width, Math.min(viewport.left, camera.left))
          : viewport.left + (viewport.width - camera.width) / 2;
        camera.top = camera.height >= viewport.height
          ? Math.max(viewport.top + viewport.height - camera.height, Math.min(viewport.top, camera.top))
          : viewport.top + (viewport.height - camera.height) / 2;
      }
      function paintCamera() {
        clampCamera();
        const viewport = visibleViewport();
        scene.style.width = camera.width + 'px';
        scene.style.height = camera.height + 'px';
        scene.style.left = camera.left + 'px';
        scene.style.top = camera.top + 'px';
        if (!scanOverlay.hidden || (firewallOverlay && !firewallOverlay.hidden)) positionScanOverlay(viewport);
      }
      function applySceneFrame() {
        if (!window.SceneFraming) return;
        const viewport = visibleViewport();
        const previousCenter = camera.width ? {
          x: (camera.viewport.left + camera.viewport.width / 2 - camera.left) / camera.width,
          y: (camera.viewport.top + camera.viewport.height / 2 - camera.top) / camera.height,
        } : null;
        const result = SceneFraming.layout(${background.width}, ${background.height}, viewport.width, viewport.height, frames);
        camera.profile = result.profile;
        camera.width = result.width * camera.zoom;
        camera.height = result.height * camera.zoom;
        if (camera.moved && previousCenter) {
          camera.left = viewport.left + viewport.width / 2 - previousCenter.x * camera.width;
          camera.top = viewport.top + viewport.height / 2 - previousCenter.y * camera.height;
        } else {
          camera.left = viewport.left + result.left;
          camera.top = viewport.top + result.top;
        }
        camera.viewport = viewport;
        paintCamera();
      }
      applySceneFrame();
      window.addEventListener('resize', applySceneFrame);
      window.visualViewport?.addEventListener('resize', applySceneFrame);
      window.visualViewport?.addEventListener('scroll', applySceneFrame);
      function toggleScanView() {
        if (scanOverlay.hidden) {
          scanImage.src = '/challenge/current/qr';
          openQrOverlay(scanOverlay);
        } else {
          closeQrOverlay(scanOverlay);
          scanImage.removeAttribute('src');
        }
      }
      function openQrOverlay(overlay) {
        overlay.hidden = false;
        if (qrCurrent) {
          qrCurrent.classList.remove('active');
          void qrCurrent.getBoundingClientRect();
          qrCurrent.classList.add('active');
          overlay.classList.remove('materializing');
          void overlay.getBoundingClientRect();
          overlay.classList.add('materializing');
        }
        positionScanOverlay(visibleViewport());
      }
      function closeQrOverlay(overlay) {
        overlay.hidden = true;
        overlay.classList.remove('materializing');
        qrCurrent?.classList.remove('active');
      }
      scanOverlay.addEventListener('click', toggleScanView);
      if (firewallOverlay) firewallOverlay.addEventListener('click', () => closeQrOverlay(firewallOverlay));
      scene.addEventListener('click', async (event) => {
        if (suppressClick) { suppressClick = false; return; }
        if (checkingClick || !scanOverlay.hidden || (firewallOverlay && !firewallOverlay.hidden)) return;
        const point = eventPoint(event);
        const x = (point.x - camera.left) / camera.width;
        const y = (point.y - camera.top) / camera.height;
        if (![x, y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) return;
        ${carousel ? `const boardX=x*1672,boardY=y*941;const gameControl=(boardY>=807&&boardY<=941&&((boardX>=435&&boardX<=565)||(boardX>=610&&boardX<=1035)||(boardX>=1080&&boardX<=1218)))||Math.hypot(boardX-820,boardY-729)<=42;if(gameControl)return;` : ''}
        checkingClick = true;
        try {
          const response = await fetch('/api/scene/hit', { method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ x, y, width: camera.width, height: camera.height }) });
          if (!response.ok) return;
          const result = await response.json();
          if (result.destination === 'torrentharbor') toggleScanView();
          else if (result.destination === 'firewall') await openFirewallQr();
        } catch (_) {
          // A failed lookup leaves the scene interactive for the next click.
        } finally { checkingClick = false; }
      });
      function zoomAt(nextZoom, x, y) {
        const zoom = Math.min(${sceneConfig.viewport.maximumZoom}, Math.max(${sceneConfig.viewport.minimumZoom}, nextZoom));
        const fractionX = (x - camera.left) / camera.width;
        const fractionY = (y - camera.top) / camera.height;
        const factor = zoom / camera.zoom;
        camera.width *= factor;
        camera.height *= factor;
        camera.left = x - fractionX * camera.width;
        camera.top = y - fractionY * camera.height;
        camera.zoom = zoom;
        camera.moved = true;
        paintCamera();
      }
      scene.addEventListener('wheel', (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        // Android may also emit Ctrl-wheel for the same touch pinch. Handle
        // coarse-pointer pinches only through the pointer path below.
        if (matchMedia('(pointer: coarse)').matches) return;
        const point = eventPoint(event);
        zoomAt(camera.zoom + (event.deltaY < 0 ? ${sceneConfig.viewport.zoomIncrement} : -${sceneConfig.viewport.zoomIncrement}), point.x, point.y);
      }, { passive: false });
      scene.addEventListener('pointerdown', (event) => {
        if (!scanOverlay.hidden || (firewallOverlay && !firewallOverlay.hidden)) return;
        // Board games own their entire pointer gesture. Do not enroll a tile
        // pointer in scene panning and steal pointerup from swipe/drag games.
        if (event.target.closest?.('.game-tile, .board-hit')) return;
        const point = eventPoint(event);
        ${carousel ? `const boardX=(point.x-camera.left)*1672/camera.width,boardY=(point.y-camera.top)*941/camera.height;if(boardY>=377&&boardY<=721){const depth=(boardY-377)/344,left=451+(168-451)*depth,right=1190+(1402-1190)*depth;if(boardX>=left&&boardX<=right)return;}` : ''}
        scene.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, { x: point.x, y: point.y,
          startX: point.x, startY: point.y, active: false });
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          pinch = distance >= 40 ? { distance, zoom: camera.zoom } : null;
        }
      });
      scene.addEventListener('pointermove', (event) => {
        const previous = pointers.get(event.pointerId);
        if (!previous) return;
        const point = eventPoint(event);
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        pointers.set(event.pointerId, { ...previous, x: point.x, y: point.y });
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (!pinch && distance >= 40) pinch = { distance, zoom: camera.zoom };
          else if (pinch) {
            const requested = pinch.zoom * distance / pinch.distance;
            zoomAt(Math.max(camera.zoom / 1.15, Math.min(camera.zoom * 1.15, requested)),
              (a.x + b.x) / 2, (a.y + b.y) / 2);
          }
          suppressClick = true;
        } else if (pointers.size === 1 && Math.hypot(dx, dy) > 0) {
          if (!previous.active) {
            if (Math.hypot(point.x - previous.startX, point.y - previous.startY) < 8) return;
            if (!scene.hasPointerCapture(event.pointerId)) scene.setPointerCapture(event.pointerId);
            pointers.set(event.pointerId, { ...previous, x: point.x, y: point.y, active: true });
            suppressClick = true;
            return;
          }
          camera.left += Math.max(-32, Math.min(32, dx));
          camera.top += Math.max(-32, Math.min(32, dy));
          camera.moved = true;
          scene.classList.add('panning');
          suppressClick = true;
          paintCamera();
        }
      });
      function endPan(event) {
        pointers.delete(event.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!pointers.size) {
          scene.classList.remove('panning');
          setTimeout(() => { suppressClick = false; }, 0);
        }
      }
      scene.addEventListener('pointerup', endPan);
      scene.addEventListener('pointercancel', endPan);
      scene.addEventListener('lostpointercapture', endPan);
      window.addEventListener('blur', () => { pointers.clear(); pinch = null; scene.classList.remove('panning'); });
      document.addEventListener('keydown', (event) => {
        if (!scanOverlay.hidden || (firewallOverlay && !firewallOverlay.hidden)) return;
        const viewport = visibleViewport();
        const offset = Math.round(Math.min(viewport.width, viewport.height) * 0.12);
        const delta = { ArrowLeft: [offset, 0], ArrowRight: [-offset, 0],
          ArrowUp: [0, offset], ArrowDown: [0, -offset] }[event.key];
        if (!delta) return;
        event.preventDefault();
        camera.left += delta[0];
        camera.top += delta[1];
        camera.moved = true;
        paintCamera();
      });
      scanImage.addEventListener('error', () => { closeQrOverlay(scanOverlay); scanImage.removeAttribute('src'); });
      function openFirewallHandoff(status) {
        if (status.action !== ${JSON.stringify(new URL('_handoff', DESTINATIONS.firewall.publicRoute).href)}
          || !/^[A-Za-z0-9_-]{43}$/.test(status.handoff || '')) return;
        clearInterval(portalPoll);
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = status.action;
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'handoff';
        input.value = status.handoff;
        form.append(input);
        document.body.append(form);
        form.submit();
      }
      async function openFirewallQr() {
        if (!firewallOverlay) return;
        const response = await fetch('/api/challenge/firewall', { method: 'POST', credentials: 'same-origin' });
        if (!response.ok) return;
        const challenge = await response.json();
        firewallCard.innerHTML = challenge.qr + '<div class="qr-mark" aria-hidden="true">Z</div>';
        openQrOverlay(firewallOverlay);
        const poll = setInterval(() => fetch('/challenge/' + challenge.token, { credentials: 'same-origin' })
          .then((reply) => reply.json()).then((status) => {
            if (status.handoff) { clearInterval(poll); openFirewallHandoff(status); }
          }).catch(() => {}), 1500);
        setTimeout(() => clearInterval(poll), 900000);
      }
      const portalPoll = setInterval(() => fetch('/challenge/current', { credentials: 'same-origin' }).then((response) => response.json()).then((result) => { if (result.terminal) { clearInterval(portalPoll); return; } if (result.redirect) location = result.redirect; }).catch(() => {}), 1500);
      // QR expiry is enforced by the challenge endpoints; never expire the Arcade page.
    </script>
  </body>
</html>`;
}

module.exports = { landingPage };
