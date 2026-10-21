/* Run with the connected Playwright browser_run_code tool's filename option.
   Uses the preview server at 127.0.0.1:8765. Narration is skipped in this
   browser session only; all flight/landing handlers are the real game code. */
async (page) => {
  const results = [], check = (name, ok, detail) => {
    results.push({name, pass:!!ok, ...(detail === undefined ? {} : {detail})});
  };
  const errors = [];
  page.on('pageerror', e=>errors.push(e.message));
  await page.setViewportSize({width:1672,height:941});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('http://127.0.0.1:8765/');
  await page.locator('#gateBtn').waitFor({state:'visible'});
  await page.evaluate(()=>{GeoAudio.say=()=>Promise.resolve();});
  await page.locator('#gateBtn').click();
  await page.locator('#navNext').click();
  await page.waitForTimeout(900);
  await page.locator('#navNext').click();
  await page.waitForFunction(()=>document.querySelector('.screen[data-reef] .stick.is-live'),{},{timeout:20000});
  const initial = await page.evaluate(()=>{
    const r=GeoPages.rounds[0],s=r.node,f=GeoEnvironmentAssets.platform.footprint;
    return {
      old:s.querySelectorAll('.sea,.shore,.surf,.wave,.surface,.reef-deep,.pad__img').length,
      others:document.querySelector('.screen[data-shape="rectangle"] .shore')!==null,
      errors:GeoReef.inspect(s).missing,
      footprint:[...s.querySelectorAll('.site--b .pad[data-area]')].map(p=>{
        const a=p.querySelector('.env-platform').getBoundingClientRect(),b=p.getBoundingClientRect();
        const scale=a.width/GeoEnvironmentAssets.platform.size[0];
        return {area:p.dataset.area,side:f[2]*scale,
          squareError:Math.abs(f[2]*scale-f[3]*scale),
          edgeError:Math.max(Math.abs((a.x+f[0]*scale)-(b.x+b.width*.114)),
            Math.abs((a.y+f[1]*scale)-(b.y+b.width*.117)))};
      }),
      activeAnimations:s.getAnimations({subtree:true}).filter(a=>a.playState==='running'&&a.effect.target.closest('.env-world,.env-platform,.env-satellites')).length
    };
  });
  check('Old environment absent only on square screen',initial.old===0&&initial.others,initial);
  check('Square visible footprint matches unchanged gameplay within 1.5px',initial.footprint.every(f=>f.squareError<.01&&f.edgeError<1.5));
  check('All replacement textures decode',initial.errors.length===0);
  const matrix = await page.evaluate(()=>{
    const r=GeoPages.rounds[0],s=r.node,issues=[];
    const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    for(let layout=0;layout<12;layout++) {
      GeoPages.strewPilot(r);
      for(let seed=1;seed<=8;seed++) {
        GeoReef.strew(r,seed);
        const info=GeoReef.inspect(s);
        if(info.clusters.some(c=>c.satellites.length<1||c.satellites.length>3)) issues.push({layout,seed,kind:'satellite count',counts:info.clusters.map(c=>c.satellites.length)});
        const pads=[...s.querySelectorAll('.env-platform')].map(e=>e.getBoundingClientRect());
        const sats=[...s.querySelectorAll('.env-satellite')].map(e=>e.getBoundingClientRect());
        if(sats.some(a=>pads.some(b=>overlap(a,b)))) issues.push({layout,seed,kind:'rock over pad'});
        const controls=[r.el.stick,r.el.lives,document.getElementById('nav')].map(e=>e.getBoundingClientRect());
        const dec=[...s.querySelectorAll('.env-satellite,.env-big,.env-submerged')].map(e=>e.getBoundingClientRect());
        if(dec.some(a=>controls.some(b=>overlap(a,b)))) issues.push({layout,seed,kind:'over control'});
      }
    }
    GeoReef.strew(r,173);
    const html=s.querySelector('.env-world').innerHTML, info=JSON.stringify(GeoReef.inspect(s));
    const count=s.querySelectorAll('*').length;
    for(let i=0;i<20;i++) GeoReef.strew(r,173);
    return {issues,deterministic:html===s.querySelector('.env-world').innerHTML&&info===JSON.stringify(GeoReef.inspect(s)),nodesStable:count===s.querySelectorAll('*').length};
  });
  check('96 decoration layouts: 1–3 rocks, no pad/control overlap',matrix.issues.length===0,matrix.issues.slice(0,10));
  check('Same seed/layout reproduces decorations; 20 resets have stable node count',matrix.deterministic&&matrix.nodesStable);
  const before = await page.evaluate(()=>{
    const s=GeoPages.rounds[0].node;
    window.envSnapshot=()=>JSON.stringify({info:GeoReef.inspect(s),positions:[...s.querySelectorAll('.env-object,.env-submerged')].map(e=>e.getAttribute('style'))});
    return envSnapshot();
  });
  for(const viewport of [{width:1024,height:768},{width:768,height:1024},{width:844,height:390}]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    check('Resize preserves positions at '+viewport.width+'x'+viewport.height,before===await page.evaluate(()=>envSnapshot()));
    const clear=await page.evaluate(()=>{
      const r=GeoPages.rounds[0],s=r.node;
      const keep=[r.el.stick,r.el.lives,document.getElementById('nav'),...s.querySelectorAll('.env-platform')].map(e=>e.getBoundingClientRect());
      return [...s.querySelectorAll('.env-satellite,.env-submerged,.env-big')].filter(e=>!e.hidden).every(e=>{
        const a=e.getBoundingClientRect();
        return !keep.some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top);
      });
    });
    check('Resize keeps decoration clear of platforms and controls at '+viewport.width+'x'+viewport.height,clear);
  }
  await page.setViewportSize({width:1672,height:941});
  await page.waitForTimeout(100);
  const paused = await page.evaluate(async()=>{
    GeoLife.suspend();
    window.envAnimations=GeoPages.rounds[0].node.getAnimations({subtree:true}).filter(a=>a.effect.target.closest('.env-world,.env-platform,.env-satellites'));
    await Promise.all(envAnimations.map(a=>a.ready));
    return envAnimations.map(a=>a.currentTime);
  });
  await page.waitForTimeout(220);
  const afterPause=await page.evaluate(()=>envAnimations.map(a=>a.currentTime));
  check('Pause freezes decorative animation clocks',paused.every((v,i)=>Math.abs(v-afterPause[i])<1));
  await page.evaluate(()=>GeoLife.resume());
  check('Pause/resume preserves positions',before===await page.evaluate(()=>envSnapshot()));
  // Replay only the visual is-up flag; it is not tied to gameplay readiness.
  await page.evaluate(()=>{document.querySelector('.screen[data-reef] .pad').classList.remove('is-up');});
  await page.waitForTimeout(60);
  await page.evaluate(()=>{document.querySelector('.screen[data-reef] .pad').classList.add('is-up');});
  await page.waitForTimeout(100);
  const rise = await page.evaluate(()=>{
    const p=document.querySelector('.screen[data-reef] .pad'),a=p.querySelector('.env-art');
    const m=new DOMMatrix(getComputedStyle(a).transform),water=p.querySelector('.env-water').getBoundingClientRect();
    return {sx:m.a,sy:m.d,y:m.f,waterY:water.y,opacity:getComputedStyle(p.querySelector('.env-front')).opacity};
  });
  await page.screenshot({path:'/tmp/environment-emergence.png'});
  await page.waitForTimeout(500);
  const waterY=await page.locator('.screen[data-reef] .pad .env-water').first().evaluate(e=>e.getBoundingClientRect().y);
  check('Emergence stays full size, rises slightly, waterline remains anchored',rise.sx===1&&rise.sy===1&&rise.y>0&&rise.y<=14&&Math.abs(rise.waterY-waterY)<.01&&+rise.opacity===0,rise);
  await page.evaluate(()=>GeoReef.setQuality('low'));
  check('Low effects removes secondary ripples',await page.locator('.screen[data-reef] .env-ripple').first().evaluate(e=>getComputedStyle(e).display==='none'));
  await page.evaluate(()=>GeoReef.setQuality('normal'));
  await page.emulateMedia({reducedMotion:'reduce'});
  const reduced = await page.evaluate(()=>{
    const s=GeoPages.rounds[0].node;
    return [...s.querySelectorAll('.pad.is-up .env-art')].every(e=>getComputedStyle(e).opacity==='1'&&getComputedStyle(e).transform==='none')&&s.querySelector('.stick').classList.contains('is-live');
  });
  check('Reduced motion renders final terrain and keeps controls ready',reduced);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForTimeout(1600);
  const shipBefore=await page.locator('.screen[data-reef] .site--b .ship').evaluate(e=>getComputedStyle(e).translate);
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(500); await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(400);
  const shipAfter=await page.locator('.screen[data-reef] .site--b .ship').evaluate(e=>getComputedStyle(e).translate);
  check('Existing keyboard flight responds',shipBefore!==shipAfter,{shipBefore,shipAfter});
  check('Flight does not move or regenerate decorations',before===await page.evaluate(()=>envSnapshot()));
  await page.screenshot({path:'/tmp/environment-verified.png'});
  // Place the helm at rest over each target to exercise the real overlap,
  // one-second lock, landing callbacks and heart/success outcomes.
  for (const area of [24,54,36]) {
    await page.waitForFunction(()=>GeoPages.rounds[0].sites.b.helm.armed,{},{timeout:20000});
    const hearts=await page.evaluate(()=>GeoPages.rounds[0].sites.b.helm.hearts);
    await page.evaluate(area=>{
      const h=GeoPages.rounds[0].sites.b.helm,p=h.geo.pads.find(p=>+p.pad.dataset.area===area);
      h.x=p.cx-h.geo.hx; h.y=p.cy-h.geo.hy; h.vx=h.vy=0;
    },area);
    await page.waitForFunction(({area,hearts})=>{
      const s=GeoPages.rounds[0].sites.b;
      return area===36 ? s.el.pads.querySelector('[data-area="36"]').classList.contains('is-fit') : s.helm.hearts===hearts-1;
    },{area,hearts},{timeout:20000});
    check('Existing landing outcome for '+area+' sq units',true);
  }
  check('No runtime exceptions',errors.length===0,errors);
  return {passed:results.filter(r=>r.pass).length,total:results.length,results};
}
