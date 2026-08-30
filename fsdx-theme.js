/* ==========================================================================
   FSD-X — "Knightfall" theme layer  v3
   Terminal palette: near-black ground, dialed-back grid, hot orange accent.

   Load AFTER the Tailwind CDN script:
       <script src="fsdx-theme.js"></script>

   Layout variant is set on the <html> tag:
       <html lang="en" data-fx="a">   A · Banded   — alternating section bands, rail on the nav edge
       <html lang="en" data-fx="b">   B · Panels   — sections float as cards on the grid
       <html lang="en" data-fx="c">   C · Terminal — sharp corners, stronger grid, mono labels
   No data-fx attribute = shared base only.
   Remove the script tag to revert a page completely.
   ========================================================================== */
(function () {

  /* ---------- 1. Palette -------------------------------------------------
     zinc  -> blue-tinted slate (backgrounds + body copy)
     green -> the brand accent  (links, CTAs, highlights, badges)
     emerald / red -> untouched (reserved for P&L and win/loss)

     Colour scheme is set on the <html> tag:
       data-fx-pal="1"  Ember    — navy ground, orange accent
       data-fx-pal="2"  Gold     — deeper blue ground, amber accent
       data-fx-pal="3"  Terminal — near-black ground, hot orange accent   (SITE DEFAULT)
       data-fx-pal="4"  Two-tone — ice-blue ambient, orange reserved for CTAs
  ------------------------------------------------------------------------ */
  var PAL = document.documentElement.getAttribute('data-fx-pal') || '3';   /* site default: Terminal */

  var SCHEMES = {
    /* accent = the Tailwind "green" scale; ink/mid/deep = page ground */
    '1': {
      accent: { 300:'#FFB88A', 400:'#F5822F', 500:'#F26B21', 600:'#DD5A14',
                700:'#B4470F', 800:'#7E320B', 900:'#4B1E06', 950:'#2A1003' },
      slate:  { 50:'#F3F7FC',100:'#E4ECF6',200:'#C8D8E9',300:'#A3B8D2',
                400:'#8098B7',500:'#647E9C',600:'#4C6484',700:'#31465F',
                800:'#1C2E45',900:'#101F33',950:'#0A1626' },
      black:'#050A12',
      ground:['#081120','#0A1728','#060C16'],
      glowA:'rgba(242,107,33,.10)', glowB:'rgba(38,96,168,.16)',
      grid:'rgba(126,170,224,.038)', line:'rgba(126,170,224,.14)',
      rail:['#FFB25E','#F26B21','#F5A21F'], railGlow:'rgba(242,107,33,.55)',
      btn:['#F98B34','#F26B21','#DE580F'], btnHi:['#FFA057','#F5822F','#EC6A17'],
      tint:'rgba(242,107,33,.09)', tintOn:'rgba(242,107,33,.12)',
      activeText:'#FFC49A', mark:'#F26B21',
    },
    '2': {
      accent: { 300:'#FFDC92', 400:'#F5B21F', 500:'#F0A81C', 600:'#D68F0C',
                700:'#A96F07', 800:'#764C05', 900:'#452C03', 950:'#241701' },
      slate:  { 50:'#F2F7FD',100:'#E1EBF7',200:'#C3D6EC',300:'#9CB6D6',
                400:'#7B95B9',500:'#5E7BA3',600:'#455F87',700:'#2B4265',
                800:'#182B4A',900:'#0E1D38',950:'#08152B' },
      black:'#040B18',
      ground:['#060F1E','#0A1830','#050B16'],
      glowA:'rgba(240,168,28,.09)', glowB:'rgba(32,88,170,.20)',
      grid:'rgba(130,175,235,.042)', line:'rgba(130,175,235,.15)',
      rail:['#FFDC92','#F0A81C','#D68F0C'], railGlow:'rgba(240,168,28,.50)',
      btn:['#FFC44D','#F0A81C','#D08A08'], btnHi:['#FFD877','#F5B21F','#E09A10'],
      tint:'rgba(240,168,28,.09)', tintOn:'rgba(240,168,28,.13)',
      activeText:'#FFD98F', mark:'#F0A81C',
    },
    '3': {
      accent: { 300:'#FFB489', 400:'#FF7A2E', 500:'#FF6B1F', 600:'#E85712',
                700:'#B8420C', 800:'#7C2C07', 900:'#471803', 950:'#260C01' },
      slate:  { 50:'#F4F6F9',100:'#E6EAF0',200:'#CBD3DE',300:'#A2AEBF',
                400:'#7D8B9E',500:'#61707F',600:'#485565',700:'#2E3945',
                800:'#1A222C',900:'#0E141C',950:'#080D14' },
      black:'#04070C',
      ground:['#05080D','#080D15','#04070B'],
      glowA:'rgba(255,107,31,.11)', glowB:'rgba(30,72,130,.13)',
      grid:'rgba(120,160,210,.028)', line:'rgba(120,160,210,.13)',
      rail:['#FFA061','#FF6B1F','#FF8A2B'], railGlow:'rgba(255,107,31,.6)',
      btn:['#FF9247','#FF6B1F','#EB550D'], btnHi:['#FFA96A','#FF7A2E','#F76318'],
      tint:'rgba(255,107,31,.10)', tintOn:'rgba(255,107,31,.14)',
      activeText:'#FFC0A0', mark:'#FF6B1F',
    },
    '4': {
      /* ambient goes ice blue; the solid CTA buttons stay orange (see CSS below) */
      accent: { 300:'#BFDEFF', 400:'#6FB4F2', 500:'#4A9BE8', 600:'#3583D0',
                700:'#2668AB', 800:'#194777', 900:'#0E2A47', 950:'#071626' },
      slate:  { 50:'#F3F7FC',100:'#E4ECF6',200:'#C8D8E9',300:'#A3B8D2',
                400:'#8098B7',500:'#647E9C',600:'#4C6484',700:'#31465F',
                800:'#1C2E45',900:'#101F33',950:'#0A1626' },
      black:'#050A12',
      ground:['#081120','#0A1728','#060C16'],
      glowA:'rgba(242,107,33,.09)', glowB:'rgba(38,96,168,.18)',
      grid:'rgba(126,170,224,.042)', line:'rgba(126,170,224,.15)',
      rail:['#FFB25E','#F26B21','#F5A21F'], railGlow:'rgba(242,107,33,.55)',
      btn:['#F98B34','#F26B21','#DE580F'], btnHi:['#FFA057','#F5822F','#EC6A17'],
      tint:'rgba(242,107,33,.09)', tintOn:'rgba(242,107,33,.12)',
      activeText:'#FFC49A', mark:'#F26B21',
    },
  };

  var S = SCHEMES[PAL] || SCHEMES['1'];

  window.tailwind = window.tailwind || {};
  tailwind.config = {
    theme: {
      extend: {
        fontFamily: {
          sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        },
        colors: { black: S.black, zinc: S.slate, green: S.accent },
      },
    },
  };

  /* ---------- 2. Typography ---------------------------------------------- */
  var pre = document.createElement('link');
  pre.rel = 'preconnect'; pre.href = 'https://fonts.gstatic.com'; pre.crossOrigin = '';
  document.head.appendChild(pre);
  var font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap';
  document.head.appendChild(font);

  /* ---------- 3. Styles --------------------------------------------------- */
  function hexA(h, a) {
    var n = parseInt(h.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  var css = `
  :root{
    --fx-orange:${S.mark};
    --fx-orange-2:${S.rail[2]};
    --fx-ink:${S.black};
    --fx-line:${S.line};
    --fx-mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  }

  html{
    -webkit-text-size-adjust:100%;
    background-color:${S.ground[1]} !important;
    background-image:none !important;
  }

  body{
    font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif !important;
    background:transparent !important;
  }

  /* Grid wash is OFF — the ground is a solid colour.
     To bring the grid back, put data-fx-grid="on" on the <html> tag. */
  [data-fx-grid="on"] body::after{
    content:'';position:fixed;inset:0;z-index:9998;pointer-events:none;
    background-image:
      linear-gradient(${S.grid} 1px,transparent 1px),
      linear-gradient(90deg,${S.grid} 1px,transparent 1px);
    background-size:64px 64px;
    -webkit-mask-image:radial-gradient(120% 100% at 50% 0%,#000 30%,rgba(0,0,0,.45) 100%);
            mask-image:radial-gradient(120% 100% at 50% 0%,#000 30%,rgba(0,0,0,.45) 100%);
  }

  /* accent rail at the window edge */
  body::before{
    content:'';position:fixed;left:0;top:0;bottom:0;width:7px;z-index:9999;pointer-events:none;
    background:linear-gradient(180deg,${S.rail[0]} 0%,${S.rail[1]} 40%,${S.rail[2]} 78%,rgba(242,161,31,.30) 100%);
    box-shadow:0 0 30px 4px ${S.railGlow};
  }
  @media (max-width:767px){ body::before{ width:4px; } }

  /* ---------- panels ---------- */
  .bg-black{ background-color:${hexA(S.black,.55)} !important; }
  .bg-zinc-950{ background-color:${hexA(S.slate[950],.84)} !important; }
  .bg-zinc-900{ background-color:${hexA(S.slate[900],.74)} !important; }

  aside#sidebar-panel{
    background:${S.slate[950]} !important;
    border-right:1px solid var(--fx-line) !important;
    box-shadow:18px 0 48px -30px rgba(0,0,0,.9);
  }
  /* Pinned nav footer.
     nav.html gives #nav-content a fixed h-full, so on a logged-in (VIP) menu the list
     overflows and the sticky block lands mid-list with items scrolling behind it.
     Letting the wrapper grow puts it back at the true bottom. */
  aside#sidebar-panel #nav-content{ height:auto !important; min-height:100%; flex:0 0 auto !important; }
  /* the aside's own 24px bottom padding sits BELOW the sticky footer, so scrolled
     items show through that strip — hand the padding to the footer instead */
  aside#sidebar-panel{ padding-bottom:0 !important; }
  aside#sidebar-panel #nav-content > *:last-child{
    margin-top:auto !important;
    margin-bottom:0 !important;
    padding-bottom:24px !important;
    background:${S.slate[950]} !important;
    box-shadow:0 -14px 22px -12px ${hexA(S.black,.95)};
  }
  /* the Logout button ships without flex, so its icon and label never line up */
  aside#sidebar-panel button[onclick*="navLogout"]:not(.hidden){
    display:flex !important; align-items:center; gap:.5rem;
  }

  header.md\\:hidden{
    background:${S.slate[950]} !important;
    border-bottom:1px solid var(--fx-line) !important;
  }

  .border-white\\/10{ border-color:var(--fx-line) !important; }
  .border-white\\/5 { border-color:rgba(126,170,224,.09) !important; }

  /* ---------- cards: 1px top highlight + hover lift ---------- */
  .rounded-3xl,.rounded-2xl,.rounded-xl{
    transition:border-color .18s ease, transform .18s ease, box-shadow .18s ease;
  }
  section [class*="rounded-"][class*="border"]{ position:relative; }
  section [class*="rounded-"][class*="border"]::before{
    content:'';position:absolute;left:14%;right:14%;top:-1px;height:1px;pointer-events:none;
    background:linear-gradient(90deg,transparent,rgba(190,220,255,.30),transparent);
  }
  section [class*="rounded-"][class*="border"]:hover{
    transform:translateY(-2px);
    box-shadow:0 18px 40px -24px rgba(0,0,0,.9);
  }

  /* ---------- primary buttons ---------- */
  .bg-green-500{
    background-image:linear-gradient(135deg,${S.btn[0]} 0%,${S.btn[1]} 52%,${S.btn[2]} 100%) !important;
    box-shadow:0 10px 26px -12px ${S.railGlow}, inset 0 1px 0 rgba(255,255,255,.22);
  }
  .hover\\:bg-green-400:hover{
    background-image:linear-gradient(135deg,${S.btnHi[0]} 0%,${S.btnHi[1]} 52%,${S.btnHi[2]} 100%) !important;
  }

  /* ---------- nav + active page indicator ---------- */
  #nav-content .nav-link{
    border-radius:8px;padding-left:8px;margin-left:-8px;
    border-left:2px solid transparent;
  }
  #nav-content .nav-link:hover{ background:${S.tint}; }
  #nav-content .nav-link.fx-active{
    border-radius:0 8px 8px 0;
    background:${S.tintOn} !important;
    border-left-color:var(--fx-orange) !important;
    color:${S.activeText} !important;
  }
  #nav-content .nav-sec{ color:#4C6484 !important; }
  #nav-wordmark span:first-child{
    background:linear-gradient(100deg,${S.rail[0]},${S.rail[1]} 55%,${S.rail[2]});
    -webkit-background-clip:text;background-clip:text;color:transparent;
  }

  /* ---------- nav groups + quick row (Option B) ---------- */
  .nav-ghead{
    display:flex;align-items:center;gap:7px;width:100%;background:none;border:0;cursor:pointer;
    padding:5px 8px;margin:0 -8px 0;border-radius:6px;text-align:left;
  }
  .nav-ghead:hover{ background:rgba(255,255,255,.035); }
  .nav-ghead:hover .nav-sec{ color:#8098B7 !important; }
  .nav-gcount{
    font-family:var(--fx-mono);font-size:9px;font-weight:700;color:#31465F;
  }
  .nav-group.open .nav-gcount{ display:none; }
  .nav-chev{
    margin-left:auto;width:11px;height:11px;flex:0 0 auto;
    transition:transform .18s ease;color:#31465F;
  }
  .nav-ghead:hover .nav-chev{ color:var(--fx-orange); }
  .nav-group.open .nav-chev{ transform:rotate(90deg); }
  .nav-gbody{ display:none; }
  .nav-group.open .nav-gbody{ display:block; }

  #nav-quick{ padding:0 1px 1px; }
  .nav-q{
    width:30px;height:30px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;
    border-radius:6px;color:#4C6484;transition:background .15s,color .15s;
  }
  .nav-q svg{ width:15px;height:15px; }
  .nav-q:hover{ background:rgba(255,107,31,.10);color:var(--fx-orange); }

  /* collapsed rail: no room for a 6-across row, and a shut group would hide
     links that have no other affordance — so open it and stack the icons */
  @media (min-width:768px){
    html.nav-collapsed #nav-content .nav-gbody{ display:block !important; }
    html.nav-collapsed #nav-content .nav-ghead{ display:none !important; }
    html.nav-collapsed #nav-quick{ display:grid !important;grid-template-columns:1fr 1fr;gap:2px;justify-items:center; }
    html.nav-collapsed .nav-q{ width:26px;height:26px; }
    html.nav-collapsed .nav-q svg{ width:14px !important;height:14px !important; }
    html.nav-collapsed #nav-search-btn{ justify-content:center; }
  }

  /* ---------- rhythm: tighten the stock py-24 sections ---------- */
  .py-24{ padding-top:4.25rem !important; padding-bottom:4.25rem !important; }

  h1,h2,h3{ letter-spacing:-.022em; }
  h1{ letter-spacing:-.032em; }

  ::selection{ background:rgba(242,107,33,.32); color:#fff; }
  ::-webkit-scrollbar{ width:10px;height:10px; }
  ::-webkit-scrollbar-track{ background:#060D18; }
  ::-webkit-scrollbar-thumb{ background:#22374F;border-radius:8px;border:2px solid #060D18; }
  ::-webkit-scrollbar-thumb:hover{ background:#F26B21; }

  /* =========================================================================
     VARIANT A · BANDED
     Alternating section grounds, centre-fading rules, rail on the nav edge.
     ====================================================================== */
  [data-fx="a"] body::before{ display:none; }
  [data-fx="a"] aside#sidebar-panel{
    border-right:0 !important;
    box-shadow:inset -3px 0 0 0 ${S.mark}, 8px 0 34px -18px ${S.railGlow};
  }
  @media (max-width:767px){
    [data-fx="a"] header.md\\:hidden{ border-top:3px solid ${S.mark} !important; }
  }
  [data-fx="a"] main section{ border-bottom:0 !important; position:relative; }
  [data-fx="a"] main section:nth-of-type(even){ background-color:${hexA(S.slate[900],.55)} !important; }
  [data-fx="a"] main section:nth-of-type(odd){ background-color:transparent !important; }
  [data-fx="a"] main section + section::before{
    content:'';position:absolute;top:0;left:10%;right:10%;height:1px;
    background:linear-gradient(90deg,transparent,rgba(126,170,224,.38),transparent);
  }

  /* =========================================================================
     VARIANT B · PANELS
     Each section floats as a rounded card so the grid shows between them.
     ====================================================================== */
  [data-fx="b"] main > div{ padding-left:20px; padding-right:20px; }
  [data-fx="b"] main section{
    border:1px solid var(--fx-line) !important;
    border-radius:26px;
    margin:16px 0;
    background-color:${hexA(S.slate[950],.64)} !important;
    box-shadow:0 22px 60px -46px rgba(0,0,0,1);
  }
  [data-fx="b"] body::after{ background-size:56px 56px; }
  [data-fx="b"] main > footer{ width:auto !important; margin:16px 20px 20px; border-radius:26px; border:1px solid var(--fx-line) !important; }
  @media (max-width:767px){
    [data-fx="b"] main > div{ padding-left:10px;padding-right:10px; }
    [data-fx="b"] main section{ border-radius:18px; }
    [data-fx="b"] main > footer{ margin-left:10px;margin-right:10px;border-radius:18px; }
  }

  /* =========================================================================
     VARIANT C · TERMINAL
     Sharp corners, stronger grid, monospace labels — matches the // nav style.
     ====================================================================== */
  [data-fx="c"] .rounded-3xl{ border-radius:8px !important; }
  [data-fx="c"] .rounded-2xl{ border-radius:6px !important; }
  [data-fx="c"] .rounded-xl { border-radius:5px !important; }
  [data-fx="c"] .rounded-lg { border-radius:4px !important; }
  [data-fx="c"][data-fx-grid="on"] body::after{
    background-size:44px 44px;
    background-image:
      linear-gradient(${S.grid.replace(/[\d.]+\)$/, '.06)')} 1px,transparent 1px),
      linear-gradient(90deg,${S.grid.replace(/[\d.]+\)$/, '.06)')} 1px,transparent 1px);
  }
  [data-fx="c"] .tracking-widest,
  [data-fx="c"] [class*="tracking-[0.2"],
  [data-fx="c"] [class*="tracking-[0.3"]{
    font-family:var(--fx-mono) !important;
    letter-spacing:.14em !important;
  }
  [data-fx="c"] main section{ border-bottom:1px solid rgba(126,170,224,.20) !important; position:relative; }
  [data-fx="c"] main section + section::after{
    content:'';position:absolute;top:-1px;left:0;width:56px;height:2px;background:${S.mark};
  }

  /* palette 4 · two-tone — everything ambient is ice blue, only solid CTAs stay orange */
  [data-fx-pal="4"] .bg-green-500{
    background-image:linear-gradient(135deg,#F98B34 0%,#F26B21 52%,#DE580F 100%) !important;
    color:#0A1626 !important;
    box-shadow:0 10px 26px -12px rgba(242,107,33,.75), inset 0 1px 0 rgba(255,255,255,.22);
  }
  [data-fx-pal="4"] .hover\\:bg-green-400:hover{
    background-image:linear-gradient(135deg,#FFA057 0%,#F5822F 52%,#EC6A17 100%) !important;
  }
  [data-fx="c"] section [class*="rounded-"][class*="border"]::before{ display:none; }
  [data-fx="c"] td, [data-fx="c"] th{ font-variant-numeric:tabular-nums; }
  `;

  var style = document.createElement('style');
  style.id = 'fsdx-theme';
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- 4. Active nav link ------------------------------------------
     nav.html is injected async by nav-loader.js, so watch for it.
  ------------------------------------------------------------------------ */
  function markActive() {
    var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    here = here.replace(/^index-[abc]\.html$/, 'index.html');
    var links = document.querySelectorAll('#nav-content a.nav-link');
    if (!links.length) return false;
    links.forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('#')[0].toLowerCase();
      if (href && href === here && !a.classList.contains('nav-sub')) a.classList.add('fx-active');
    });
    return true;
  }
  if (!markActive()) {
    var mo = new MutationObserver(function () { if (markActive()) mo.disconnect(); });
    var start = function () {
      var host = document.getElementById('nav-content');
      if (host) mo.observe(host, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})();
