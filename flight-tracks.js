/* Flight history only: does not choose, match or filter aircraft. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KazuarFlightTracks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const norm = x => String(x || '').trim().toUpperCase();
  // Altitude stops in metres: FR24's published legend; fallback RGB approximations.
  const stops = [[0, "#ffffff"], [100, "#ffe062"], [200, "#ffea00"], [300, "#f0ff00"], [400, "#ccff00"], [600, "#42ff00"], [800, "#1eff00"], [1000, "#00ff0c"], [1200, "#00ff36"], [1500, "#00ff72"], [2000, "#00ff9c"], [2500, "#00ffd2"], [3000, "#00ffe4"], [3500, "#00eaff"], [4000, "#00c0ff"], [4500, "#00a8ff"], [5000, "#0096ff"], [5500, "#0078ff"], [6000, "#0054ff"], [6500, "#0030ff"], [7000, "#001eff"], [7500, "#0000ff"], [8000, "#1200ff"], [8500, "#2400ff"], [9000, "#3600ff"], [9500, "#4e00ff"], [10000, "#6000ff"], [10500, "#7800ff"], [11000, "#9600ff"], [11500, "#ae00ff"], [12000, "#d800ff"], [12500, "#ff00e4"], [13000, "#ff0000"]]; // PALETTE_STOPS
  function altitudeColor(alt) {
    if (typeof alt !== 'number' || !Number.isFinite(alt)) return '#9299a0';
    alt *= 0.3048; // VATSIM provides feet.
    if (alt < 100) return '#ffffff';
    if (alt === 100) return stops.find(s => s[0] === 100)[1];
    for (let i = 1; i < stops.length; i++) {
      const [hi,b] = stops[i], [lo,a] = stops[i-1];
      if (alt <= hi) {
        const k = (alt-lo)/(hi-lo);
        return '#' + [1,3,5].map(j => Math.round(parseInt(a.slice(j,j+2),16)*(1-k)+parseInt(b.slice(j,j+2),16)*k).toString(16).padStart(2,'0')).join('');
      }
    }
    return stops[stops.length-1][1];
  }
  function identity(source, flight) {
    if (source === 'newsky') {
      const key = flight?._id || flight?.id;
      return key ? {source, key:String(key), session:String(key)} : null;
    }
    if (source !== 'vatsim' || !flight?.cid || !flight?.callsign || !flight?.logon_time) return null;
    return {source, key:JSON.stringify([String(flight.cid),norm(flight.callsign),norm(flight.flight_plan?.departure),norm(flight.flight_plan?.arrival)]), session:String(flight.logon_time)};
  }
  function same(a,b) { return !!a && !!b && a.source === b.source && a.key === b.key && a.session === b.session; }
  function url(id, location) {
    if (!id) return null;
    const local = ['localhost','127.0.0.1'].includes(location.hostname) && location.protocol === 'http:';
    const production = ['kazuar.in.ua','www.kazuar.in.ua'].includes(location.hostname) && location.protocol === 'https:';
    if (!local && !production) return null;
    const base = local ? 'http://127.0.0.1:8765' : 'https://bot-production-a418.up.railway.app';
    return base + '/api/flight-tracks?' + new URLSearchParams(id);
  }
  function valid(p) { return p && typeof p.lat === 'number' && typeof p.lon === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat)<=90 && Math.abs(p.lon)<=180; }
  function segments(source, points) {
    const result = [];
    let last = null;
    for (const p of Array.isArray(points) ? points : []) {
      if (!valid(p)) { last = null; continue; }
      if (last && !p.break_before && Math.abs(last.lon-p.lon)<=180 && (last.lat!==p.lat || last.lon!==p.lon)) {
        const known = typeof last.alt === 'number' && Number.isFinite(last.alt) && typeof p.alt === 'number' && Number.isFinite(p.alt);
        const color = source === 'newsky' ? '#1a9d61' : altitudeColor(known ? (last.alt+p.alt)/2 : null);
        const from = [last.lat,last.lon], to = [p.lat,p.lon], previous = result[result.length-1];
        if (previous && previous.color === color && previous.last === last) { previous.coords.push(to); previous.last = p; }
        else result.push({color, coords:[from,to],last:p});
      }
      last = p;
    }
    return result.map(({color,coords}) => ({color,coords}));
  }
  async function load(id, location, signal, fetcher = fetch) {
    const endpoint = url(id, location);
    if (!endpoint) return [];
    const response = await fetcher(endpoint, {cache:'no-store',signal});
    if (response.status === 404) return [];
    if (!response.ok) throw new Error('Flight tracks HTTP '+response.status);
    const data = await response.json();
    if (data.source !== id.source || !Array.isArray(data.points)) throw new Error('Invalid flight track response');
    return data.points;
  }
  const historyStyle = {weight:2,opacity:1,lineCap:'round',lineJoin:'round',pane:'ukraineFlightLinesPane',interactive:false};
  function connectable(a,b) {
    return Array.isArray(a) && Array.isArray(b) && a.length===2 && b.length===2 &&
      a.every(Number.isFinite) && b.every(Number.isFinite) &&
      Math.abs(a[0])<=90 && Math.abs(b[0])<=90 && Math.abs(a[1])<=180 && Math.abs(b[1])<=180 &&
      Math.abs(a[1]-b[1])<=180 && (a[0]!==b[0] || a[1]!==b[1]);
  }
  function helpers(points,dep,live,arr) {
    const lines=[];
    const add=(a,b,kind)=>{if(connectable(a,b)) lines.push({coords:[a,b],kind});};
    const list=Array.isArray(points)?points:[];
    let first=null,last=null,broken=false;
    for(const p of list){
      if(!valid(p)){broken=true;continue;}
      const at=[p.lat,p.lon];
      if(!first) first=at;
      if(last && (broken || p.break_before)) add(last,at,'gap');
      last=at;broken=false;
    }
    add(dep,first||live,'departure');
    if(last) add(last,live,'gap');
    add(live,arr,'arrival');
    return lines;
  }
  // Display-only monotone cubic interpolation, inspired by the published
  // VATSIM Radar movement approach. History itself remains the saved samples.
  // No extrapolation, no guessed turn side and no spline across missing data.
  const metresPerDegree = 111195;
  function chord(a,b) {
    const scale=Math.max(.01,Math.cos((a.lat+b.lat)*Math.PI/360));
    return Math.hypot((b.lat-a.lat)*metresPerDegree,(b.lon-a.lon)*metresPerDegree*scale);
  }
  function adjacent(a,b) {
    return valid(a)&&valid(b)&&!b.break_before&&Math.abs(a.lon-b.lon)<=180;
  }
  function interval(a,b) {
    if (!adjacent(a,b) || chord(a,b)<.01) return null;
    if (Number.isFinite(a.t)&&Number.isFinite(b.t)) {
      const dt=b.t-a.t;
      return dt>0&&dt<=60?dt:null;
    }
    return Math.max(.1,chord(a,b));
  }
  // Weighted harmonic mean: zero slope at a change in direction on an axis.
  function tangent(d1,d2,h1,h2) {
    if (!d1||!d2||Math.sign(d1)!==Math.sign(d2)) return 0;
    const w1=2*h2+h1,w2=2*h1+h2;
    return (w1+w2)/(w1/d1+w2/d2);
  }
  function axis(a,b,c,d,h0,h,h2,k,key) {
    const rate=(c[key]-b[key])/h;
    const m0=h0===null?rate:tangent((b[key]-a[key])/h0,rate,h0,h);
    const m1=h2===null?rate:tangent(rate,(d[key]-c[key])/h2,h,h2);
    const k2=k*k,k3=k2*k;
    const value=(2*k3-3*k2+1)*b[key]+(k3-2*k2+k)*h*m0+(-2*k3+3*k2)*c[key]+(k3-k2)*h*m1;
    return Math.max(Math.min(b[key],c[key]),Math.min(Math.max(b[key],c[key]),value));
  }
  function interpolatedLeg(a,b,c,d) {
    const h=interval(b,c);
    const from=[b.lat,b.lon],to=[c.lat,c.lon];
    if(h===null)return [from,to];
    const h0=interval(a,b),h2=interval(c,d);
    if(h0===null&&h2===null)return [from,to];
    const distance=chord(b,c);
    const timed=Number.isFinite(b.t)&&Number.isFinite(c.t);
    const onGround=timed?distance/h<26:distance<500;
    // Bound estimated lateral offset to avoid drawing a fake taxiway or turn.
    const limit=Math.min(distance*.18,onGround?10:150);
    const scale=Math.max(.01,Math.cos((b.lat+c.lat)*Math.PI/360));
    const dx=(c.lat-b.lat)*metresPerDegree,dy=(c.lon-b.lon)*metresPerDegree*scale;
    const coords=[from];
    for(let j=1;j<12;j++) {
      const k=j/12;
      let lat=axis(a,b,c,d,h0,h,h2,k,'lat'),lon=axis(a,b,c,d,h0,h,h2,k,'lon');
      const x=(lat-b.lat)*metresPerDegree,y=(lon-b.lon)*metresPerDegree*scale;
      const along=Math.max(0,Math.min(1,(x*dx+y*dy)/(dx*dx+dy*dy)));
      const px=along*dx,py=along*dy,dev=Math.hypot(x-px,y-py);
      if(dev>limit){const f=limit/dev;lat=b.lat+(px+(x-px)*f)/metresPerDegree;lon=b.lon+(py+(y-py)*f)/(metresPerDegree*scale);}
      coords.push([lat,lon]);
    }
    coords.push(to);
    // Avoid adding needless vertices to a straight segment.
    if(coords.slice(1,-1).every(([lat,lon])=>Math.abs((lat-b.lat)*metresPerDegree*dy-(lon-b.lon)*metresPerDegree*scale*dx)/distance<.001))return [from,to];
    return coords;
  }
  // Use fractional layer pixels for track paths only. Leaflet normally rounds them.
  const preciseClasses = new WeakMap();
  function historyPolyline(L, coords, options) {
    if (!L.Polyline || !L.Polyline.extend || !L.LatLngBounds) return L.polyline(coords,options);
    let Precise = preciseClasses.get(L);
    if (!Precise) {
      Precise=L.Polyline.extend({
        _projectLatlngs(latlngs, result, bounds) {
          if (!latlngs.length) return;
          if (latlngs[0] instanceof L.LatLng) {
            const origin=this._map.getPixelOrigin();
            const ring=latlngs.map(ll=>{
              const px=this._map.project(ll).subtract(origin);
              bounds.extend(px);
              return px;
            });
            result.push(ring);
          } else for (const ring of latlngs) this._projectLatlngs(ring,result,bounds);
        }
      });
      preciseClasses.set(L,Precise);
    }
    return new Precise(coords,options);
  }
  function groundLeg(a,b,c,d) {
    const h=interval(b,c);
    if (h===null || chord(b,c)<1 || chord(b,c)/h>35 || !Number.isFinite(b.t) || !Number.isFinite(c.t)) return false;
    // Avoid treating slow high-altitude samples as taxiing. Altitude is MSL.
    if ([b,c].some(p=>typeof p.alt==='number'&&p.alt>10000)) return false;
    const scale=Math.max(.01,Math.cos((b.lat+c.lat)*Math.PI/360));
    const vector=(p,q)=>[(q.lon-p.lon)*scale,q.lat-p.lat];
    const angle=(v,w)=>Math.atan2(v[0]*w[1]-v[1]*w[0],v[0]*w[0]+v[1]*w[1]);
    const v=vector(b,c);
    const previous=interval(a,b),next=interval(c,d);
    const angles=[];
    if(previous!==null&&chord(a,b)>=3&&chord(a,b)/previous<=35) angles.push(angle(vector(a,b),v));
    if(next!==null&&chord(c,d)>=3&&chord(c,d)/next<=35) angles.push(angle(v,vector(c,d)));
    // No invented lateral movement at a sampled reversal, nor smoothing of tiny heading noise.
    if(angles.some(x=>Math.abs(x)>Math.PI*0.8)) return false;
    if(angles.length===2&&angles[0]*angles[1]<0&&Math.min(...angles.map(Math.abs))>Math.PI/18) return false;
    return angles.some(x=>Math.abs(x)>=Math.PI/12);
  }
  function smoothSegments(source,points) {
    const p=Array.isArray(points)?points:[],out=[];
    for(let i=1;i<p.length;i++){
      const b=p[i-1],c=p[i];
      if(!adjacent(b,c)||(b.lat===c.lat&&b.lon===c.lon))continue;
      const color=source==='newsky'?'#1a9d61':altitudeColor(typeof b.alt==='number'&&Number.isFinite(b.alt)&&typeof c.alt==='number'&&Number.isFinite(c.alt)?(b.alt+c.alt)/2:null);
      const coords=groundLeg(p[i-2],b,c,p[i+1]) ? interpolatedLeg(p[i-2],b,c,p[i+1]) : [[b.lat,b.lon],[c.lat,c.lon]];
      const prev=out[out.length-1];
      if(prev&&prev.end===i-1&&prev.color===color){prev.coords.push(...coords.slice(1));prev.end=i;}
      else out.push({color,coords,end:i});
    }
    return out.map(({color,coords})=>({color,coords}));
  }
  function draw(L, layer, source, points) {
    for (const segment of smoothSegments(source,points)) {
      historyPolyline(L,segment.coords,{...historyStyle,smoothFactor:0,color:segment.color}).addTo(layer);
    }
  }
  function drawRoute(L,layer,source,points,dep,live,arr,color){
    for(const h of helpers(points,dep,live,arr)){
      L.polyline(h.coords,{...historyStyle,color,weight:1,opacity:.92,
        ...(h.kind==='arrival'?{}:{dashArray:'5 5'})}).addTo(layer);
    }
    draw(L,layer,source,points);
  }
  return {identity,same,url,segments,altitudeColor,load,draw,helpers,drawRoute,smoothSegments};
});
