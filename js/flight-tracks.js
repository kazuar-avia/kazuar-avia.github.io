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
  // Choose an aerodrome by position only; determine ground status by elevation only.
  // Both VATSIM altitude and OurAirports elevation are in feet.
  const groundToleranceFt = 150, airportRadiusKm = 5;
  function airportElevationLookup(airports) {
    const list = (Array.isArray(airports) ? airports : [])
      .filter(a => valid(a) && Number.isFinite(a.elevationFt))
      .slice().sort((a,b) => a.lat-b.lat);
    const rad = Math.PI/180, earthKm = 6371;
    const latRange = airportRadiusKm/earthKm/rad;
    return function elevationAt(p) {
      if (!valid(p)) return null;
      let lo=0, hi=list.length;
      while (lo<hi) {
        const mid=(lo+hi)>>>1;
        if (list[mid].lat<p.lat-latRange) lo=mid+1; else hi=mid;
      }
      let nearest=null, best=airportRadiusKm;
      for (let i=lo; i<list.length && list[i].lat<=p.lat+latRange; i++) {
        const a=list[i], dy=(a.lat-p.lat)*rad, dx=(a.lon-p.lon)*rad;
        const v=Math.sin(dy/2)**2+Math.cos(p.lat*rad)*Math.cos(a.lat*rad)*Math.sin(dx/2)**2;
        const km=2*earthKm*Math.asin(Math.sqrt(Math.min(1,Math.max(0,v))));
        if (km<=best) {best=km;nearest=a.elevationFt;}
      }
      return nearest;
    };
  }
  function groundPoint(p, elevationAt) {
    if (!Number.isFinite(p.alt) || typeof elevationAt !== 'function') return false;
    const elevation=elevationAt(p);
    return Number.isFinite(elevation) && Math.abs(p.alt-elevation)<=groundToleranceFt;
  }
  function segmentColor(source,a,b,elevationAt) {
    if (source==='newsky') return '#1a9d61';
    if (groundPoint(a,elevationAt) && groundPoint(b,elevationAt)) return '#ffffff';
    const known=Number.isFinite(a.alt)&&Number.isFinite(b.alt);
    return altitudeColor(known ? (a.alt+b.alt)/2 : null);
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
    const production = ['kazuar.in.ua','www.kazuar.in.ua','kazuar-avia.github.io'].includes(location.hostname) && location.protocol === 'https:';
    if (!local && !production) return null;
    const base = local ? 'http://127.0.0.1:8765' : 'https://bot-production-a418.up.railway.app';
    return base + '/api/flight-tracks?' + new URLSearchParams(id);
  }
  function valid(p) { return p && typeof p.lat === 'number' && typeof p.lon === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat)<=90 && Math.abs(p.lon)<=180; }
  function segments(source, points, elevationAt) {
    const result = [];
    let last = null;
    for (const p of Array.isArray(points) ? points : []) {
      if (!valid(p)) { last = null; continue; }
      if (last && !p.break_before && Math.abs(last.lon-p.lon)<=180 && (last.lat!==p.lat || last.lon!==p.lon)) {
        const color = segmentColor(source,last,p,elevationAt);
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
  // Round observed turns visually through real samples for both networks.
  // The maximum eligible time gap is source-specific; no extrapolation.
  function turnInterval(a,b,maxGap) {
    if (!adjacent(a,b) || !Number.isFinite(a.t) || !Number.isFinite(b.t)) return null;
    const dt=b.t-a.t, distance=chord(a,b);
    return dt>0 && dt<=maxGap && distance>=3 && distance/dt<=400 ? dt : null;
  }
  function roundedLeg(a,b,c,d,maxGap) {
    const straight=[[b.lat,b.lon],[c.lat,c.lon]];
    const dt=turnInterval(b,c,maxGap);
    if (dt===null) return straight;
    const scale=Math.max(.01,Math.cos((b.lat+c.lat)*Math.PI/360));
    const vector=(p,q)=>[(q.lon-p.lon)*metresPerDegree*scale,(q.lat-p.lat)*metresPerDegree];
    const length=v=>Math.hypot(v[0],v[1]);
    const unit=v=>{const n=length(v);return n>0?v.map(x=>x/n):null;};
    const v=vector(b,c), len=length(v), u=unit(v);
    if (!u) return straight;
    function corner(p,q,r) {
      const h0=turnInterval(p,q,maxGap),h1=turnInterval(q,r,maxGap);
      if (h0===null || h1===null) return null;
      const v0=vector(p,q),v1=vector(q,r),u0=unit(v0),u1=unit(v1);
      if (!u0||!u1) return null;
      const angle=Math.atan2(Math.abs(u0[0]*u1[1]-u0[1]*u1[0]),u0[0]*u1[0]+u0[1]*u1[1]);
      if (angle<Math.PI/12 || angle>Math.PI*.8) return null;
      const dir=unit([u0[0]+u1[0],u0[1]+u1[1]]);
      if (!dir) return null;
      const slow=length(v0)/h0<=35 && length(v1)/h1<=35;
      return {dir,reach:Math.min(length(v0),length(v1))*.25,limit:slow?10:500};
    }
    const start=corner(a,b,c),end=corner(b,c,d);
    if (!start&&!end) return straight;
    function control(turn) {
      if (!turn) return u.map(x=>x*len/3);
      const cross=Math.abs(u[0]*turn.dir[1]-u[1]*turn.dir[0]);
      const along=u[0]*turn.dir[0]+u[1]*turn.dir[1];
      if (along<=0) return u.map(x=>x*len/3);
      const reach=Math.min(turn.reach,len*.25,Math.min(len*.12,turn.limit)/Math.max(cross,1e-9));
      return turn.dir.map(x=>x*reach);
    }
    const cp1=control(start), e=control(end),cp2=[v[0]-e[0],v[1]-e[1]];
    const coords=[straight[0]];
    for(let j=1;j<16;j++){
      const k=j/16,m=1-k;
      const x=3*m*m*k*cp1[0]+3*m*k*k*cp2[0]+k*k*k*v[0];
      const y=3*m*m*k*cp1[1]+3*m*k*k*cp2[1]+k*k*k*v[1];
      const lat=b.lat+y/metresPerDegree,lon=b.lon+x/(metresPerDegree*scale);
      if (!valid({lat,lon})) return straight;
      coords.push([lat,lon]);
    }
    coords.push(straight[1]);
    return coords;
  }
  function smoothSegments(source,points,elevationAt) {
    const p=Array.isArray(points)?points:[],out=[];
    for(let i=1;i<p.length;i++){
      const b=p[i-1],c=p[i];
      if(!adjacent(b,c)||(b.lat===c.lat&&b.lon===c.lon))continue;
      const color=segmentColor(source,b,c,elevationAt);
      // VATSIM samples are denser; do not estimate curves across gaps over 60 seconds.
      const coords=roundedLeg(p[i-2],b,c,p[i+1],source==='newsky'?240:60);
      const prev=out[out.length-1];
      if(prev&&prev.end===i-1&&prev.color===color){prev.coords.push(...coords.slice(1));prev.end=i;}
      else out.push({color,coords,end:i});
    }
    return out.map(({color,coords})=>({color,coords}));
  }
  function draw(L, layer, source, points, elevationAt) {
    for (const segment of smoothSegments(source,points,elevationAt)) {
      historyPolyline(L,segment.coords,{...historyStyle,smoothFactor:0,color:segment.color}).addTo(layer);
    }
  }
  function drawRoute(L,layer,source,points,dep,live,arr,color,elevationAt){
    for(const h of helpers(points,dep,live,arr)){
      L.polyline(h.coords,{...historyStyle,color,weight:1,opacity:.92,
        ...(h.kind==='arrival'?{}:{dashArray:'5 5'})}).addTo(layer);
    }
    draw(L,layer,source,points,elevationAt);
  }
  return {identity,same,url,segments,altitudeColor,load,draw,helpers,drawRoute,smoothSegments,airportElevationLookup};
});
