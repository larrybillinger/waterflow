/* Cinematic tracked-flow experience. The simulation worker owns motion. */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const VIEWS = [
    {name:'CHASE',zoom:16.3,pitch:74},
    {name:'AERIAL',zoom:15.1,pitch:47},
    {name:'WIDE',zoom:13.6,pitch:61}
  ];
  function locationOf(point, scenario) {
    const [w,s,e,n]=scenario.bounds;
    return [w+point.x/scenario.width*(e-w),n-point.y/scenario.height*(n-s)];
  }
  function interpolate(a,b,t) {
    const p=Math.max(0,Math.min(1,t)), delta=((b.heading-a.heading+540)%360)-180;
    return {
      x:a.x+(b.x-a.x)*p,y:a.y+(b.y-a.y)*p,time:a.time+(b.time-a.time)*p,
      speed:a.speed+(b.speed-a.speed)*p,
      heading:(a.heading+delta*p+360)%360,
      distance:a.distance+(b.distance-a.distance)*p,
      depth:a.depth+(b.depth-a.depth)*p,status:p<1?a.status:b.status
    };
  }
  class MovieMode {
    constructor(options) {
      this.map=options.map;this.worker=options.worker;
      this.getScenario=options.getScenario;this.notify=options.notify;
      this.pause=options.pause;this.toggleRun=options.toggleRun;this.selectTool=options.selectTool;
      this.mode='raft';this.view=0;this.follow=true;this.active=false;
      this.replaying=false;this.history=[];this.current=null;
      this.marker=null;this.markerEl=null;this.raf=null;this.cursor=0;this.lastTime=0;
      this.played=0;this.lastCamera=0;this.lastTrail=0;
      this.wire();
      this.map.on('dragstart',()=>{if(this.active && this.follow)this.setFollow(false);});
    }
    wire() {
      $('movie-enter').addEventListener('click',()=>this.enter());
      $('movie-exit').addEventListener('click',()=>this.exit());
      $('movie-tag').addEventListener('click',()=>{
        this.stopReplay(true);this.selectTool('tag');
        this.notify('Click inside currently wet water to place a raft or tracer.');
      });
      $('movie-raft').addEventListener('click',()=>this.setMode('raft'));
      $('movie-tracer').addEventListener('click',()=>this.setMode('tracer'));
      $('movie-follow').addEventListener('click',()=>this.setFollow(!this.follow));
      $('movie-camera').addEventListener('click',()=>this.nextCamera());
      $('movie-run').addEventListener('click',()=>{this.stopReplay(true);this.toggleRun();});
      $('movie-replay').addEventListener('click',()=>this.replaying?this.stopReplay(false):this.startReplay());
      $('movie-clear').addEventListener('click',()=>this.clear(true));
      $('movie-scrub').addEventListener('input',e=>this.scrub(Number(e.target.value)/1000));
      $('movie-save').addEventListener('click',()=>this.exportCSV());
      this.refresh();
    }
    enter() {
      if(!this.getScenario()){this.notify('Load a study area before entering movie mode.',true);return;}
      this.active=true;this.worker.postMessage({type:'cinemaRate',enabled:true,rate:8});
      document.body.classList.add('movie-mode');
      $('movie-hud').hidden=false;
      this.setFollow(true);
      if(!this.current){this.selectTool('tag');this.notify('Run water across the terrain, then click a wet point to start filming.');}
    }
    exit() {
      this.stopReplay(true);this.active=false;
      this.worker.postMessage({type:'cinemaRate',enabled:false});
      document.body.classList.remove('movie-mode');$('movie-hud').hidden=true;
      this.selectTool('inspect');this.map.resize();
    }
    setMode(mode) {
      this.mode=mode;
      if(this.markerEl)this.markerEl.classList.toggle('tracer-mode',mode==='tracer');
      this.refresh();
    }
    setFollow(value) {
      this.follow=Boolean(value);this.refresh();
      if(this.follow && this.current)this.moveCamera(this.current,true);
    }
    nextCamera() {
      this.view=(this.view+1)%VIEWS.length;this.refresh();
      if(this.current)this.moveCamera(this.current,true);
    }
    refresh() {
      $('movie-raft').classList.toggle('selected',this.mode==='raft');
      $('movie-tracer').classList.toggle('selected',this.mode==='tracer');
      $('movie-follow').classList.toggle('selected',this.follow);
      $('movie-follow').textContent=this.follow?'◉ FOLLOW ON':'◎ FREE CAMERA';
      $('movie-camera').textContent='CAMERA · '+VIEWS[this.view].name;
      $('movie-replay').textContent=this.replaying?'Ⅱ PAUSE REPLAY':'▶ REPLAY PATH';
      $('movie-replay').disabled=this.history.length<2 && !this.replaying;
    }
    place(index) {
      const scenario=this.getScenario();
      if(!scenario || index<0){this.notify('Choose a location inside the study area.',true);return;}
      const x=index%scenario.width+0.5,y=Math.floor(index/scenario.width)+0.5;
      this.worker.postMessage({type:'track',x,y});
    }
    placed() {this.clear(false);this.selectTool('inspect');this.notify('Tracker placed in modeled water. Follow mode is active.');}
    rejected(frame) {
      this.notify(frame.reason || 'The tracker must start in simulated water at least 0.1 m deep.',true);
    }
    clear(send) {
      this.stopReplay(false);this.history=[];this.current=null;this.lastTrail=0;
      if(this.marker){this.marker.remove();this.marker=null;this.markerEl=null;}
      this.updateTrail();this.updateReadout(null);this.refresh();
      if(send)this.worker.postMessage({type:'clearTrack'});
    }
    reset() {this.clear(false);}
    onFrame(frame) {
      if(!this.getScenario())return;
      if(frame.trackPoints && frame.trackPoints.length){
        for(const point of frame.trackPoints) {
          if(!this.history.length || point.time>this.history[this.history.length-1].time)
            this.history.push(point);
        }
        if(this.history.length>4500)this.history.splice(0,this.history.length-4500);
        if(performance.now()-this.lastTrail>220){this.updateTrail();this.lastTrail=performance.now();}
      }
      if(!frame.tracker) {
        if(this.current)this.reset();
        return;
      }
      if(!this.replaying) {
        this.current=frame.tracker;
        this.draw(this.current);this.updateReadout(this.current);
        this.moveCamera(this.current);
      }
      this.refresh();
    }
    ensureMarker() {
      if(this.marker)return;
      const el=document.createElement('div');
      el.className='film-marker';
      const raft=document.createElement('img');
      raft.src='/static/raft.svg';raft.alt='Stylized raft with rider';raft.width=90;raft.height=120;
      const dot=document.createElement('span');dot.className='water-tag';
      dot.setAttribute('aria-hidden','true');
      el.append(raft,dot);el.classList.toggle('tracer-mode',this.mode==='tracer');
      this.markerEl=el;
      this.marker=new maplibregl.Marker({element:el,anchor:'center',
        rotationAlignment:'map',pitchAlignment:'map'}).setLngLat([0,0]).addTo(this.map);
    }
    draw(frame) {
      if(!frame || !this.getScenario())return;
      this.ensureMarker();
      this.marker.setLngLat(locationOf(frame,this.getScenario()));
      this.marker.setRotation(frame.heading);
      this.markerEl.classList.toggle('grounded',frame.status!=='floating');
    }
    trail() {
      const scenario=this.getScenario();
      if(!scenario || this.history.length<2)return {type:'FeatureCollection',features:[]};
      return {type:'FeatureCollection',features:[{type:'Feature',properties:{},
        geometry:{type:'LineString',coordinates:this.history.map(p=>locationOf(p,scenario))}}]};
    }
    setupLayers() {
      if(!this.getScenario()||!this.map.isStyleLoaded())return;
      if(this.map.getLayer('movie-trail'))this.map.removeLayer('movie-trail');
      if(this.map.getSource('movie-trail-data'))this.map.removeSource('movie-trail-data');
      this.map.addSource('movie-trail-data',{type:'geojson',data:this.trail()});
      this.map.addLayer({id:'movie-trail',type:'line',source:'movie-trail-data',
        paint:{'line-color':'#ffe3a5','line-width':3,'line-opacity':0.9,'line-dasharray':[1.5,1.5]}});
    }
    updateTrail() {
      const source=this.map.getSource('movie-trail-data');
      if(source)source.setData(this.trail());
    }
    moveCamera(frame,immediate=false) {
      if(!this.active || !this.follow || !this.getScenario())return;
      const now=performance.now();
      if(!immediate && now-this.lastCamera<330)return;
      this.lastCamera=now;
      const view=VIEWS[this.view];
      this.map.easeTo({center:locationOf(frame,this.getScenario()),
        zoom:view.zoom,pitch:view.pitch,bearing:frame.heading,
        duration:immediate?750:440,essential:true});
    }
    clock(t) {
      if(!Number.isFinite(t))return '—';
      const sec=Math.floor(t);
      return [Math.floor(sec/3600),Math.floor(sec%3600/60),sec%60]
        .map(v=>String(v).padStart(2,'0')).join(':');
    }
    updateReadout(frame) {
      $('movie-time').textContent=frame?this.clock(frame.time):'—';
      $('movie-flow').textContent=frame?frame.speed.toFixed(2)+' m/s':'—';
      $('movie-travel').textContent=frame?(frame.distance/1000).toFixed(3)+' km':'—';
      $('movie-depth').textContent=frame?frame.depth.toFixed(2)+' m':'—';
      $('movie-state').textContent=frame?
        (frame.status==='floating'?'FLOATING':frame.status==='stranded'?'STRANDED · WATER TOO SHALLOW':'EXITED MODEL AREA'):
        'CLICK WET WATER TO TAG';
      const first=this.history[0]?.time||0,last=this.history[this.history.length-1]?.time||0;
      $('movie-range').textContent=this.history.length>1?this.clock(last-first)+' recorded':'No route recorded';
      $('movie-scrub').value=last>first&&frame?
        String(Math.round(1000*(frame.time-first)/(last-first))):'0';
    }
    startReplay() {
      if(this.history.length<2){this.notify('Follow moving water first to record a route.',true);return;}
      this.pause();this.replaying=true;this.played=this.history[0].time;this.cursor=0;this.lastTime=0;
      $('movie-caveat').textContent='REPLAY · Route is recorded; flood shading stays at the final simulated frame.';
      this.refresh();
      this.raf=requestAnimationFrame(t=>this.tick(t));
    }
    tick(timestamp) {
      if(!this.replaying)return;
      if(this.lastTime)this.played+=Math.min(0.2,(timestamp-this.lastTime)/1000)*Number($('movie-speed').value);
      this.lastTime=timestamp;
      const last=this.history[this.history.length-1].time;
      if(this.played>=last){
        this.played=last;this.showAt(last);this.stopReplay(false);return;
      }
      this.showAt(this.played);
      this.raf=requestAnimationFrame(t=>this.tick(t));
    }
    showAt(time) {
      if(!this.history.length)return;
      let i=this.cursor;
      if(time<this.history[i].time)i=0;
      while(i<this.history.length-2 && this.history[i+1].time<time)i++;
      this.cursor=i;
      const a=this.history[i],b=this.history[Math.min(i+1,this.history.length-1)];
      this.current=interpolate(a,b,b.time>a.time?(time-a.time)/(b.time-a.time):0);
      this.draw(this.current);this.updateReadout(this.current);this.moveCamera(this.current);
    }
    stopReplay(restoreLive) {
      if(this.raf!==null)cancelAnimationFrame(this.raf);
      this.raf=null;this.replaying=false;this.lastTime=0;
      $('movie-caveat').textContent='Passive tracer follows modeled water flow; not an actual raft forecast.';
      if(restoreLive && this.history.length) {
        this.current=this.history[this.history.length-1];
        this.draw(this.current);this.updateReadout(this.current);
      }
      this.refresh();
    }
    scrub(fraction) {
      if(this.history.length<2)return;
      this.pause();this.stopReplay(false);this.cursor=0;
      const first=this.history[0].time,last=this.history[this.history.length-1].time;
      this.showAt(first+fraction*(last-first));
      $('movie-caveat').textContent='SCRUBBING · Flood shading shows the latest simulated frame.';
    }
    exportCSV() {
      if(!this.history.length){this.notify('Record a tracked route before exporting.',true);return;}
      const scenario=this.getScenario(),rows=['sim_seconds,latitude,longitude,speed_m_s,depth_m,distance_m,status'];
      for(const p of this.history){
        const [lon,lat]=locationOf(p,scenario);
        rows.push([p.time.toFixed(2),lat.toFixed(7),lon.toFixed(7),
          p.speed.toFixed(3),p.depth.toFixed(3),p.distance.toFixed(2),p.status].join(','));
      }
      const url=URL.createObjectURL(new Blob([rows.join('\n')+'\n'],{type:'text/csv'}));
      const a=document.createElement('a');a.href=url;a.download='waterflow-tracked-path.csv';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    setRunning(running) {$('movie-run').textContent=running?'Ⅱ PAUSE FLOW':'▶ RUN FLOW';}
  }
  const api={MovieMode,locationOf,interpolate};
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.WaterflowMovie=api;
})(typeof window==='object'?window:globalThis);
